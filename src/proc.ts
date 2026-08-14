import { execFile, spawn } from "node:child_process";
import { appendFile, open, readFile, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createStreamParser, type StreamEvent } from "./stream.ts";

const STOP_GRACE_MS = 5_000;
const ESCAPED_TERM_GRACE_MS = 2_000;
const ESCAPED_KILL_GRACE_MS = 1_000;
export type JobProcess = { readonly pid: number; readonly pgid: number; readonly command: string };
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
	return signalTarget(-pid, signal);
}
function signalTarget(target: number, signal: NodeJS.Signals | 0): "sent" | "missing" | "denied" {
	try {
		process.kill(target, signal);
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
export function processAlive(pid: number): boolean {
	return signalTarget(pid, 0) !== "missing";
}
// Descendants of the wrapper that left its process group (setsid or equivalent). Snapshot while the
// parent chain is still alive: once intermediate processes die, escapees re-parent to init and are
// no longer attributable to the job. Best effort by design; a failed ps yields an empty list.
export async function listEscapedDescendants(rootPid: number): Promise<readonly JobProcess[]> {
	const table = await processTable();
	const escaped: JobProcess[] = [];
	const seen = new Set([rootPid]);
	const queue = [rootPid];
	for (let parent = queue.shift(); parent !== undefined; parent = queue.shift()) {
		for (const row of table) {
			if (row.ppid !== parent || seen.has(row.pid)) continue;
			seen.add(row.pid);
			queue.push(row.pid);
			if (row.pgid !== rootPid) escaped.push({ pid: row.pid, pgid: row.pgid, command: row.command });
		}
	}
	return escaped;
}
// Best-effort TERM, wait, KILL against processes the job started outside its group — never a
// pattern kill. Survivors become a durable cleanup note; nothing here blocks state transitions.
export async function containEscapedDescendants(jobDir: string, escaped: readonly JobProcess[], context: string): Promise<void> {
	if (escaped.length === 0) return;
	await appendLimenLog(jobDir, `terminating ${escaped.length} escaped job process(es): ${escaped.map((p) => p.pid).join(", ")}`);
	for (const p of escaped) signalTarget(p.pid, "SIGTERM");
	await waitForPids(escaped, ESCAPED_TERM_GRACE_MS);
	const stubborn = escaped.filter((p) => processAlive(p.pid));
	for (const p of stubborn) signalTarget(p.pid, "SIGKILL");
	await waitForPids(stubborn, ESCAPED_KILL_GRACE_MS);
	const survivors = escaped.filter((p) => processAlive(p.pid));
	if (survivors.length > 0) await recordCleanup(jobDir, survivors, context);
}
export async function recordCleanup(jobDir: string, survivors: readonly JobProcess[], context: string): Promise<void> {
	const header = `[limen ${new Date().toISOString()}] termination unconfirmed ${context}: ${survivors.length} surviving process(es)`;
	const lines = survivors.map((p) => `${p.pid} ${p.command}`);
	await atomicWrite(`${jobDir}/cleanup`, `${[header, ...lines].join("\n")}\n`);
	await appendLimenLog(jobDir, `cleanup note written: surviving pid(s) ${survivors.map((p) => p.pid).join(", ")}`);
}
async function waitForPids(processes: readonly JobProcess[], milliseconds: number): Promise<void> {
	const deadline = Date.now() + milliseconds;
	while (processes.some((p) => processAlive(p.pid)) && Date.now() < deadline) await delay(100);
}
async function processTable(): Promise<ReadonlyArray<JobProcess & { readonly ppid: number }>> {
	const output = await new Promise<string>((resolve) => {
		execFile("ps", ["-Ao", "pid=,pgid=,ppid=,command="], { maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => resolve(error ? "" : stdout));
	});
	const rows: Array<JobProcess & { readonly ppid: number }> = [];
	for (const line of output.split("\n")) {
		const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
		if (match) rows.push({ pid: Number(match[1]), pgid: Number(match[2]), ppid: Number(match[3]), command: (match[4] ?? "").trim() });
	}
	return rows;
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
	let escapedAtTimeout: Promise<readonly JobProcess[]> = Promise.resolve([]);
	const timeout = timeoutMs
		? setTimeout(() => {
				timedOut = true;
				// Snapshot escaped descendants before TERM: once pi dies they re-parent to init and become untraceable.
				escapedAtTimeout = listEscapedDescendants(process.pid).catch(() => []);
				void escapedAtTimeout.then(async () => {
					await appendLimenLog(jobDir, `timeout after ${timeoutMs}ms; sending TERM`);
					signalProcessGroup(process.pid, "SIGTERM");
				});
				graceTimer = setTimeout(() => {
					void (async () => {
						await containEscapedDescendants(jobDir, await escapedAtTimeout, "after timeout");
						await finalizeJob(jobDir, "failed", `timeout after ${timeoutMs}ms`);
						signalProcessGroup(process.pid, "SIGKILL");
					})();
				}, STOP_GRACE_MS);
			}, timeoutMs)
		: undefined;
	const result = await outcome;
	if (timeout) clearTimeout(timeout);
	if (graceTimer) clearTimeout(graceTimer);
	apply(parser.flush());
	await pending;
	if (timedOut) {
		await containEscapedDescendants(jobDir, await escapedAtTimeout, "after timeout");
		await finalizeJob(jobDir, "failed", `timeout after ${timeoutMs}ms`);
	} else if (stopRequested || result.signal === "SIGTERM" || result.signal === "SIGKILL") {
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
