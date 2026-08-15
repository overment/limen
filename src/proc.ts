import { spawn } from "node:child_process";
import { appendFile, open, readFile, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { hostedAgentStatus, renameJobTab } from "./herdr.ts";
import { createStreamParser, type StreamEvent } from "./stream.ts";

const STOP_GRACE_MS = 5_000;
const ESCAPED_TERM_GRACE_MS = 2_000;
const ESCAPED_KILL_GRACE_MS = 1_000;
const PROCESS_QUERY_TIMEOUT_MS = 1_000;
const PROCESS_QUERY_MAX_BYTES = 1024 * 1024;
const PIDINFO_HELPER = fileURLToPath(new URL("./proc-pidinfo.rb", import.meta.url));
// A job is one short turn. These bounds stop a silent runaway from burning a session; they are not a review gate.
export const DEFAULT_TIMEOUT_MS = 90 * 60_000;
export const MAX_TOOL_CALLS = 900;
const toolCallCap = (): number => Number(process.env.LIMEN_MAX_TOOL_CALLS) || MAX_TOOL_CALLS;
export type ProcessIdentity = { readonly pid: number; readonly born: string };
export type JobProcess = ProcessIdentity & { readonly pgid: number; readonly command: string };
type ProcessInfo = JobProcess & { readonly ppid: number };
export type ProcessQueryOutcome = { readonly kind: "present"; readonly process: ProcessInfo } | { readonly kind: "absent" } | { readonly kind: "unavailable" };
type ProcessTableRow = { readonly pid: number; readonly ppid: number; readonly pgid: number; readonly state: string };
type ContainmentDependencies = {
	readonly query?: (pid: number) => Promise<ProcessQueryOutcome>;
	readonly signal?: (pid: number, signal: NodeJS.Signals) => "sent" | "missing" | "denied";
};
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
// Snapshot ancestry before the wrapper group dies; proc_pidinfo supplies the identity used to signal.
export async function listEscapedDescendants(rootPid: number): Promise<readonly JobProcess[]> {
	const deadline = Date.now() + PROCESS_QUERY_TIMEOUT_MS;
	const table = await processTable(deadline);
	const root = table.find((row) => row.pid === rootPid);
	if (!root || root.state.startsWith("Z")) throw new Error(`root process ${rootPid} was missing or terminal in process snapshot`);
	const escaped: Array<{ pid: number; pgid: number }> = [],
		seen = new Set([rootPid]),
		queue = [rootPid];
	let liveJobDescendant = false;
	for (let parent = queue.shift(); parent !== undefined; parent = queue.shift())
		for (const row of table) {
			if (row.ppid !== parent || seen.has(row.pid)) continue;
			seen.add(row.pid);
			queue.push(row.pid);
			if (!row.state.startsWith("Z")) liveJobDescendant = true;
			if (row.pgid !== rootPid) escaped.push(row);
		}
	// The wrapper needs a live Pi child: an empty post-TERM tree is attribution loss, not proof that no detached child escaped.
	if (!liveJobDescendant) throw new Error(`root process ${rootPid} was missing or terminal in process snapshot`);
	const captured = await Promise.all(
		escaped.map(async (row): Promise<JobProcess | undefined> => {
			const outcome = await processInfo(row.pid, deadline);
			return outcome.kind === "present" ? outcome.process : outcome.kind === "unavailable" ? { ...row, born: "identity-unavailable", command: "identity unavailable" } : undefined;
		}),
	);
	return captured.filter((process): process is JobProcess => process !== undefined);
}
// Discovery failure is advisory but durable; callers await only this bounded pre-TERM snapshot.
export async function discoverEscapedDescendants(jobDir: string, rootPid: number, context: string): Promise<readonly JobProcess[]> {
	try {
		return await listEscapedDescendants(rootPid);
	} catch (error) {
		const message = `escaped descendant discovery failed ${context}: ${error instanceof Error ? error.message : String(error)}`;
		await recordCleanupWarning(jobDir, message);
		return [];
	}
}
// Each individual signal gets a fresh birth check. Only an exact present identity may be signaled.
export async function containEscapedDescendants(jobDir: string, escaped: readonly JobProcess[], context: string, dependencies: ContainmentDependencies = {}): Promise<void> {
	if (escaped.length === 0) return;
	const query = dependencies.query ?? processInfo,
		signal = dependencies.signal ?? signalTarget,
		warned: JobProcess[] = [];
	const check = async (process: JobProcess): Promise<"same" | "changed" | "absent" | "unavailable"> => {
		const outcome = await query(process.pid);
		if (outcome.kind !== "present") return outcome.kind;
		return outcome.process.pid === process.pid && outcome.process.born === process.born ? "same" : "changed";
	};
	const signalIfPresent = async (process: JobProcess, signalName: NodeJS.Signals, recordChanged: boolean) => {
		const outcome = await check(process);
		if (outcome === "same") {
			signal(process.pid, signalName);
			return true;
		}
		if (outcome === "unavailable" || (recordChanged && outcome === "changed")) warned.push(process);
		return false;
	};
	await appendLimenLog(jobDir, `terminating ${escaped.length} escaped job process(es): ${escaped.map((p) => p.pid).join(", ")}`);
	const termed: JobProcess[] = [];
	for (const process of escaped) if (await signalIfPresent(process, "SIGTERM", true)) termed.push(process);
	if (termed.length) await delay(ESCAPED_TERM_GRACE_MS);
	const killed: JobProcess[] = [];
	for (const process of termed) if (await signalIfPresent(process, "SIGKILL", false)) killed.push(process);
	if (killed.length) await delay(ESCAPED_KILL_GRACE_MS);
	for (const process of killed) if (["same", "unavailable"].includes(await check(process))) warned.push(process);
	const unique = [...new Map(warned.map((process) => [`${process.pid}:${process.born}`, process])).values()];
	if (unique.length) await recordCleanup(jobDir, unique, context);
}
export async function recordCleanup(jobDir: string, processes: readonly JobProcess[], context: string): Promise<void> {
	const header = `[limen ${new Date().toISOString()}] termination unconfirmed ${context}: ${processes.length} process(es) require attention`;
	await atomicWrite(`${jobDir}/cleanup`, `${[header, ...processes.map((p) => `${p.pid} ${p.born} ${p.command}`)].join("\n")}\n`);
	await appendLimenLog(jobDir, `cleanup note written: unconfirmed pid(s) ${processes.map((p) => p.pid).join(", ")}`);
}
export async function processInfo(pid: number, deadline = Date.now() + PROCESS_QUERY_TIMEOUT_MS): Promise<ProcessQueryOutcome> {
	if (!Number.isSafeInteger(pid) || pid <= 0) return { kind: "unavailable" };
	try {
		const value: unknown = JSON.parse(await runBounded("/usr/bin/ruby", [PIDINFO_HELPER, String(pid)], "proc_pidinfo", deadline));
		if (isProcessInfo(value, pid)) return { kind: "present", process: value };
		if (typeof value === "object" && value !== null && (value as Record<string, unknown>).status === "absent") return { kind: "absent" };
		return { kind: "unavailable" };
	} catch {
		return { kind: "unavailable" };
	}
}
async function processTable(deadline: number): Promise<readonly ProcessTableRow[]> {
	let scannerPid: number | undefined;
	const output = await runBounded("ps", ["-Ao", "pid=,pgid=,ppid=,stat="], "ps discovery", deadline, (pid) => {
		scannerPid = pid;
	});
	return output.split("\n").flatMap((line) => {
		const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*$/.exec(line);
		if (!match || Number(match[1]) === scannerPid || !match[4]) return [];
		return [{ pid: Number(match[1]), pgid: Number(match[2]), ppid: Number(match[3]), state: match[4] }];
	});
}
async function runBounded(command: string, args: readonly string[], description: string, deadline: number, onSpawn?: (pid: number) => void): Promise<string> {
	return new Promise((resolve, reject) => {
		const remaining = deadline - Date.now();
		if (remaining <= 0) return reject(new Error(`${description} exceeded the process-query deadline`));
		const child = spawn(command, args, { detached: true, stdio: ["ignore", "pipe", "ignore"] });
		if (child.pid) onSpawn?.(child.pid);
		let stdout = "",
			settled = false;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			if (error) reject(error);
			else resolve(stdout);
		};
		const terminate = () => {
			if (child.pid) signalProcessGroup(child.pid, "SIGKILL");
		};
		const timeout = setTimeout(() => {
			terminate();
			finish(new Error(`${description} exceeded the process-query deadline`));
		}, remaining);
		child.stdout?.on("data", (chunk: Buffer | string) => {
			stdout += chunk.toString();
			if (Buffer.byteLength(stdout) > PROCESS_QUERY_MAX_BYTES) {
				terminate();
				finish(new Error(`${description} exceeded ${PROCESS_QUERY_MAX_BYTES} bytes`));
			}
		});
		child.once("error", (error) => finish(error));
		child.once("close", (code, signal) => finish(code === 0 ? undefined : new Error(`${description} exited with ${signal ?? `code ${code ?? "unknown"}`}`)));
	});
}
async function recordCleanupWarning(jobDir: string, warning: string): Promise<void> {
	await atomicWrite(`${jobDir}/cleanup`, `[limen ${new Date().toISOString()}] ${warning}\n`).catch(() => {});
	await appendLimenLog(jobDir, `cleanup warning: ${warning}`).catch(() => {});
}
function isProcessInfo(value: unknown, pid: number): value is ProcessInfo {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return (
		candidate.pid === pid &&
		typeof candidate.ppid === "number" &&
		Number.isSafeInteger(candidate.ppid) &&
		candidate.ppid >= 0 &&
		typeof candidate.pgid === "number" &&
		Number.isSafeInteger(candidate.pgid) &&
		candidate.pgid > 0 &&
		typeof candidate.born === "string" &&
		/^\d+\.\d{6}$/.test(candidate.born) &&
		typeof candidate.command === "string"
	);
}
export async function appendLimenLog(jobDir: string, message: string): Promise<void> {
	await appendFile(`${jobDir}/log`, `[limen ${new Date().toISOString()}] ${message}\n`);
}
export async function launchWrapper(environment: Readonly<Record<string, string>>): Promise<number> {
	return launchDetached({ ...environment, LIMEN_INTERNAL_RUN: "1" });
}
export async function launchHostedSupervisor(environment: Readonly<Record<string, string>>): Promise<number> {
	return launchDetached({ ...environment, LIMEN_INTERNAL_HOSTED: "1" });
}
async function launchDetached(environment: Readonly<Record<string, string>>): Promise<number> {
	const executable = fileURLToPath(new URL("../bin/limen", import.meta.url));
	const child = spawn(process.execPath, [executable], {
		detached: true,
		stdio: "ignore",
		env: { ...process.env, ...environment },
	});
	await new Promise<void>((resolve, reject) => {
		child.once("spawn", resolve);
		child.once("error", reject);
	});
	if (!child.pid) throw new Error("could not start the detached job wrapper");
	child.unref();
	return child.pid;
}
/** Watch a Herdr-hosted agent and publish terminal state when it ends. No timeout or containment. */
export async function runHostedSupervisor(): Promise<void> {
	const jobDir = requiredEnvironment("LIMEN_JOB_DIR");
	const target = requiredEnvironment("LIMEN_HOSTED_TARGET");
	await atomicWrite(`${jobDir}/pid`, `${process.pid}\n`);
	await atomicWrite(`${jobDir}/state`, "running\n");
	await appendLimenLog(jobDir, "hosted supervisor started (weaker guarantees: no timeout, no tool-call cap, no process containment)");
	let stopRequested = false;
	process.on("SIGTERM", () => {
		stopRequested = true;
	});
	while (!stopRequested) {
		const status = hostedAgentStatus(target);
		if (status === "missing" || status === "done") {
			await finalizeJob(jobDir, "done", status === "done" ? "hosted agent done" : "hosted agent ended");
			return;
		}
		const activity = status === "working" ? "think" : "wait";
		await atomicWrite(`${jobDir}/activity`, `${activity}\n`).catch(() => {});
		await delay(1_000);
	}
	await finalizeJob(jobDir, "stopped", "hosted supervisor interrupted");
}
export async function runInternalJob(): Promise<void> {
	const jobDir = requiredEnvironment("LIMEN_JOB_DIR");
	const worktree = requiredEnvironment("LIMEN_WORKTREE");
	const taskFile = requiredEnvironment("LIMEN_TASK_FILE");
	const preambleFile = requiredEnvironment("LIMEN_PREAMBLE");
	const jobId = requiredEnvironment("LIMEN_JOB_ID");
	const label = process.env.LIMEN_LABEL || jobId;
	const timeoutMs = process.env.LIMEN_TIMEOUT_MS ? Number(process.env.LIMEN_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
	const preamble = await readFile(preambleFile, "utf8");
	let stopRequested = false;
	let exhausted: string | undefined;
	let graceTimer: NodeJS.Timeout | undefined;
	let tools = 0;
	let pending = Promise.resolve();
	process.on("SIGTERM", () => {
		stopRequested = true;
	});
	let exhaustionTermination = Promise.resolve();
	const exhaust = (reason: string) => {
		if (exhausted || stopRequested) return;
		exhausted = reason;
		exhaustionTermination = (async () => {
			// Complete the bounded ownership snapshot while the parent chain is intact, then signal.
			const escaped = await discoverEscapedDescendants(jobDir, process.pid, "during exhaustion");
			await appendLimenLog(jobDir, `${reason}; sending TERM`).catch(() => {});
			signalProcessGroup(process.pid, "SIGTERM");
			graceTimer = setTimeout(() => signalProcessGroup(process.pid, "SIGKILL"), STOP_GRACE_MS);
			void containEscapedDescendants(jobDir, escaped, "after exhaustion").catch(() => {});
			await finalizeJob(jobDir, "failed", reason);
		})();
	};
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
		pending = pending
			.then(() =>
				recordEvents(
					jobDir,
					events,
					() => {
						tools += 1;
						if (tools >= toolCallCap()) exhaust(`tool-call cap reached after ${tools} calls`);
						return tools;
					},
					seen,
				),
			)
			.catch(failLog);
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
	const timeout = setTimeout(() => exhaust(`timeout after ${timeoutMs}ms`), timeoutMs);
	const result = await outcome;
	clearTimeout(timeout);
	if (graceTimer && !exhausted) clearTimeout(graceTimer);
	apply(parser.flush());
	await pending;
	if (exhausted) {
		// Keep the wrapper alive through its pre-TERM snapshot and durable failure write.
		await exhaustionTermination;
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
	await renameJobTab(jobDir, state);
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
