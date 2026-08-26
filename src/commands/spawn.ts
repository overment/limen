import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
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
import { herdrAvailable, hostedAgentAlive, openHostedTab, openWatchTab, startHostedPi } from "../herdr.ts";
import { parseDuration } from "../job.ts";
import { liveJob } from "../reap.ts";
import { appendLimenLog, atomicWrite, finalizeJob, launchHostedSupervisor, launchWrapper } from "../wrapper.ts";
import { pruneFinishedWorktrees } from "./prune.ts";

type SpawnOptions = {
	task: string;
	label: string;
	branch?: string;
	repo?: string;
	model?: string;
	timeoutMs?: number;
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
const handshakeMs = (): number => {
	const raw = Number(process.env.LIMEN_HANDSHAKE_MS);
	return Number.isFinite(raw) && raw > 0 ? raw : 10_000;
};
export async function spawnCommand(args: readonly string[], cwd: string): Promise<void> {
	const parsed = parseSpawnArgs(args);
	const herdr = herdrAvailable();
	const tab = parsed.detached ? false : parsed.tab || herdr;
	const options = { ...parsed, tab };
	if (parsed.tab && parsed.detached) throw new Error("--tab and --detached cannot be combined");
	if (options.tab && parsed.timeoutMs) throw new Error("hosted jobs have no timeout; omit --timeout or use --detached");
	if (options.tab && !herdr) throw new Error("hosted spawn requires Herdr (HERDR_ENV=1); use --detached for an ordinary job");
	const model = options.model ?? (process.env[options.review ? "LIMEN_REVIEWER_MODEL" : "LIMEN_WORKER_MODEL"]?.trim() || undefined);
	preflightPi(model);
	const notificationSession = currentNotificationSession();
	const coordinatorTab = process.env.HERDR_TAB_ID?.trim();
	const workspace = workspaceRoot(cwd);
	const root = workspace ?? repoRoot(cwd);
	if (workspace && !options.repo) throw new Error("workspace spawn requires --repo <immediate-child>");
	if (!workspace && options.repo) throw new Error("--repo is available only from a non-Git workspace coordinator");
	const repository = workspace ? workspaceRepository(root, options.repo ?? "") : root;
	const task = workspace ? workspaceTask(options.task, root, options.repo ?? "") : options.task;
	const id = makeJobId(options.label);
	const jobsRoot = `${root}/.limen/jobs`;
	await mkdir(jobsRoot, { recursive: true });
	const running = await countRunning(jobsRoot);
	if (running > 0) console.log(`note: ${running} job${running === 1 ? "" : "s"} already running; starting another`);
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
	const jobDir = `${jobsRoot}/${id}`;
	await mkdir(jobDir);
	await mkdir(`${jobDir}/notify/subscribers`, { recursive: true });
	await Promise.all([
		writeFile(`${jobDir}/task.md`, candidate ? `${task.trim()}\n\nCandidate commit: ${candidate}.\n` : `${task.trim()}\n`, { flag: "wx", flush: true }),
		...(candidate ? [writeFile(`${jobDir}/candidate`, `${candidate}\n`, { flag: "wx", flush: true })] : []),
		writeFile(`${jobDir}/label`, `${options.label}\n`, { flag: "wx", flush: true }),
		writeFile(`${jobDir}/branch`, `${branch}\n`, { flag: "wx", flush: true }),
		writeFile(`${jobDir}/worktree`, `${worktree}\n`, { flag: "wx", flush: true }),
		writeFile(`${jobDir}/base`, `${headCommit(worktree)}\n`, { flag: "wx", flush: true }),
		...(workspace ? [writeFile(`${jobDir}/repo`, `${options.repo}\n`, { flag: "wx", flush: true })] : []),
		writeFile(`${jobDir}/started-at`, `${new Date().toISOString()}\n`, { flag: "wx", flush: true }),
		writeFile(`${jobDir}/tool-calls`, "0\n", { flag: "wx", flush: true }),
		writeFile(`${jobDir}/last-tool`, "", { flag: "wx", flush: true }),
		writeFile(`${jobDir}/activity`, "think\n", { flag: "wx", flush: true }),
		writeFile(`${jobDir}/log`, "", { flag: "wx", flush: true }),
		...(options.tab ? [writeFile(`${jobDir}/hosted`, HOSTED_NOTE, { flag: "wx", flush: true })] : []),
		...(notificationSession
			? [
					writeFile(`${jobDir}/origin-session`, `${notificationSession}\n`, { flag: "wx", flush: true }),
					writeFile(`${jobDir}/notify/subscribers/${notificationSession}`, `${new Date().toISOString()}\n`, { flag: "wx", flush: true }),
				]
			: []),
		...(coordinatorTab ? [writeFile(`${jobDir}/origin-tab`, `${coordinatorTab}\n`, { flag: "wx", flush: true })] : []),
	]);
	await writeFile(`${jobDir}/notify/ready`, "1\n", { flag: "wx", flush: true });
	const versions = capturedVersions().then((text) => writeFile(`${jobDir}/versions`, text, { flag: "wx", flush: true }));
	await atomicWrite(`${jobDir}/state`, "running\n");
	const role = options.review ? "reviewer" : "worker";
	const localPreamble = `${root}/.agents/limen/${role}.md`;
	const preamble = await readFile(localPreamble).then(
		() => localPreamble,
		() => `${PACKAGE_ROOT}/templates/${role}.md`,
	);
	if (options.tab) {
		await startHosted({ jobDir, id, label: options.label, root, worktree, preamble, taskFile: `${jobDir}/task.md`, review: options.review, ...(model ? { model } : {}) });
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
	readonly review: boolean;
	readonly model?: string;
	readonly continueText?: string;
}): Promise<void> {
	const paneEnv = {
		LIMEN_JOB: "1",
		LIMEN_HOSTED: "1",
		LIMEN_JOB_ID: input.id,
		LIMEN_JOB_LABEL: input.label,
		LIMEN_CONTEXT_ROOT: input.root,
		LIMEN_ROLE: input.review ? "reviewer" : "worker",
	};
	let place: Awaited<ReturnType<typeof openHostedTab>> | undefined;
	let target = "";
	const agentName = hostedAgentName(input.id);
	try {
		place = await openHostedTab({ jobDir: input.jobDir, label: input.label, cwd: input.worktree, workspaceCwd: input.root, env: paneEnv });
		const extensions = ["hosted", "steering", "communication"].flatMap((name) => ["--extension", `${PACKAGE_ROOT}/hook/${name}.ts`]);
		const piArgs = [
			"--approve",
			"--no-extensions",
			"--session-dir",
			`${input.jobDir}/session`,
			"--name",
			`limen: ${input.label}`,
			"--append-system-prompt",
			input.preamble,
			...extensions,
			...(input.model ? ["--model", input.model] : []),
			...(input.continueText !== undefined ? ["--continue", input.continueText] : [`@${input.taskFile}`]),
		];
		target = startHostedPi({
			place,
			name: agentName,
			args: piArgs,
			log: (line) => void appendLimenLog(input.jobDir, line).catch(() => {}),
		});
		await writeFile(`${input.jobDir}/herdr/agent`, `${target}\n`);
		const supervisorPid = await launchHostedSupervisor({
			LIMEN_JOB_DIR: input.jobDir,
			LIMEN_HOSTED_TARGET: target,
			LIMEN_AGENT_NAME: agentName,
			LIMEN_JOB_ID: input.id,
			LIMEN_LABEL: input.label,
			LIMEN_CONTEXT_ROOT: input.root,
			LIMEN_ROLE: input.review ? "reviewer" : "worker",
		});
		// Known at launch — never run the detached handshake killer against a live hosted agent.
		await atomicWrite(`${input.jobDir}/pid`, `${supervisorPid}\n`);
		await atomicWrite(`${input.jobDir}/state`, "running\n");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const recovered = [target, place?.pane].find((value) => value && hostedAgentAlive(value));
		if (recovered) {
			await writeFile(`${input.jobDir}/herdr/agent`, `${recovered}\n`);
			const supervisorPid = await launchHostedSupervisor({
				LIMEN_JOB_DIR: input.jobDir,
				LIMEN_HOSTED_TARGET: recovered,
				LIMEN_AGENT_NAME: agentName,
				LIMEN_JOB_ID: input.id,
				LIMEN_LABEL: input.label,
				LIMEN_CONTEXT_ROOT: input.root,
				LIMEN_ROLE: input.review ? "reviewer" : "worker",
			});
			await atomicWrite(`${input.jobDir}/pid`, `${supervisorPid}\n`);
			await atomicWrite(`${input.jobDir}/state`, "running\n");
			await appendLimenLog(input.jobDir, `hosted agent ready after start warning: ${message}`);
			return;
		}
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
	let branch: string | undefined;
	let repo: string | undefined;
	let label: string | undefined;
	let model: string | undefined;
	let timeoutMs: number | undefined;
	let review = false;
	let tab = false;
	let detached = false;
	let positional = false;
	const task: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const value = args[index];
		if (!value) continue;
		if (value === "--") positional = true;
		else if (!positional && value === "--review") review = true;
		else if (!positional && value === "--tab") tab = true;
		else if (!positional && value === "--detached") detached = true;
		else if (!positional && (value === "--branch" || value === "--repo" || value === "--label" || value === "--model" || value === "--timeout")) {
			const optionValue = args[index + 1];
			if (!optionValue) throw new Error(`${value} requires a value`);
			index += 1;
			if (value === "--branch") {
				if (branch) throw new Error("--branch may be supplied only once");
				branch = optionValue;
			} else if (value === "--repo") {
				if (repo) throw new Error("--repo may be supplied only once");
				repo = optionValue;
			} else if (value === "--label") {
				if (label) throw new Error("--label may be supplied only once");
				label = normalizeLabel(optionValue);
			} else if (value === "--model") {
				if (model) throw new Error("--model may be supplied only once");
				model = optionValue;
			} else {
				if (timeoutMs) throw new Error("--timeout may be supplied only once");
				timeoutMs = parseDuration(optionValue);
			}
		} else if (!positional && value.startsWith("--")) throw new Error(`unknown spawn option ${value}`);
		else task.push(value);
	}
	if (task.length === 0 || !task.join(" ").trim()) throw new Error("spawn requires task text");
	const taskText = task.join(" ");
	return {
		task: taskText,
		label: label ?? (taskText.trim().split(/\r?\n/, 1)[0]?.trim().slice(0, 80) || "job"),
		review,
		tab,
		detached,
		...(branch ? { branch } : {}),
		...(repo ? { repo } : {}),
		...(model ? { model } : {}),
		...(timeoutMs ? { timeoutMs } : {}),
	};
}
function probeVersion(command: string): Promise<string> {
	return new Promise((resolve) => {
		const child = spawn(command, ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
		let out = "";
		const done = (value: string) => {
			clearTimeout(timer);
			resolve(value);
		};
		const timer = setTimeout(() => child.kill("SIGKILL"), 1_000);
		child.stdout?.on("data", (chunk: Buffer | string) => (out += chunk));
		child.once("error", () => done("")).once("close", (code) => done(code === 0 ? (out.trim().split("\n")[0] ?? "") : ""));
	});
}
export async function capturedVersions(): Promise<string> {
	const herdr = process.env.LIMEN_HERDR?.trim();
	const pi = (await probeVersion(process.env.LIMEN_PI || "pi")) || "unavailable";
	const extra = herdr !== "0" && (await probeVersion(herdr || "herdr"));
	return extra ? `pi ${pi}\nherdr ${extra}\n` : `pi ${pi}\n`;
}
function workspaceTask(task: string, root: string, repo: string): string {
	const pointer = task.replace(/\bTicket: (spec\/\S+)/g, (_all, path: string) => `Ticket: ${root}/${path}`);
	return `Repository: ${repo}. Work only in this repository.\n\n${pointer}`;
}
export function normalizeLabel(value: string): string {
	const label = value.trim();
	if (!label || /[\r\n]/.test(label)) throw new Error("--label must be one non-empty line");
	return label;
}
export function makeJobId(label: string): string {
	const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
	return `${new Date().toISOString().slice(0, 10)}-${slug.replace(/^-|-$/g, "").slice(0, 32) || "job"}-${randomBytes(4).toString("hex")}`;
}
/** Herdr agent names: lowercase letter start, [a-z0-9_-], max 32. Feature number + hex suffix keeps the unique part inside any width; slug fallback when the label has no feature number. */
export function hostedAgentName(jobId: string): string {
	const hex = /[0-9a-f]{8}$/.exec(jobId)?.[0] ?? "";
	const feature = /(?:^|-)(f\d{3,})(?:-|$)/i.exec(jobId)?.[1]?.toLowerCase();
	if (feature && hex) return `limen-${feature}-${hex}`;
	const slug =
		jobId
			.slice(0, hex ? -9 : undefined)
			.toLowerCase()
			.replace(/^\d{4}-\d{2}-\d{2}-/, "")
			.replace(/[^a-z0-9_-]+/g, "-")
			.replace(/^[^a-z]+/, "")
			.slice(0, 17) || "job";
	return hex ? `limen-${slug}-${hex}` : `limen-${slug}`.slice(0, 32);
}
export function currentNotificationSession(): string | undefined {
	const value = process.env.PI_SESSION_ID?.trim();
	if (value && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error("PI_SESSION_ID is not safe for notification routing");
	return value || undefined;
}
async function countRunning(jobsRoot: string): Promise<number> {
	const entries = await readdir(jobsRoot, { withFileTypes: true });
	let count = 0;
	for (const entry of entries) if (entry.isDirectory() && (await liveJob(`${jobsRoot}/${entry.name}`))) count += 1;
	return count;
}
async function liveJobUsesBranch(jobsRoot: string, branch: string, repo?: string): Promise<boolean> {
	const entries = await readdir(jobsRoot, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const jobDir = `${jobsRoot}/${entry.name}`;
		if ((await text(`${jobDir}/branch`)) === branch && (!repo || (await text(`${jobDir}/repo`)) === repo) && (await liveJob(jobDir))) return true;
	}
	return false;
}
async function lastLimenDetail(jobDir: string): Promise<string> {
	const line = (await text(`${jobDir}/log`)).split("\n").findLast((entry) => entry.startsWith("[limen "));
	if (!line) return "";
	const close = line.indexOf("] ");
	return close === -1 ? line : line.slice(close + 2);
}
async function text(path: string): Promise<string> {
	return readFile(path, "utf8").then(
		(value) => value.trim(),
		() => "",
	);
}
export async function waitForHandshake(jobDir: string, wrapperPid: number): Promise<void> {
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
	await finalizeJob(jobDir, "failed", "detached wrapper did not become ready");
	throw new Error("detached job wrapper did not start; inspect the job record");
}
