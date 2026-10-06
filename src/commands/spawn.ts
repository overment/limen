import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureFinishAuthor, finishWebhookEnv } from "../integrations/finish-webhook.ts";
import { herdrAvailable, herdrBinary, openHostedTab, openWatchTab } from "../integrations/herdr.ts";
import type { GroupRun } from "../job/group-cabinet.ts";
import { claimMember, groupIdentity, groupLock, groupPath, teamRoute } from "../job/group-cabinet.ts";
import { syncLifecycle } from "../job/group-events.ts";
import { hostedAgentName, makeJobId, parseDuration, SESSION_ID } from "../job/job.ts";
import { publishJob } from "../job/publication.ts";
import { appendLimenLog, atomicWrite, finalizeJob } from "../job/record.ts";
import {
	addBranchWorktree,
	addDetachedWorktree,
	addNewWorktree,
	branchCommit,
	branchExists,
	commitHasFile,
	repoRoot,
	resolveCommit,
	spawnBaseCommit,
	workspaceRepository,
	workspaceRoot,
	worktreeForBranch,
} from "../project/git.ts";
import { inheritedPlanning, planningSource, privatePlanningFile, privatePlanningTask, ticketPointers } from "../project/planning.ts";
import { signalProcessGroup, waitForProcessGroup } from "../runtime/contain.ts";
import { defaultModel, type EngineProfile, engineBinary, preflightEngine, resolveSpawnEngine } from "../runtime/engine.ts";
import { liveJob } from "../runtime/reap.ts";
import { normalizeWorkerExtensions } from "../runtime/worker-extensions.ts";
import { launchHostedSupervisor, launchWrapper } from "../runtime/wrapper.ts";
import { hunkBinary } from "./diff.ts";
import { pruneFinishedWorktrees } from "./prune.ts";

type SpawnOptions = {
	task: string;
	taskFile?: string;
	label?: string;
	branch?: string;
	base?: string;
	head?: string;
	repo?: string;
	model?: string;
	provider?: string;
	thinking?: string;
	timeoutMs?: number;
	prepare?: string;
	review: boolean;
	tab: boolean;
	detached: boolean;
	role?: string;
	engine?: string;
	extensions: string[];
};
const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
export function resolvePreamble(root: string, role: string): string {
	const places = [`${root}/.agents/limen/${role}.md`, resolve(PACKAGE_ROOT, "templates", `${role}.md`)];
	for (const path of places) if (existsSync(path)) return path;
	throw new Error(`no preamble for role ${role} in ${places.join(" or ")}; write .agents/limen/${role}.md to add the role`);
}
type WorktreePlan =
	| { readonly kind: "detach"; readonly path: string; readonly ref: string }
	| { readonly kind: "reuse"; readonly path: string }
	| { readonly kind: "add-branch"; readonly path: string; readonly branch: string }
	| { readonly kind: "add-new"; readonly path: string; readonly branch: string };
