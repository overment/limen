import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	addBranchWorktree,
	addDetachedWorktree,
	addNewWorktree,
	branchExists,
	repoRoot,
	worktreeForBranch,
} from "../git.ts";
import { parseDuration } from "../job.ts";
import {
	atomicWrite,
	finalizeJob,
	launchWrapper,
	processGroupAlive,
	signalProcessGroup,
	waitForProcessGroup,
} from "../proc.ts";

type SpawnOptions = {
	task: string;
	label: string;
	branch?: string;
	model?: string;
	timeoutMs?: number;
	review: boolean;
};
const TEMPLATE_ROOT = fileURLToPath(new URL("../../templates", import.meta.url));
export async function spawnCommand(args: readonly string[], cwd: string): Promise<void> {
	const options = parseSpawnArgs(args);
	const root = repoRoot(cwd);
	const id = makeJobId(options.label);
	const jobsRoot = `${root}/.control/jobs`;
	await mkdir(jobsRoot, { recursive: true });
	const running = await countRunning(jobsRoot);
	if (running > 0) console.log(`note: ${running} job${running === 1 ? "" : "s"} already running; starting another`);
	const branch = options.branch ?? `control/${id}`;
	const worktreeRoot = `${dirname(root)}/.${basename(root)}-control-worktrees`;
	const requestedPath = `${worktreeRoot}/${id}`;
	await mkdir(worktreeRoot, { recursive: true });
	let worktree: string;
	if (options.review) {
		if (!options.branch) throw new Error("--review requires --branch <candidate-branch>");
		if (!branchExists(root, branch)) throw new Error(`candidate branch ${branch} does not exist`);
		addDetachedWorktree(root, requestedPath, branch);
		worktree = requestedPath;
	} else if (branchExists(root, branch)) {
		const existing = worktreeForBranch(root, branch);
		if (existing && resolve(existing.path) === resolve(root)) {
			throw new Error(`branch ${branch} is checked out in the primary worktree; isolation is impossible`);
		}
		if (await liveJobUsesBranch(jobsRoot, branch)) throw new Error(`branch ${branch} already has a live job`);
		if (existing) worktree = existing.path;
		else {
			addBranchWorktree(root, requestedPath, branch);
			worktree = requestedPath;
		}
	} else {
		addNewWorktree(root, requestedPath, branch);
		worktree = requestedPath;
	}
	const jobDir = `${jobsRoot}/${id}`;
	await mkdir(jobDir);
	await Promise.all([
		writeFile(`${jobDir}/task.md`, `${options.task.trim()}\n`, { flag: "wx", flush: true }),
		writeFile(`${jobDir}/label`, `${options.label}\n`, { flag: "wx", flush: true }),
		writeFile(`${jobDir}/branch`, `${branch}\n`, { flag: "wx", flush: true }),
		writeFile(`${jobDir}/started-at`, `${new Date().toISOString()}\n`, { flag: "wx", flush: true }),
		writeFile(`${jobDir}/tool-calls`, "0\n", { flag: "wx", flush: true }),
		writeFile(`${jobDir}/last-tool`, "", { flag: "wx", flush: true }),
		writeFile(`${jobDir}/log`, "", { flag: "wx", flush: true }),
	]);
	await atomicWrite(`${jobDir}/state`, "running\n");
	const localPreamble = `${root}/.agents/control/${options.review ? "reviewer" : "worker"}.md`;
	const preamble = (await fileExists(localPreamble))
		? localPreamble
		: `${TEMPLATE_ROOT}/${options.review ? "reviewer" : "worker"}.md`;
	const environment: Record<string, string> = {
		CONTROL_JOB_DIR: jobDir,
		CONTROL_WORKTREE: worktree,
		CONTROL_TASK_FILE: `${jobDir}/task.md`,
		CONTROL_PREAMBLE: preamble,
		CONTROL_JOB_ID: id,
		CONTROL_LABEL: options.label,
	};
	if (options.model) environment.CONTROL_MODEL = options.model;
	if (options.timeoutMs) environment.CONTROL_TIMEOUT_MS = String(options.timeoutMs);
	let wrapperPid: number;
	try {
		wrapperPid = await launchWrapper(environment);
	} catch (error) {
		await finalizeJob(
			jobDir,
			"failed",
			`failed to launch wrapper: ${error instanceof Error ? error.message : String(error)}`,
		);
		throw error;
	}
	await waitForHandshake(jobDir, wrapperPid);
	console.log(`started ${options.label}`);
	console.log(id);
}
function parseSpawnArgs(args: readonly string[]): SpawnOptions {
	let branch: string | undefined;
	let label: string | undefined;
	let model: string | undefined;
	let timeoutMs: number | undefined;
	let review = false;
	let positional = false;
	const task: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const value = args[index];
		if (!value) continue;
		if (value === "--") positional = true;
		else if (!positional && value === "--review") review = true;
		else if (
			!positional &&
			(value === "--branch" || value === "--label" || value === "--model" || value === "--timeout")
		) {
			const optionValue = args[index + 1];
			if (!optionValue) throw new Error(`${value} requires a value`);
			index += 1;
			if (value === "--branch") {
				if (branch) throw new Error("--branch may be supplied only once");
				branch = optionValue;
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
		label: label ?? defaultLabel(taskText),
		review,
		...(branch ? { branch } : {}),
		...(model ? { model } : {}),
		...(timeoutMs ? { timeoutMs } : {}),
	};
}

function defaultLabel(task: string): string {
	return task.trim().split(/\r?\n/, 1)[0]?.trim().slice(0, 80) || "job";
}

function normalizeLabel(value: string): string {
	const label = value.trim();
	if (!label || /[\r\n]/.test(label)) throw new Error("--label must be one non-empty line");
	return label;
}

function makeJobId(label: string): string {
	const date = new Date().toISOString().slice(0, 10);
	const slug =
		label
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 32) || "job";
	return `${date}-${slug}-${randomBytes(2).toString("hex")}`;
}

