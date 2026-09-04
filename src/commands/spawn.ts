import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { signalProcessGroup, waitForProcessGroup } from "../contain.ts";
import {
	addBranchWorktree,
	addDetachedWorktree,
	addNewWorktree,
	branchCommit,
	branchExists,
	headCommit,
	repoRoot,
	workspaceRepository,
	workspaceRoot,
	worktreeForBranch,
} from "../git.ts";
import { herdrAvailable, openHostedTab, openWatchTab } from "../herdr.ts";
import { parseDuration } from "../job.ts";
import { liveJob } from "../reap.ts";
import { appendLimenLog, atomicWrite, finalizeJob, launchHostedSupervisor, launchWrapper } from "../wrapper.ts";
import { hunkBinary } from "./diff.ts";
import { pruneFinishedWorktrees } from "./prune.ts";

type SpawnOptions = {
	task: string;
	taskFile?: string;
	label?: string;
	branch?: string;
	repo?: string;
	model?: string;
	timeoutMs?: number;
	prepare?: string;
	review: boolean;
	tab: boolean;
	detached: boolean;
};
const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const HOSTED_NOTE =
	"Hosted job: weaker guarantees. No 90-minute timeout, no tool-call cap, no F007 process containment. Herdr owns the process tree. Closing the tab ends the worker.\n";
export function preflightPi(model?: string): void {
	if (!(process.env.PATH ?? "").split(":").some((dir) => dir && existsSync(`${dir}/pi`))) throw new Error("pi is not on PATH");
	if (process.env.LIMEN_PREFLIGHT !== "auth") return;
	const result = spawnSync(process.env.LIMEN_PI || "pi", ["auth", "check", ...(model ? ["--model", model] : [])], { encoding: "utf8" });
	if (result.status !== 0) throw new Error((result.stderr || result.stdout || result.error?.message || "pi auth check failed").trim() || "pi auth check failed");
}
type WorktreePlan =
	| { readonly kind: "detach"; readonly path: string; readonly ref: string }
	| { readonly kind: "reuse"; readonly path: string }
	| { readonly kind: "add-branch"; readonly path: string; readonly branch: string }
	| { readonly kind: "add-new"; readonly path: string; readonly branch: string };