const HANDSHAKE_POLL_MS = 20;
const handshakeMs = (): number => (Number(process.env.LIMEN_HANDSHAKE_MS) > 0 ? Number(process.env.LIMEN_HANDSHAKE_MS) : 10_000);
export async function spawnCommand(args: readonly string[], cwd: string, coordinator?: { run: GroupRun; team: string }): Promise<void> {
	const identity = coordinator ? undefined : await groupIdentity(cwd);
	const group = coordinator
		? { run: coordinator.run, team: coordinator.team, role: "coordinator" as const }
		: identity?.member
			? { run: identity.run, team: identity.member.team, role: "worker" as const }
			: undefined;
	if (identity?.member?.role === "worker") throw new Error("group workers cannot launch jobs; ask their team coordinator");
	if (group) {
		await groupLock(`${groupPath(group.run)}/launch`, () => spawnJob(args, cwd, group), "wait");
		return;
	}
	await spawnJob(args, cwd);
}
async function spawnJob(args: readonly string[], cwd: string, group?: { run: GroupRun; team: string; role: "coordinator" | "worker" }): Promise<void> {
	const parsed = parseSpawnArgs(args);
	if (!group) {
		const roleClaim = claimsOwnerFacingLead(parsed.role);
		if (roleClaim) throw new Error(roleClaim);
	}
	if (group) {
		const run = group.run;
		const route = teamRoute(run, group.team);
		if (
			parsed.engine !== run.engine ||
			parsed.provider !== route.provider ||
			parsed.model !== route.model ||
			parsed.thinking !== (group.role === "coordinator" ? run.thinking : run.workerThinking)
		)
			throw new Error("group launches require the recorded engine/provider/model/reasoning explicitly");
		if (parsed.repo || (parsed.branch && !parsed.review) || (parsed.role && parsed.role !== group.role) || parsed.timeoutMs)
			throw new Error("group launches use isolated new branches, recorded roles and deadlines; omit --repo, ordinary --branch and --timeout");
		if (parsed.review) {
			const teamBranches = await Promise.all(run.members.filter((member) => member.team === group.team).map((member) => text(`${run.root}/.limen/jobs/${member.id}/branch`)));
			if (!teamBranches.includes(parsed.branch ?? "")) throw new Error("group review requires a candidate branch owned by this team");
		}
	}
	const herdr = herdrAvailable();
	const hosted = parsed.detached ? false : parsed.tab || herdr;
	if (parsed.tab && parsed.detached) throw new Error("--tab and --detached cannot be combined");
	if (hosted && parsed.timeoutMs) throw new Error("hosted jobs have no timeout; omit --timeout or use --detached");
	if (hosted && !herdr) throw new Error("hosted spawn requires Herdr (HERDR_ENV=1); use --detached for an ordinary job");
	const loaded = await readSpawnTask(parsed.task, parsed.taskFile, cwd);
	const options = { ...parsed, task: loaded.text, label: parsed.label ?? (loaded.text.trim().split(/\r?\n/, 1)[0]?.trim().slice(0, 80) || "job") };
	const profile = resolveSpawnEngine(options.engine);
	const engine = profile.id;
	const model = options.model ?? defaultModel(options.review);
	const recorded = group?.run.teamExtensions?.[group.team];
	const extensions = await normalizeWorkerExtensions(recorded ?? options.extensions, cwd, engine);
	if (recorded && options.extensions.length && JSON.stringify(await normalizeWorkerExtensions(options.extensions, cwd, engine)) !== JSON.stringify(extensions))
		throw new Error("group launches require the recorded team extensions; omit --extension to inherit them");
	preflightEngine(profile, model, options.provider);
	const notificationSession = currentNotificationSession();
	const coordinatorTab = process.env.HERDR_TAB_ID?.trim();
	// A group member never subscribes a session, so its pane stays recorded even under Pi: it is the lead's route when the group hook is not running.
	const coordinatorPane = herdrWakePane(group ? undefined : notificationSession);
	const workspace = group ? undefined : workspaceRoot(cwd);
	const currentRoot = workspace ?? repoRoot(cwd);
	// A job that spawns from its own worktree keeps its canonical root, recorded planning source, and repository.
	const inherited = group || workspace ? undefined : inheritedPlanning(currentRoot);
	const root = group?.run.root ?? inherited?.root ?? currentRoot;
	const source = group ? (group.run.planningSource ?? "committed") : (inherited?.source ?? planningSource(root));
	if (workspace && !options.repo) throw new Error("workspace spawn requires --repo <immediate-child>");
	if (!workspace && options.repo) throw new Error("--repo is available only from a non-Git workspace coordinator");
	let repository = currentRoot;
	if (workspace) repository = workspaceRepository(root, options.repo ?? "");
	else if (group) repository = root;
	const repo = options.repo ?? inherited?.repo;
	let task = options.task;
	if (loaded.raw) task = loaded.text;
	else if (workspace) task = workspaceTask(options.task, root, options.repo ?? "");
	// Private planning: check every pointer now, before a job record or worktree exists.
	let privatePacket = "";
	if (source === "private") {
		task = await privatePlanningTask(root, task);
		if (group) {
			const feature = group.run.feature;
			const ticket = await privatePlanningFile(root, `${feature}/ticket.md`);
			const brief = await privatePlanningFile(root, `${feature}/group/brief.md`);
			const note = await privatePlanningFile(root, `${feature}/group/teams/${group.team}.md`);
			privatePacket = `Ticket: ${ticket}\nBrief: ${brief}\nApproach note: ${note}`;
		}
	}
	const role = options.review ? "reviewer" : (group?.role ?? options.role ?? "worker");
	const pinnedBase = options.base ? resolveCommit(repository, options.base, "--base") : undefined;
	const pinnedHead = options.head ? resolveCommit(repository, options.head, "--head") : undefined;
	const preamble = resolvePreamble(root, role);
	const id = makeJobId(options.label);
	const jobsRoot = `${root}/.limen/jobs`;
	await mkdir(jobsRoot, { recursive: true });
	const branch = options.branch ?? `limen/${id}`;
	const worktreeRoot = `${dirname(repository)}/.${basename(repository)}-limen-worktrees`;
	const requestedPath = `${worktreeRoot}/${id}`;
	await mkdir(worktreeRoot, { recursive: true });
	const plan = await planWorktree({
		root: repository,
		requestedPath,
		branch,
		review: options.review,
		jobsRoot,
		...(repo ? { repo } : {}),
		...(options.branch ? { requestedBranch: options.branch } : {}),
	});
	if (pinnedHead && branchCommit(repository, branch) !== pinnedHead) throw new Error(`pinned review head moved before spawn: ${branch} is not at ${pinnedHead}`);
	const baseCommit = plan.kind === "add-new" ? spawnBaseCommit(repository) : branchCommit(repository, branch);
	if (source === "committed") {
		for (const { path } of ticketPointers(task))
			if (path.startsWith("spec/") && !commitHasFile(repository, baseCommit, path)) throw new Error(`ticket ${path} is missing from the base commit`);
	}
	const member = group ? await claimMember(group.run, group.team, group.role, id) : undefined;
	let running = 0;
	let held = false;
	for (const entry of await readdir(jobsRoot, { withFileTypes: true })) {
		if (!entry.isDirectory() || !(await liveJob(`${jobsRoot}/${entry.name}`))) continue;
		running += 1;
		if ((await text(`${jobsRoot}/${entry.name}/label`)) === options.label) held = true;
	}
	if (running > 0) console.log(`note: ${running} job${running === 1 ? "" : "s"} already running; starting another`);
	if (/^F\d{3,}$/i.test(options.label)) console.log("warning: label is only a feature number");
	if (held) console.log("warning: a live job already holds this label");
	const jobDir = `${jobsRoot}/${id}`;
	const candidate = options.review ? branchCommit(repository, branch) : undefined;
	const base = pinnedBase ?? baseCommit;
	// Private planning may rewrite ticket pointers, so its task is the checked text, not the raw bytes.
	let taskBody: string | Uint8Array = `${task.trim()}\n`;
	if (loaded.raw && source === "committed") taskBody = loaded.bytes;
	else if (candidate) taskBody = `${task.trim()}\n\nCandidate commit: ${candidate}.\n`;
	if (group && member) {
		const guidance = await readFile(`${PACKAGE_ROOT}/templates/group-member.md`, "utf8");
		const approach = privatePacket || `Approach note:\n${await readFile(`${root}/${group.run.feature}/group/teams/${group.team}.md`, "utf8")}`;
		taskBody = `${guidance}\nCanonical root: ${root}\nGroup: ${group.run.id}\nTeam: ${group.team}\nFeature: ${group.run.feature}\n${memberRoute(group.run, group.team)}\n${approach}\n\n${taskBody}`;
	}
	const finishConfig = finishWebhookEnv(root, cwd);
	await publishJob(jobDir, {
		task: taskBody,
		label: options.label,
		branch,
		worktree: plan.path,
		base,
		role,
		engine,
		extensions,
		planningSource: source,
		finishAuthor: captureFinishAuthor(cwd, loaded.text, Boolean(workspace)),
		...(repo ? { repo } : {}),
		...(hosted ? { agentName: hostedAgentName(id) } : {}),
		...(!group && notificationSession ? { notificationSession } : {}),
		...(coordinatorTab ? { originTab: coordinatorTab } : {}),
		...(coordinatorPane ? { originPane: coordinatorPane } : {}),
		...(group && member ? { group: { id: group.run.id, team: group.team, deadline: member.deadline } } : {}),
		...(candidate ? { candidate } : {}),
		...(finishConfig ? { finishConfig } : {}),
	});
	let worktree: string;
	try {
		worktree = executeWorktree(repository, plan);
		await pruneFinishedWorktrees(root, [worktree, currentRoot]).catch(() => {});
		await runPrepare(jobDir, worktree, parsed.prepare ?? process.env.LIMEN_PREPARE?.trim());
	} catch (error) {
		if (group) await finalizeJob(jobDir, "failed", `group launch failed: ${String(error)}`);
		else await rm(jobDir, { recursive: true, force: true });
		throw error;
	}
	const versions = capturedVersions(profile).then((text) => writeFile(`${jobDir}/versions`, text, { flag: "wx", flush: true }));
	await atomicWrite(`${jobDir}/state`, "running\n");
	if (group) await syncLifecycle(group.run, "skip");
	if (hosted) {
		await startHosted({
			jobDir,
			id,
			label: options.label,
			root,
			worktree,
			preamble,
			taskFile: `${jobDir}/task.md`,
			role,
			...(model ? { model } : {}),
			...(options.provider ? { provider: options.provider } : {}),
			...(options.thinking ? { thinking: options.thinking } : {}),
		});
		await versions.catch(() => {});
		console.log(`started ${options.label} (hosted)`);
		console.log(id);
		return;
	}
	await openWatchTab({ jobDir, label: options.label, cwd: root, logPath: `${jobDir}/log`, role });
	const environment: Record<string, string> = {
		LIMEN_JOB_DIR: jobDir,
		LIMEN_WORKTREE: worktree,
		LIMEN_TASK_FILE: `${jobDir}/task.md`,
		LIMEN_PREAMBLE: preamble,
		LIMEN_JOB_ID: id,
		LIMEN_LABEL: options.label,
		LIMEN_CONTEXT_ROOT: root,
	};
	if (group) {
		environment.LIMEN_GROUP_ID = group.run.id;
		environment.LIMEN_TEAM_ID = group.team;
		environment.LIMEN_TIMEOUT_MS = String(Math.max(1, (member?.deadline ?? group.run.deadline) - Date.now()));
	}
	environment.LIMEN_PROVIDER = options.provider ?? "";
	environment.LIMEN_THINKING = options.thinking ?? "";
	if (model) environment.LIMEN_MODEL = model;
	if (options.timeoutMs) environment.LIMEN_TIMEOUT_MS = String(options.timeoutMs);
	let wrapperPid: number;
	try {
		wrapperPid = await launchWrapper(environment);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await versions.catch(() => {});
		await finalizeJob(jobDir, "failed", `failed to launch wrapper: ${message}`);
		throw error;
	}
	await waitForHandshake(jobDir, wrapperPid);
	const state = await text(`${jobDir}/state`);
	if (state !== "running") {
		const detail = await lastLimenDetail(jobDir);
		await versions.catch(() => {});
		console.log(detail ? `${state} ${options.label}\n${detail}` : `${state} ${options.label}`);
		console.log(id);
		return;
	}
	await versions.catch(() => {});
	console.log(`started ${options.label}`);
	console.log(id);
}
export async function startHosted(input: {
	readonly jobDir: string;
	readonly id: string;
	readonly label: string;
	readonly root: string;
	readonly worktree: string;
	readonly preamble: string;
	readonly taskFile: string;
	readonly role: string;
	readonly model?: string;
	readonly provider?: string;
	readonly thinking?: string;
	readonly continueFile?: string;
}): Promise<void> {
	const agentName = hostedAgentName(input.id);
	const group = (await text(`${input.jobDir}/group`)) || "";
	const team = (await text(`${input.jobDir}/team`)) || "";
	try {
		await openHostedTab({
			jobDir: input.jobDir,
			label: input.label,
			cwd: input.worktree,
			workspaceCwd: input.root,
			role: input.role,
			env: {
				LIMEN_JOB: "1",
				LIMEN_HOSTED: "1",
				LIMEN_JOB_ID: input.id,
				LIMEN_JOB_LABEL: input.label,
				LIMEN_CONTEXT_ROOT: input.root,
				LIMEN_ROLE: input.role,
				LIMEN_GROUP_ID: group,
				LIMEN_TEAM_ID: team,
				HERDR_ENV: "1",
				PATH: `/usr/bin${process.env.PATH ? `:${process.env.PATH}` : ""}`,
			},
		});
		const supervisorPid = await launchHostedSupervisor({
			LIMEN_JOB_DIR: input.jobDir,
			LIMEN_WORKTREE: input.worktree,
			LIMEN_TASK_FILE: input.taskFile,
			LIMEN_PREAMBLE: input.preamble,
			LIMEN_JOB_ID: input.id,
			LIMEN_LABEL: input.label,
			LIMEN_CONTEXT_ROOT: input.root,
			LIMEN_ROLE: input.role,
			LIMEN_GROUP_ID: group,
			LIMEN_TEAM_ID: team,
			LIMEN_AGENT_NAME: agentName,
			LIMEN_HOSTED_START: "1",
			LIMEN_MODEL: input.model ?? "",
			LIMEN_PROVIDER: input.provider ?? "",
			LIMEN_THINKING: input.thinking ?? "",
			LIMEN_CONTINUE_FILE: input.continueFile ?? "",
		});
		await waitForHandshake(input.jobDir, supervisorPid, "hosted supervisor");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await finalizeJob(input.jobDir, "failed", `hosted start failed: ${message}`);
		throw error;
	}
}
async function planWorktree(input: {
	readonly root: string;
	readonly requestedPath: string;
	readonly branch: string;
	readonly review: boolean;
	readonly requestedBranch?: string;
	readonly repo?: string;
	readonly jobsRoot: string;
}): Promise<WorktreePlan> {
	const { root, requestedPath: path, branch } = input;
	if (input.review) {
		if (!input.requestedBranch) throw new Error("--review requires --branch <candidate-branch>");
		if (!branchExists(root, branch)) throw new Error(`candidate branch ${branch} does not exist`);
		return { kind: "detach", path, ref: branch };
	}
	if (!branchExists(root, branch)) return { kind: "add-new", path, branch };
	const existing = worktreeForBranch(root, branch);
	if (existing && resolve(existing.path) === resolve(root))
		throw new Error(
			`branch ${branch} is checked out in the primary worktree, so the job cannot get its own worktree; switch the primary worktree to another branch, or omit --branch`,
		);
	if (await liveJobUsesBranch(input.jobsRoot, branch, input.repo)) throw new Error(`branch ${branch} already has a live job`);
	return existing ? { kind: "reuse", path: existing.path } : { kind: "add-branch", path, branch };
}
function executeWorktree(root: string, plan: WorktreePlan): string {
	if (plan.kind === "detach") addDetachedWorktree(root, plan.path, plan.ref);
	if (plan.kind === "add-branch") addBranchWorktree(root, plan.path, plan.branch);
	if (plan.kind === "add-new") addNewWorktree(root, plan.path, plan.branch);
	return plan.path;
}
function claimsOwnerFacingLead(role: string | undefined): string | undefined {
	if (role === "coordinator" || role === "lead")
		return "refusing spawn --role coordinator/lead: managed team coordinators come only from limen group start; the owner-facing lead is the interactive Herdr coordinator pane (LIMEN_COORDINATOR=1) with hook/group-peer.ts loaded (export LIMEN_PACKAGE to a package that ships group-peer, then reload that pane) — never limen spawn a substitute lead job";
}