async function countRunning(jobsRoot: string): Promise<number> {
	const { readdir } = await import("node:fs/promises");
	const entries = await readdir(jobsRoot, { withFileTypes: true });
	let count = 0;
	for (const entry of entries) if (entry.isDirectory() && (await liveJob(`${jobsRoot}/${entry.name}`))) count += 1;
	return count;
}

async function liveJobUsesBranch(jobsRoot: string, branch: string): Promise<boolean> {
	const { readdir } = await import("node:fs/promises");
	const entries = await readdir(jobsRoot, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const jobDir = `${jobsRoot}/${entry.name}`;
		if ((await text(`${jobDir}/branch`)) === branch && (await liveJob(jobDir))) return true;
	}
	return false;
}

async function liveJob(jobDir: string): Promise<boolean> {
	if ((await text(`${jobDir}/state`)) !== "running") return false;
	const pid = Number(await text(`${jobDir}/pid`));
	return Number.isSafeInteger(pid) && pid > 0 && processGroupAlive(pid);
}

async function text(path: string): Promise<string> {
	return readFile(path, "utf8").then(
		(value) => value.trim(),
		() => "",
	);
}

async function fileExists(path: string): Promise<boolean> {
	return readFile(path).then(
		() => true,
		() => false,
	);
}

async function waitForHandshake(jobDir: string, wrapperPid: number): Promise<void> {
	const deadline = Date.now() + 2_000;
	while (Date.now() < deadline) {
		const state = await text(`${jobDir}/state`);
		if (state !== "running" || (await text(`${jobDir}/pid`))) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	signalProcessGroup(wrapperPid, "SIGTERM");
	if (!(await waitForProcessGroup(wrapperPid, 1_000))) {
		signalProcessGroup(wrapperPid, "SIGKILL");
		await waitForProcessGroup(wrapperPid, 1_000);
	}
	await finalizeJob(jobDir, "failed", "detached wrapper did not become ready");
	throw new Error("detached job wrapper did not start; inspect the job record");
}