const HANDSHAKE_POLL_MS = 20;
const handshakeMs = (): number => (Number(process.env.LIMEN_HANDSHAKE_MS) > 0 ? Number(process.env.LIMEN_HANDSHAKE_MS) : 10_000);
export async function spawnCommand(args: readonly string[], cwd: string): Promise<void> {
	const parsed = parseSpawnArgs(args);
	const herdr = herdrAvailable();
	const tab = parsed.detached ? false : parsed.tab || herdr;
	if (parsed.tab && parsed.detached) throw new Error("--tab and --detached cannot be combined");
	if (tab && parsed.timeoutMs) throw new Error("hosted jobs have no timeout; omit --timeout or use --detached");
	if (tab && !herdr) throw new Error("hosted spawn requires Herdr (HERDR_ENV=1); use --detached for an ordinary job");
	const loaded = await readSpawnTask(parsed.task, parsed.taskFile, cwd);
	const options = { ...parsed, tab, task: loaded.text, label: parsed.label ?? (loaded.text.trim().split(/\r?\n/, 1)[0]?.trim().slice(0, 80) || "job") };
	const model = options.model ?? (process.env[options.review ? "LIMEN_REVIEWER_MODEL" : "LIMEN_WORKER_MODEL"]?.trim() || undefined);
	preflightPi(model);
	const notificationSession = currentNotificationSession();
	const coordinatorTab = process.env.HERDR_TAB_ID?.trim();
	const role = options.review ? "reviewer" : "worker";
	const workspace = workspaceRoot(cwd);
	const root = workspace ?? repoRoot(cwd);
	if (workspace && !options.repo) throw new Error("workspace spawn requires --repo <immediate-child>");
	if (!workspace && options.repo) throw new Error("--repo is available only from a non-Git workspace coordinator");
	const repository = workspace ? workspaceRepository(root, options.repo ?? "") : root;
	const task = loaded.raw ? loaded.text : workspace ? workspaceTask(options.task, root, options.repo ?? "") : options.task;
	const id = makeJobId(options.label);
	const jobsRoot = `${root}/.limen/jobs`;
	await mkdir(jobsRoot, { recursive: true });
	let running = 0,
		held = false;
	for (const entry of await readdir(jobsRoot, { withFileTypes: true })) {
		if (entry.isDirectory() && (await liveJob(`${jobsRoot}/${entry.name}`))) (running += 1), (held ||= (await text(`${jobsRoot}/${entry.name}/label`)) === options.label);
	}
	if (running > 0) console.log(`note: ${running} job${running === 1 ? "" : "s"} already running; starting another`);
	if (/^F\d{3,}$/i.test(options.label)) console.log("warning: label is only a feature number");
	if (held) console.log("warning: a live job already holds this label");
	const branch = options.branch ?? `limen/${id}`;
	const worktreeRoot = `${dirname(repository)}/.${basename(repository)}-limen-worktrees`;
	const requestedPath = `${worktreeRoot}/${id}`;
	await mkdir(worktreeRoot, { recursive: true });
	const worktree = executeWorktree(
		repository,
		await planWorktree({
			root: repository,
			requestedPath,
			branch,
			review: options.review,
			jobsRoot,
			...(workspace ? { repo: options.repo ?? "" } : {}),
			...(options.branch ? { requestedBranch: options.branch } : {}),
		}),
	);
	await pruneFinishedWorktrees(root, [worktree]).catch(() => {});
	const candidate = options.review ? branchCommit(repository, branch) : undefined;
	const base = headCommit(worktree);
	const jobDir = `${jobsRoot}/${id}`;
	await mkdir(jobDir);
	try {
		await mkdir(`${jobDir}/notify/subscribers`, { recursive: true });
		const taskBody = loaded.raw ? loaded.bytes : candidate ? `${task.trim()}\n\nCandidate commit: ${candidate}.\n` : `${task.trim()}\n`;
		await Promise.all([
			writeFile(`${jobDir}/task.md`, taskBody, { flag: "wx", flush: true }),
			...(candidate ? [writeFile(`${jobDir}/candidate`, `${candidate}\n`, { flag: "wx", flush: true })] : []),
			writeFile(`${jobDir}/label`, `${options.label}\n`, { flag: "wx", flush: true }),
			writeFile(`${jobDir}/branch`, `${branch}\n`, { flag: "wx", flush: true }),
			writeFile(`${jobDir}/worktree`, `${worktree}\n`, { flag: "wx", flush: true }),
			writeFile(`${jobDir}/base`, `${base}\n`, { flag: "wx", flush: true }),
			...(workspace ? [writeFile(`${jobDir}/repo`, `${options.repo}\n`, { flag: "wx", flush: true })] : []),
			writeFile(`${jobDir}/started-at`, `${new Date().toISOString()}\n`, { flag: "wx", flush: true }),
			writeFile(`${jobDir}/tool-calls`, "0\n", { flag: "wx", flush: true }),
			writeFile(`${jobDir}/last-tool`, "", { flag: "wx", flush: true }),
			writeFile(`${jobDir}/activity`, "think\n", { flag: "wx", flush: true }),
			writeFile(`${jobDir}/log`, "", { flag: "wx", flush: true }),
			...(options.tab
				? [
						writeFile(`${jobDir}/hosted`, HOSTED_NOTE, { flag: "wx", flush: true }),
						writeFile(`${jobDir}/role`, `${role}\n`, { flag: "wx", flush: true }),
						writeFile(`${jobDir}/agent-name`, `${hostedAgentName(id)}\n`, { flag: "wx", flush: true }),
					]
				: []),
			...(notificationSession
				? [
						writeFile(`${jobDir}/origin-session`, `${notificationSession}\n`, { flag: "wx", flush: true }),
						writeFile(`${jobDir}/notify/subscribers/${notificationSession}`, `${new Date().toISOString()}\n`, { flag: "wx", flush: true }),
					]
				: []),
			...(coordinatorTab ? [writeFile(`${jobDir}/origin-tab`, `${coordinatorTab}\n`, { flag: "wx", flush: true })] : []),
		]);
		await writeFile(`${jobDir}/notify/ready`, "1\n", { flag: "wx", flush: true });
		await runPrepare(jobDir, worktree, parsed.prepare ?? process.env.LIMEN_PREPARE?.trim());
	} catch (error) {
		await rm(jobDir, { recursive: true, force: true });
		throw error;
	}
	const versions = capturedVersions().then((text) => writeFile(`${jobDir}/versions`, text, { flag: "wx", flush: true }));
	await atomicWrite(`${jobDir}/state`, "running\n");
	const localPreamble = `${root}/.agents/limen/${role}.md`;
	const preamble = await readFile(localPreamble).then(
		() => localPreamble,
		() => `${PACKAGE_ROOT}/templates/${role}.md`,
	);
	if (options.tab) {
		await startHosted({ jobDir, id, label: options.label, root, worktree, preamble, taskFile: `${jobDir}/task.md`, role, ...(model ? { model } : {}) });
		await versions.catch(() => {});
		console.log(`started ${options.label} (hosted)`);
		console.log(id);
		return;
	}
	await openWatchTab({ jobDir, label: options.label, cwd: root, logPath: `${jobDir}/log` });
	const environment: Record<string, string> = {
		LIMEN_JOB_DIR: jobDir,
		LIMEN_WORKTREE: worktree,
		LIMEN_TASK_FILE: `${jobDir}/task.md`,
		LIMEN_PREAMBLE: preamble,
		LIMEN_JOB_ID: id,
		LIMEN_LABEL: options.label,
		LIMEN_CONTEXT_ROOT: root,
	};
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
	readonly role: "worker" | "reviewer";
	readonly model?: string;
	readonly continueFile?: string;
}): Promise<void> {
	const agentName = hostedAgentName(input.id);
	try {
		await openHostedTab({
			jobDir: input.jobDir,
			label: input.label,
			cwd: input.worktree,
			workspaceCwd: input.root,
			env: {
				LIMEN_JOB: "1",
				LIMEN_HOSTED: "1",
				LIMEN_JOB_ID: input.id,
				LIMEN_JOB_LABEL: input.label,
				LIMEN_CONTEXT_ROOT: input.root,
				LIMEN_ROLE: input.role,
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
			LIMEN_AGENT_NAME: agentName,
			LIMEN_HOSTED_START: "1",
			LIMEN_MODEL: input.model ?? "",
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
	if (existing && resolve(existing.path) === resolve(root)) throw new Error(`branch ${branch} is checked out in the primary worktree; isolation is impossible`);
	if (await liveJobUsesBranch(input.jobsRoot, branch, input.repo)) throw new Error(`branch ${branch} already has a live job`);
	return existing ? { kind: "reuse", path: existing.path } : { kind: "add-branch", path, branch };
}
function executeWorktree(root: string, plan: WorktreePlan): string {
	if (plan.kind === "detach") addDetachedWorktree(root, plan.path, plan.ref);
	if (plan.kind === "add-branch") addBranchWorktree(root, plan.path, plan.branch);
	if (plan.kind === "add-new") addNewWorktree(root, plan.path, plan.branch);
	return plan.path;
}
function parseSpawnArgs(args: readonly string[]): SpawnOptions {
	let branch: string | undefined, repo: string | undefined, label: string | undefined, model: string | undefined;
	let timeoutMs: number | undefined, taskFile: string | undefined, prepare: string | undefined;
	let review = false,
		tab = false,
		detached = false,
		positional = false;
	const task: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const value = args[index];
		if (!value) continue;
		if (value === "--") positional = true;
		else if (!positional && value === "--review") review = true;
		else if (!positional && value === "--tab") tab = true;
		else if (!positional && value === "--detached") detached = true;
		else if (!positional && value.startsWith("--")) {
			if (value !== "--branch" && value !== "--repo" && value !== "--label" && value !== "--model" && value !== "--timeout" && value !== "--task-file" && value !== "--prepare")
				throw new Error(`unknown spawn option ${value}`);
			const optionValue = args[index + 1];
			if (!optionValue) throw new Error(`${value} requires a value`);
			index += 1;
			if (value === "--branch") branch = once(branch, value, optionValue);
			else if (value === "--repo") repo = once(repo, value, optionValue);
			else if (value === "--label") label = once(label, value, normalizeLabel(optionValue));
			else if (value === "--model") model = once(model, value, optionValue);
			else if (value === "--task-file") taskFile = once(taskFile, value, optionValue);
			else if (value === "--prepare") prepare = once(prepare, value, optionValue);
			else timeoutMs = once(timeoutMs, value, parseDuration(optionValue));
		} else task.push(value);
	}
	if (taskFile && task.length) throw new Error("spawn accepts a positional task or --task-file, not both");
	if (!taskFile && (task.length === 0 || !task.join(" ").trim())) throw new Error("spawn requires task text");
	const out: SpawnOptions = { task: task.join(" "), review, tab, detached };
	if (label) out.label = label;
	if (taskFile) out.taskFile = taskFile;
	if (prepare) out.prepare = prepare;
	if (branch) out.branch = branch;
	if (repo) out.repo = repo;
	if (model) out.model = model;
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
export async function capturedVersions(): Promise<string> {
	const herdr = process.env.LIMEN_HERDR?.trim();
	const hunk = hunkBinary();
	const pi = (await probeVersion(process.env.LIMEN_PI || "pi")) || "unavailable";
	const extra = herdr !== "0" && (await probeVersion(herdr || "herdr"));
	const hunkVersion = hunk && (await probeVersion(hunk));
	return `pi ${pi}\n${extra ? `herdr ${extra}\n` : ""}${hunkVersion ? `hunk ${hunkVersion}\n` : ""}`;
}
function workspaceTask(task: string, root: string, repo: string): string {
	const pointer = task.replace(/\bTicket: (spec\/\S+)/g, (_all, path: string) => `Ticket: ${root}/${path}`);
	return `Repository: ${repo}. Work only in this repository.\n\n${pointer}`;
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
export function makeJobId(label: string): string {
	const feature = /\bf(\d{3,})\b/i.exec(label)?.[0]?.toLowerCase();
	const rest = label.toLowerCase().replace(/\bf\d{3,}\b|[^a-z0-9]+/gi, "-");
	const slug = `${feature ? `${feature}-` : ""}${rest.replace(/^-+|-+$/g, "")}`.replace(/-+$/, "").slice(0, 32) || "job";
	return `${new Date().toISOString().slice(0, 10)}-${slug}-${randomBytes(4).toString("hex")}`;
}
export function hostedAgentName(jobId: string): string {
	const hex = /[0-9a-f]{8}$/.exec(jobId)?.[0] ?? "";
	const feature = /(?:^|-)(f\d{3,})(?:-|$)/i.exec(jobId)?.[1]?.toLowerCase();
	if (feature && hex) return `limen-${feature}-${hex}`;
	const cut = jobId.slice(0, hex ? -9 : undefined).toLowerCase();
	const dashed = cut.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/[^a-z0-9_-]+/g, "-");
	const slug = dashed.replace(/^[^a-z]+/, "").slice(0, 17) || "job";
	return hex ? `limen-${slug}-${hex}` : `limen-${slug}`.slice(0, 32);
}
export function currentNotificationSession(): string | undefined {
	const value = process.env.PI_SESSION_ID?.trim();
	if (value && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error("PI_SESSION_ID is not safe for notification routing");
	return value || undefined;
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
	if (!(await waitForProcessGroup(wrapperPid, 1_000))) signalProcessGroup(wrapperPid, "SIGKILL"), await waitForProcessGroup(wrapperPid, 1_000);
	await finalizeJob(jobDir, "failed", `${owner} did not become ready`);
	throw new Error(`${owner} did not start; inspect the job record`);
}