function parseSpawnArgs(args: readonly string[]): SpawnOptions {
	let branch: string | undefined, repo: string | undefined, label: string | undefined, model: string | undefined;
	let provider: string | undefined, thinking: string | undefined, base: string | undefined, head: string | undefined;
	let timeoutMs: number | undefined, taskFile: string | undefined, prepare: string | undefined, role: string | undefined, engine: string | undefined;
	let review = false,
		tab = false,
		detached = false,
		positional = false;
	const task: string[] = [];
	const extensions: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const value = args[index];
		if (!value) continue;
		if (value === "--") positional = true;
		else if (!positional && value === "--review") review = true;
		else if (!positional && value === "--tab") tab = true;
		else if (!positional && value === "--detached") detached = true;
		else if (!positional && value.startsWith("--")) {
			if (
				![
					"--branch",
					"--repo",
					"--label",
					"--model",
					"--provider",
					"--thinking",
					"--timeout",
					"--task-file",
					"--prepare",
					"--role",
					"--engine",
					"--base",
					"--head",
					"--extension",
				].includes(value)
			)
				throw new Error(`unknown spawn option ${value}`);
			const optionValue = args[index + 1];
			if (!optionValue || (value === "--extension" && optionValue.startsWith("--"))) throw new Error(`${value} requires a value`);
			index += 1;
			if (value === "--extension") extensions.push(optionValue);
			else if (value === "--branch") branch = once(branch, value, optionValue);
			else if (value === "--repo") repo = once(repo, value, optionValue);
			else if (value === "--label") label = once(label, value, normalizeLabel(optionValue));
			else if (value === "--base") base = once(base, value, optionValue);
			else if (value === "--head") head = once(head, value, optionValue);
			else if (value === "--model") model = once(model, value, optionValue);
			else if (value === "--provider") provider = once(provider, value, optionValue);
			else if (value === "--thinking") thinking = once(thinking, value, optionValue);
			else if (value === "--task-file") taskFile = once(taskFile, value, optionValue);
			else if (value === "--prepare") prepare = once(prepare, value, optionValue);
			else if (value === "--role") {
				role = once(role, value, optionValue.trim());
				if (!/^[a-z][a-z0-9-]*$/.test(role)) throw new Error("--role must be a lowercase name");
			} else if (value === "--engine") {
				engine = once(engine, value, optionValue.trim());
			} else timeoutMs = once(timeoutMs, value, parseDuration(optionValue));
		} else task.push(value);
	}
	if (review && role) throw new Error("--role and --review cannot be combined");
	if ((base || head) && !review) throw new Error("--base and --head require --review");
	// With --task-file the file is the task, so positional words can only be its title.
	if (taskFile && task.length) {
		if (label) throw new Error("with --task-file, give the title positionally or as --label, not both");
		label = normalizeLabel(task.join(" "));
	}
	if (!taskFile && (task.length === 0 || !task.join(" ").trim())) throw new Error("spawn requires task text");
	const out: SpawnOptions = { task: taskFile ? "" : task.join(" "), extensions, review, tab, detached, ...(role ? { role } : {}), ...(engine ? { engine } : {}) };
	if (label) out.label = label;
	if (taskFile) out.taskFile = taskFile;
	if (prepare) out.prepare = prepare;
	if (branch) out.branch = branch;
	if (base) out.base = base;
	if (head) out.head = head;
	if (repo) out.repo = repo;
	if (model) out.model = model;
	if (provider) out.provider = provider;
	if (thinking) out.thinking = thinking;
	if (timeoutMs) out.timeoutMs = timeoutMs;
	return out;
}
async function readSpawnTask(task: string, taskFile: string | undefined, cwd: string): Promise<{ text: string; bytes: Buffer; raw: boolean }> {
	const source = taskFile ?? (task === "-" ? "-" : undefined);
	if (!source) {
		if (/``| {2}/.test(task)) console.log("warning: empty backticks or doubled spaces in the task; single-quote it or pass --task-file");
		return { text: task, bytes: Buffer.from(task), raw: false };
	}
	const bytes = source === "-" ? readFileSync(0) : await readFile(resolve(cwd, source));
	const text = bytes.toString("utf8");
	if (!text.trim()) throw new Error("spawn requires task text");
	return { text, bytes, raw: true };
}
async function runPrepare(jobDir: string, worktree: string, command: string | undefined): Promise<void> {
	if (!command) return;
	const result = spawnSync(command, { cwd: worktree, shell: true, encoding: "utf8", timeout: Number(process.env.LIMEN_PREPARE_MS) || 300_000 });
	const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trimEnd();
	await appendLimenLog(jobDir, `prepare: ${command}${output ? `\n${output}` : ""}`);
	if (result.error || result.status !== 0) await appendLimenLog(jobDir, `prepare failed: ${result.error?.message ?? `exit ${result.status}`}`);
}
function probeVersion(command: string): Promise<string> {
	return new Promise((resolve) => {
		const child = spawn(command, ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
		let out = "";
		const timer = setTimeout(() => child.kill("SIGKILL"), 1_000);
		const done = (value: string) => {
			clearTimeout(timer);
			resolve(value);
		};
		child.stdout?.on("data", (chunk: Buffer | string) => (out += chunk));
		child.once("error", () => done("")).once("close", (code) => done(code === 0 ? (out.trim().split("\n")[0] ?? "") : ""));
	});
}
export async function capturedVersions(profile: EngineProfile): Promise<string> {
	const herdr = herdrBinary();
	const hunk = hunkBinary();
	const version = (await probeVersion(engineBinary(profile) || profile.binaryDefault)) || "unavailable";
	const herdrVersion = herdr && (await probeVersion(herdr));
	const hunkVersion = hunk && (await probeVersion(hunk));
	return `${profile.id} ${version}\n${herdrVersion ? `herdr ${herdrVersion}\n` : ""}${hunkVersion ? `hunk ${hunkVersion}\n` : ""}`;
}
function workspaceTask(task: string, root: string, repo: string): string {
	let rewritten = task;
	for (const { pointer, path } of ticketPointers(task)) {
		if (path.startsWith("spec/")) rewritten = rewritten.replace(pointer, pointer.replace(path, `${root}/${path}`));
	}
	return `Repository: ${repo}. Work only in this repository.\n\n${rewritten}`;
}
const once = <T>(current: T | undefined, flag: string, value: T): T => {
	if (current !== undefined) throw new Error(`${flag} may be supplied only once`);
	return value;
};
export function normalizeLabel(value: string): string {
	const label = value.trim();
	if (!label || /[\r\n]/.test(label)) throw new Error("--label must be one non-empty line");
	return label;
}
// The shell in a member's tab may put another installed Limen first on PATH; name the package that runs this group.
function memberRoute(run: GroupRun, team: string): string {
	const route = teamRoute(run, team);
	return `Limen command (use this path for every limen command): ${resolve(PACKAGE_ROOT, "bin/limen")}\nTeam worker launch settings (pass exactly): --engine ${run.engine} --provider ${route.provider} --model ${route.model} --thinking ${run.workerThinking}${run.teamExtensions ? "\nTeam extensions are inherited automatically. Omit --extension; keep the model flags above explicit." : ""}`;
}
export function currentNotificationSession(): string | undefined {
	const value = process.env.PI_SESSION_ID?.trim();
	if (value && !SESSION_ID.test(value)) throw new Error("PI_SESSION_ID is not safe for notification routing");
	return value || undefined;
}
/**
 * OMP does not export its session to tool commands, so a Herdr coordinator without a Pi session is woken on its pane.
 * `limen watch` and `steer --running` use the same route through `origin-pane`.
 */
export function herdrWakePane(notificationSession: string | undefined): string | undefined {
	const pane = process.env.HERDR_PANE_ID?.trim();
	if (notificationSession || process.env.HERDR_ENV !== "1" || !pane) return undefined;
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(pane)) throw new Error("HERDR_PANE_ID is not safe for wake routing");
	return pane;
}
async function liveJobUsesBranch(jobsRoot: string, branch: string, repo?: string): Promise<boolean> {
	for (const entry of await readdir(jobsRoot, { withFileTypes: true })) {
		const jobDir = `${jobsRoot}/${entry.name}`;
		if (entry.isDirectory() && (await text(`${jobDir}/branch`)) === branch && (!repo || (await text(`${jobDir}/repo`)) === repo) && (await liveJob(jobDir))) return true;
	}
	return false;
}
async function lastLimenDetail(jobDir: string): Promise<string> {
	const line = (await text(`${jobDir}/log`)).split("\n").findLast((entry) => entry.startsWith("[limen ")) ?? "";
	const close = line.indexOf("] ");
	return close === -1 ? line : line.slice(close + 2);
}
const text = async (path: string): Promise<string> => (await readFile(path, "utf8").catch(() => "")).trim();
export async function waitForHandshake(jobDir: string, wrapperPid: number, owner = "detached wrapper"): Promise<void> {
	const deadline = Date.now() + handshakeMs();
	while (Date.now() < deadline) {
		if ((await text(`${jobDir}/state`)) !== "running" || (await text(`${jobDir}/pid`))) return;
		await new Promise((resolve) => setTimeout(resolve, HANDSHAKE_POLL_MS));
	}
	signalProcessGroup(wrapperPid, "SIGTERM");
	if (!(await waitForProcessGroup(wrapperPid, 1_000))) {
		signalProcessGroup(wrapperPid, "SIGKILL");
		await waitForProcessGroup(wrapperPid, 1_000);
	}
	await finalizeJob(jobDir, "failed", `${owner} did not become ready`);
	throw new Error(`${owner} did not start; inspect the job record`);
}
