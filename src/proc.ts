import { spawn } from "node:child_process";
import { appendFile, open, readFile, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createStreamParser, type StreamEvent } from "./stream.ts";

const STOP_GRACE_MS = 5_000;
export async function atomicWrite(path: string, content: string): Promise<void> {
	const temporary = `${path}.${process.pid}.${Date.now().toString(16)}.tmp`;
	const handle = await open(temporary, "wx");
	try {
		await handle.writeFile(content);
		await handle.sync();
	} catch (error) {
		await handle.close();
		await rm(temporary, { force: true });
		throw error;
	}
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
export async function appendLimenLog(jobDir: string, message: string): Promise<void> {
	await appendFile(`${jobDir}/log`, `[limen ${new Date().toISOString()}] ${message}\n`);
}
export async function launchWrapper(environment: Readonly<Record<string, string>>): Promise<number> {
	const executable = fileURLToPath(new URL("../bin/limen", import.meta.url));
	const child = spawn(process.execPath, [executable], {
		detached: true,
		stdio: "ignore",
		env: { ...process.env, ...environment, LIMEN_INTERNAL_RUN: "1" },
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
	const jobDir = requiredEnvironment("LIMEN_JOB_DIR");
	const worktree = requiredEnvironment("LIMEN_WORKTREE");
	const taskFile = requiredEnvironment("LIMEN_TASK_FILE");
	const preambleFile = requiredEnvironment("LIMEN_PREAMBLE");
	const jobId = requiredEnvironment("LIMEN_JOB_ID");
	const label = process.env.LIMEN_LABEL || jobId;
	const timeoutMs = process.env.LIMEN_TIMEOUT_MS ? Number(process.env.LIMEN_TIMEOUT_MS) : undefined;
	const preamble = await readFile(preambleFile, "utf8");
	let stopRequested = false;
	let timedOut = false;
	let graceTimer: NodeJS.Timeout | undefined;
	let tools = 0;
	let pending = Promise.resolve();
	process.on("SIGTERM", () => {
		stopRequested = true;
	});
	const sessionDir = `${jobDir}/session`;
	const args = ["--mode", "json", "--approve", "--session-dir", sessionDir, "--name", `limen: ${label}`, "--append-system-prompt", preamble];
	if (process.env.LIMEN_MODEL) args.push("--model", process.env.LIMEN_MODEL);
	args.push(`@${taskFile}`);
	const childEnvironment: NodeJS.ProcessEnv = {
		...process.env,
		LIMEN_JOB: "1",
		LIMEN_JOB_ID: jobId,
		LIMEN_JOB_LABEL: label,
	};
	const privateEnvironment =
		"LIMEN_INTERNAL_RUN LIMEN_JOB_DIR LIMEN_WORKTREE LIMEN_TASK_FILE LIMEN_PREAMBLE LIMEN_TIMEOUT_MS LIMEN_MODEL LIMEN_LABEL PI_SESSION_ID PI_SESSION_FILE PI_PROVIDER PI_MODEL PI_REASONING_LEVEL";
	for (const name of privateEnvironment.split(" ")) delete childEnvironment[name];
	// A job is a detached process, not a Herdr pane; inherited Herdr context would misreport the coordinator's pane.
	for (const name of Object.keys(childEnvironment)) if (name.startsWith("HERDR_")) delete childEnvironment[name];
	const parser = createStreamParser();
	const seen = { activity: "" };
	const failLog = (error: unknown) => appendLimenLog(jobDir, `log write failed: ${error instanceof Error ? error.message : String(error)}`).catch(() => {});
	const apply = (events: readonly StreamEvent[]) => {
		pending = pending.then(() => recordEvents(jobDir, events, () => (tools += 1), seen)).catch(failLog);
	};
	const child = spawn(process.env.LIMEN_PI ?? "pi", args, {
		cwd: worktree,
		stdio: ["ignore", "pipe", "pipe"],
		env: childEnvironment,
	});
	child.stdout?.on("data", (chunk: Buffer | string) => apply(parser.push(chunk.toString())));
	child.stderr?.on("data", (chunk: Buffer | string) => {
		pending = pending.then(() => appendFile(`${jobDir}/log`, chunk.toString())).catch(failLog);
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
	await appendLimenLog(jobDir, "worker started");
	const timeout = timeoutMs
		? setTimeout(() => {
				timedOut = true;
				void appendLimenLog(jobDir, `timeout after ${timeoutMs}ms; sending TERM`);
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
	apply(parser.flush());
	await pending;
	if (timedOut) await finalizeJob(jobDir, "failed", `timeout after ${timeoutMs}ms`);
	else if (stopRequested || result.signal === "SIGTERM" || result.signal === "SIGKILL") {
		await finalizeJob(jobDir, "stopped", "process group interrupted");
	} else if (result.error) await finalizeJob(jobDir, "failed", result.error.message);
	else if (result.code === 0) await finalizeJob(jobDir, "done", "pi exited 0");
	else await finalizeJob(jobDir, "failed", `worker exited with code ${result.code ?? "unknown"}`);
}
export async function failInternalJob(error: unknown): Promise<void> {
	const jobDir = process.env.LIMEN_JOB_DIR;
	if (!jobDir) return;
	await finalizeJob(jobDir, "failed", error instanceof Error ? error.message : String(error));
}
export async function finalizeJob(jobDir: string, state: "done" | "failed" | "stopped", detail: string): Promise<void> {
	await appendLimenLog(jobDir, `${state}: ${detail}`);
	await atomicWrite(`${jobDir}/finished-at`, `${new Date().toISOString()}\n`);
	await atomicWrite(`${jobDir}/state`, `${state}\n`);
	await rm(`${jobDir}/pid`, { force: true });
}
async function recordEvents(jobDir: string, events: readonly StreamEvent[], nextCount: () => number, seen: { activity: string }): Promise<void> {
	for (const event of events) {
		if (event.kind === "tool") {
			seen.activity = "tool";
			await atomicWrite(`${jobDir}/last-tool`, `${event.name}\n`);
			await atomicWrite(`${jobDir}/activity`, "tool\n");
			await atomicWrite(`${jobDir}/tool-calls`, `${nextCount()}\n`);
			await appendFile(`${jobDir}/log`, event.detail ? `${event.name} ${event.detail}\n` : `${event.name}\n`);
		} else if (event.kind === "activity") {
			await atomicWrite(`${jobDir}/activity`, `${event.name}\n`);
			if (seen.activity !== event.name) await appendFile(`${jobDir}/log`, `${(seen.activity = event.name)}\n`);
		} else await appendFile(`${jobDir}/log`, `${event.line}\n`);
	}
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
