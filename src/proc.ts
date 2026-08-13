import { spawn } from "node:child_process";
import { appendFile, open, readFile, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const STOP_GRACE_MS = 5_000;
export async function atomicWrite(path: string, content: string): Promise<void> {
	const temporary = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
	const handle = await open(temporary, "wx");
	await handle.writeFile(content);
	await handle.sync();
	await handle.close();
	await rename(temporary, path);
}
export function processGroupAlive(pid: number): boolean {
	const result = signalProcessGroup(pid, 0);
	return result === "sent" || result === "denied";
}

export function signalProcessGroup(pid: number, signal: NodeJS.Signals | 0): "sent" | "missing" | "denied" {
	try {
		process.kill(-pid, signal);
		return "sent";
	} catch (error) {
		if (isCode(error, "ESRCH")) return "missing";
		if (isCode(error, "EPERM")) return "denied";
		throw error;
	}
}

export async function waitForProcessGroup(pid: number, milliseconds: number): Promise<boolean> {
	const deadline = Date.now() + milliseconds;
	while (processGroupAlive(pid) && Date.now() < deadline) await delay(100);
	return !processGroupAlive(pid);
}

export async function appendControlLog(jobDir: string, message: string): Promise<void> {
	await appendFile(`${jobDir}/log`, `[control ${new Date().toISOString()}] ${message}\n`);
}

export async function launchWrapper(environment: Readonly<Record<string, string>>): Promise<number> {
	const executable = fileURLToPath(new URL("../bin/control", import.meta.url));
	const child = spawn(process.execPath, [executable], {
		detached: true,
		stdio: "ignore",
		env: { ...process.env, ...environment, CONTROL_INTERNAL_RUN: "1" },
	});
	await new Promise<void>((resolve, reject) => {
		child.once("spawn", resolve);
		child.once("error", reject);
	});
	if (!child.pid) throw new Error("could not start the detached job wrapper");
	child.unref();
	return child.pid;
}

export async function runInternalJob(): Promise<void> {
	const jobDir = requiredEnvironment("CONTROL_JOB_DIR");
	const worktree = requiredEnvironment("CONTROL_WORKTREE");
	const taskFile = requiredEnvironment("CONTROL_TASK_FILE");
	const preambleFile = requiredEnvironment("CONTROL_PREAMBLE");
	const jobId = requiredEnvironment("CONTROL_JOB_ID");
	const label = process.env.CONTROL_LABEL || jobId;
	const timeoutMs = process.env.CONTROL_TIMEOUT_MS ? Number(process.env.CONTROL_TIMEOUT_MS) : undefined;
	const preamble = await readFile(preambleFile, "utf8");
	const log = await open(`${jobDir}/log`, "a");
	let stopRequested = false;
	let timedOut = false;
	let graceTimer: NodeJS.Timeout | undefined;
	process.on("SIGTERM", () => {
		stopRequested = true;
	});
	const args = [
		"--print",
		"--approve",
		"--no-session",
		"--no-context-files",
		"--name",
		`control: ${label}`,
		"--append-system-prompt",
		preamble,
	];
	if (process.env.CONTROL_MODEL) args.push("--model", process.env.CONTROL_MODEL);
	args.push(`@${taskFile}`);
	const childEnvironment: NodeJS.ProcessEnv = {
		...process.env,
		CONTROL_JOB: "1",
		CONTROL_JOB_ID: jobId,
		CONTROL_JOB_LABEL: label,
	};
	for (const name of [
		"CONTROL_INTERNAL_RUN",
		"CONTROL_JOB_DIR",
		"CONTROL_WORKTREE",
		"CONTROL_TASK_FILE",
		"CONTROL_PREAMBLE",
		"CONTROL_TIMEOUT_MS",
		"CONTROL_MODEL",
		"CONTROL_LABEL",
	]) {
		delete childEnvironment[name];
	}
	const child = spawn(process.env.CONTROL_PI ?? "pi", args, {
		cwd: worktree,
		stdio: ["ignore", log.fd, log.fd],
		env: childEnvironment,
	});
	const outcome = new Promise<{
		code: number | null;
		signal: NodeJS.Signals | null;
		error?: Error;
	}>((resolve) => {
		child.once("error", (error) => resolve({ code: null, signal: null, error }));
		child.once("close", (code, signal) => resolve({ code, signal }));
	});
	await atomicWrite(`${jobDir}/pid`, `${process.pid}\n`);
	await atomicWrite(`${jobDir}/state`, "running\n");
	const timeout = timeoutMs
		? setTimeout(() => {
				timedOut = true;
				void appendControlLog(jobDir, `timeout after ${timeoutMs}ms; sending TERM`);
				signalProcessGroup(process.pid, "SIGTERM");
				graceTimer = setTimeout(() => {
					void finalizeJob(jobDir, "failed", `timeout after ${timeoutMs}ms`).then(() => {
						signalProcessGroup(process.pid, "SIGKILL");
					});
				}, STOP_GRACE_MS);
			}, timeoutMs)
		: undefined;
	const result = await outcome;
	if (timeout) clearTimeout(timeout);
	if (graceTimer) clearTimeout(graceTimer);
	await log.close();
	if (timedOut) await finalizeJob(jobDir, "failed", `timeout after ${timeoutMs}ms`);
	else if (stopRequested || result.signal === "SIGTERM" || result.signal === "SIGKILL") {
		await finalizeJob(jobDir, "stopped", "process group interrupted");
	} else if (result.error) await finalizeJob(jobDir, "failed", result.error.message);
	else if (result.code === 0) await finalizeJob(jobDir, "done", "worker exited successfully");
	else await finalizeJob(jobDir, "failed", `worker exited with code ${result.code ?? "unknown"}`);
}

export async function failInternalJob(error: unknown): Promise<void> {
	const jobDir = process.env.CONTROL_JOB_DIR;
	if (!jobDir) return;
	await finalizeJob(jobDir, "failed", error instanceof Error ? error.message : String(error));
}

export async function finalizeJob(jobDir: string, state: "done" | "failed" | "stopped", detail: string): Promise<void> {
	await appendControlLog(jobDir, `${state}: ${detail}`);
	await atomicWrite(`${jobDir}/finished-at`, `${new Date().toISOString()}\n`);
	await atomicWrite(`${jobDir}/state`, `${state}\n`);
	await rm(`${jobDir}/pid`, { force: true });
}

function requiredEnvironment(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`internal job wrapper is missing ${name}`);
	return value;
}

function isCode(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
