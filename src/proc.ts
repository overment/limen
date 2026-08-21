import { spawn } from "node:child_process";
import { appendFile, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { commitList } from "./git.ts";
import { type HostedAgentStatus, hostedAgentAlive, hostedAgentStatus, hostedTerminalReason, locateHostedAgent, renameJobTab } from "./herdr.ts";
import { assistantStopReason, assistantText, createStreamParser, type StreamEvent } from "./stream.ts";

const STOP_GRACE_MS = 5_000;
const HOSTED_UNKNOWN_SAMPLES = 5;
const ESCAPED_TERM_GRACE_MS = 2_000;
const ESCAPED_KILL_GRACE_MS = 1_000;
const PROCESS_QUERY_TIMEOUT_MS = 1_000;
const PROCESS_QUERY_MAX_BYTES = 1024 * 1024;
const PIDINFO_HELPER = fileURLToPath(new URL("./proc-pidinfo.rb", import.meta.url));
const HOOK = fileURLToPath(new URL("../hook", import.meta.url));
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
export const STARTUP_GRACE_MS = 10 * 60_000;
export const DEFAULT_HOSTED_IDLE_MS = 60_000;
export type HostedIdleWatch = { leftWorkingAt: number | undefined; armed: boolean };
export function hostedIdleMs(): number {
	const raw = Number(process.env.LIMEN_HOSTED_IDLE_MS);
	return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_HOSTED_IDLE_MS;
}
export async function liveJob(jobDir: string, now = Date.now()): Promise<boolean> {
	if ((await textFile(`${jobDir}/state`)) !== "running") return false;
	const pid = Number(await textFile(`${jobDir}/pid`));
	const recorded = Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
	if (recorded !== undefined && (await wrapperAlive(recorded, await textFile(`${jobDir}/born`)))) return true;
	const agent = await textFile(`${jobDir}/herdr/agent`);
	if ((await textFile(`${jobDir}/hosted`)) && agent && hostedAgentAlive(agent)) return true;
	if (recorded !== undefined) return false;
	const startedAt = Date.parse(await textFile(`${jobDir}/started-at`));
	return Number.isFinite(startedAt) && now - startedAt < STARTUP_GRACE_MS;
}
async function wrapperAlive(pid: number, born: string): Promise<boolean> {
	if (!processGroupAlive(pid)) return false;
	if (!born) return true;
	const outcome = await processInfo(pid);
	return outcome.kind === "present" ? outcome.process.born === born : outcome.kind !== "absent";
}
export async function reapDeadJobs(jobsRoot: string, seen: Map<string, number>, now = Date.now()): Promise<void> {
	for (const id of await readdir(jobsRoot).catch(() => [] as string[])) {
		const jobDir = `${jobsRoot}/${id}`;
		if ((await textFile(`${jobDir}/state`)) !== "running") {
			seen.delete(id);
			continue;
		}
		const startedAt = Date.parse(await textFile(`${jobDir}/started-at`));
		const pid = Number(await textFile(`${jobDir}/pid`));
		if (!Number.isFinite(startedAt) || now - startedAt < STARTUP_GRACE_MS || !Number.isSafeInteger(pid) || pid <= 0 || (await liveJob(jobDir, now))) {
			seen.delete(id);
			continue;
		}
		const first = seen.get(id);
		if (first === undefined) {
			seen.set(id, now);
			continue;
		}
		if (now - first < reapConfirmMs()) continue;
		if (await textFile(`${jobDir}/hosted`)) await writeHostedResult(jobDir);
		await finalizeJob(jobDir, "failed", "process group gone");
		seen.delete(id);
	}
}
export async function confirmDeadJobs(jobsRoot: string): Promise<void> {
	const seen = new Map<string, number>();
	await reapDeadJobs(jobsRoot, seen);
	if (seen.size === 0) return;
	await delay(reapConfirmMs());
	await reapDeadJobs(jobsRoot, seen);
}
function reapConfirmMs(): number {
	const raw = Number(process.env.LIMEN_REAP_CONFIRM_MS);
	return Number.isFinite(raw) && raw > 0 ? raw : 10_000;
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
/** Watch a Herdr-hosted agent and publish terminal state when the session really ends. */
export async function runHostedSupervisor(): Promise<void> {
	const jobDir = requiredEnvironment("LIMEN_JOB_DIR");
	let target = requiredEnvironment("LIMEN_HOSTED_TARGET");
	await writeHandshake(jobDir);
	await atomicWrite(`${jobDir}/state`, "running\n");
	await appendLimenLog(jobDir, "hosted supervisor started (weaker guarantees: no timeout, no tool-call cap, no process containment)");
	let stopRequested = false;
	let missingStreak = 0;
	let unknownStreak = 0;
	let unknownAliveNoted = false;
	process.on("SIGTERM", () => {
		stopRequested = true;
	});
	const idle: HostedIdleWatch = { leftWorkingAt: undefined, armed: true };
	while (!stopRequested) {
		const status = hostedAgentStatus(target);
		const sessionEnded = Boolean(await textFile(`${jobDir}/session-ended`));
		// Herdr idle/done = unseen background tab. Not job completion. Missing needs 3 samples.
		if (status === "missing") missingStreak += 1;
		else if (status === "unknown") unknownStreak += 1;
		else {
			missingStreak = 0;
			unknownStreak = 0;
			unknownAliveNoted = false;
		}
		// A moved pane or degraded Herdr must neither stall finalize forever nor kill a live worker.
		if ((missingStreak > 0 || unknownStreak >= HOSTED_UNKNOWN_SAMPLES) && !sessionEnded) {
			const located = locateHostedAgent(target, process.env.LIMEN_AGENT_NAME?.trim() ?? "");
			if (located) {
				if (located !== target) {
					await atomicWrite(`${jobDir}/herdr/agent`, `${located}\n`);
					await atomicWrite(`${jobDir}/herdr/pane`, `${located}\n`);
					await appendLimenLog(jobDir, `hosted agent relocated ${target} -> ${located}`);
					target = located;
				} else if (status === "unknown" && !unknownAliveNoted) {
					unknownAliveNoted = true;
					await appendLimenLog(jobDir, `herdr cannot classify the hosted agent (${HOSTED_UNKNOWN_SAMPLES} samples); the recorded pane still runs pi`);
				}
				missingStreak = 0;
				unknownStreak = 0;
			} else if (unknownStreak >= HOSTED_UNKNOWN_SAMPLES) {
				// The probe confirms gone despite unclassifiable status; let the missing window decide.
				missingStreak += 1;
				unknownStreak = 0;
			}
		}
		const reason = sessionEnded ? hostedTerminalReason(status, true) : missingStreak >= 3 ? hostedTerminalReason(status, false) : undefined;
		if (reason) {
			const requested = await textFile(`${jobDir}/stop-requested`);
			if (!requested) await writeHostedResult(jobDir);
			await finalizeJob(jobDir, requested ? "stopped" : "done", requested || reason);
			return;
		}
		await noteHostedIdle(jobDir, status, idle);
		await delay(1_000);
	}
	await finalizeJob(jobDir, "stopped", "hosted supervisor interrupted");
}
/** One stall notice while the hosted session stays open. Re-arm only after the agent works again. */
export async function noteHostedIdle(jobDir: string, status: HostedAgentStatus, watch: HostedIdleWatch, now = Date.now(), thresholdMs = hostedIdleMs()): Promise<void> {
	if (status === "working") {
		watch.leftWorkingAt = undefined;
		if (!watch.armed) {
			watch.armed = true;
			await clearHostedAdvisory(jobDir);
		}
		return;
	}
	if (status !== "idle" && status !== "done" && status !== "blocked") return;
	// Herdr idle/done is not a stall while the agent is still in a turn (think/tool).
	if (status !== "blocked" && (await textFile(`${jobDir}/activity`)) !== "wait") {
		watch.leftWorkingAt = undefined;
		return;
	}
	if (watch.leftWorkingAt === undefined) watch.leftWorkingAt = now;
	if (!watch.armed) return;
	const stalled = status === "blocked" || now - watch.leftWorkingAt >= thresholdMs;
	if (!stalled) return;
	const tools = Number(await textFile(`${jobDir}/tool-calls`));
	const count = Number.isSafeInteger(tools) && tools > 0 ? tools : 0;
	if (status !== "blocked" && count < 1) return;
	const elapsed = now - watch.leftWorkingAt;
	const duration = elapsed < 60_000 ? `${Math.max(1, Math.round(elapsed / 1000))}s` : `${Math.round(elapsed / 60_000)}m`;
	const line = status === "blocked" ? `blocked after ${count} tool calls, session still open` : `idle ${duration} after ${count} tool calls, session still open`;
	await writeHostedResult(jobDir);
	await recordCommits(jobDir).catch(() => {});
	await atomicWrite(`${jobDir}/advisory`, `${line}\n`);
	watch.armed = false;
	await appendLimenLog(jobDir, `advisory: ${line}`).catch(() => {});
}
async function clearHostedAdvisory(jobDir: string): Promise<void> {
	await rm(`${jobDir}/advisory`, { force: true });
	for (const dir of [`${jobDir}/notify/claims`, `${jobDir}/notify/delivered`, `${jobDir}/notify/herdr`]) {
		for (const name of await readdir(dir).catch(() => [] as string[])) {
			if (name.startsWith("_advisory.")) await rm(`${dir}/${name}`, { recursive: true, force: true });
		}
	}
}
async function textFile(path: string): Promise<string> {
	return readFile(path, "utf8").then(
		(value) => value.trim(),
		() => "",
	);
}
async function writeHandshake(jobDir: string): Promise<void> {
	await atomicWrite(`${jobDir}/pid`, `${process.pid}\n`);
	void recordBorn(jobDir);
}
async function recordBorn(jobDir: string): Promise<void> {
	const outcome = await processInfo(process.pid);
	if (outcome.kind !== "present" || ["done", "failed", "stopped"].includes(await textFile(`${jobDir}/state`))) return;
	await atomicWrite(`${jobDir}/born`, `${outcome.process.born}\n`);
}
/** Last assistant message from the newest hosted session jsonl. A session that died mid-turn leaves no result; that absence is information. */
async function writeHostedResult(jobDir: string): Promise<void> {
	try {
		const newest = (await readdir(`${jobDir}/session`))
			.filter((name) => name.endsWith(".jsonl"))
			.sort()
			.at(-1);
		if (!newest) return;
		let last = "",
			stop = "";
		for (const line of (await readFile(`${jobDir}/session/${newest}`, "utf8")).split("\n")) {
			if (!line.trim()) continue;
			try {
				const entry: unknown = JSON.parse(line);
				if (typeof entry !== "object" || entry === null || (entry as Record<string, unknown>).type !== "message") continue;
				const message = (entry as Record<string, unknown>).message;
				const text = assistantText(message);
				const reason = assistantStopReason(message);
				if (text) last = text;
				if (text || reason) stop = reason;
			} catch {
				// Not a JSON line; skip.
			}
		}
		if (last) await atomicWrite(`${jobDir}/result`, `${last}\n`);
		if (stop) await atomicWrite(`${jobDir}/stop-reason`, `${stop}\n`);
	} catch {
		// Result capture is advisory; the job record and branch remain the source of truth.
	}
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
			graceTimer.unref();
			void containEscapedDescendants(jobDir, escaped, "after exhaustion").catch(() => {});
			await finalizeJob(jobDir, "failed", reason);
		})();
	};
	const sessionDir = `${jobDir}/session`;
	const args = ["--mode", "json", "--approve", "--no-extensions", "--session-dir", sessionDir, "--name", `limen: ${label}`, "--append-system-prompt", preamble];
	args.push("--extension", `${HOOK}/steering.ts`, "--extension", `${HOOK}/communication.ts`);
	if (process.env.LIMEN_MODEL) args.push("--model", process.env.LIMEN_MODEL);
	// F034: a continued job resumes its own prior session instead of replaying the task file.
	if (process.env.LIMEN_CONTINUE === "1") args.push("--continue", (await readFile(taskFile, "utf8")).trim());
	else args.push(`@${taskFile}`);
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
	const seen = { activity: "", assistant: "", stop: "" };
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
	await writeHandshake(jobDir);
	await atomicWrite(`${jobDir}/state`, "running\n");
	await appendLimenLog(jobDir, "worker started");
	const timeout = setTimeout(() => exhaust(`timeout after ${timeoutMs}ms`), timeoutMs);
	const result = await outcome;
	clearTimeout(timeout);
	if (graceTimer) clearTimeout(graceTimer);
	apply(parser.flush());
	await pending;
	if (seen.stop) await atomicWrite(`${jobDir}/stop-reason`, `${seen.stop}\n`).catch(() => {});
	if (exhausted) {
		// Keep the wrapper alive through its pre-TERM snapshot and durable failure write.
		await exhaustionTermination;
	} else if (stopRequested || result.signal === "SIGTERM" || result.signal === "SIGKILL") {
		await finalizeJob(jobDir, "stopped", "process group interrupted");
	} else if (result.error) await finalizeJob(jobDir, "failed", result.error.message);
	else if (result.code === 0) {
		// The last assistant message is the worker's handoff; only a completed turn earns a result file.
		if (seen.assistant) await atomicWrite(`${jobDir}/result`, `${seen.assistant}\n`).catch(() => {});
		await finalizeJob(jobDir, "done", "pi exited 0");
	} else await finalizeJob(jobDir, "failed", `worker exited with code ${result.code ?? "unknown"}`);
}
export async function failInternalJob(error: unknown): Promise<void> {
	const jobDir = process.env.LIMEN_JOB_DIR;
	if (!jobDir) return;
	await finalizeJob(jobDir, "failed", error instanceof Error ? error.message : String(error));
}
export async function finalizeJob(jobDir: string, state: "done" | "failed" | "stopped", detail: string): Promise<void> {
	if (["done", "failed", "stopped"].includes(await textFile(`${jobDir}/state`))) return;
	await recordCommits(jobDir).catch(() => {});
	await atomicWrite(`${jobDir}/finished-at`, `${new Date().toISOString()}\n`);
	await atomicWrite(`${jobDir}/state`, `${state}\n`);
	await rm(`${jobDir}/pid`, { force: true });
	await rm(`${jobDir}/born`, { force: true });
	const inbox = await readdir(`${jobDir}/steer/inbox`).catch(() => []);
	await appendLimenLog(jobDir, inbox.length ? `${state}: ${detail}; ${inbox.length} steer(s) never delivered` : `${state}: ${detail}`).catch(() => {});
	for (const name of await readdir(jobDir).catch(() => [])) if (/\.\d+\.[0-9a-f]+\.tmp$/.test(name)) await rm(`${jobDir}/${name}`, { force: true });
	await renameJobTab(jobDir, state);
}
/** What landed on the branch since spawn recorded `base`; empty is a fact, absence means it could not be measured. */
async function recordCommits(jobDir: string): Promise<void> {
	const [base, branch, worktree] = await Promise.all([textFile(`${jobDir}/base`), textFile(`${jobDir}/branch`), textFile(`${jobDir}/worktree`)]);
	if (!base || !branch || !worktree) return;
	const commits = commitList(worktree, base, branch);
	if (commits !== undefined) await atomicWrite(`${jobDir}/commits`, commits ? `${commits}\n` : "");
}
async function recordEvents(jobDir: string, events: readonly StreamEvent[], nextCount: () => number, seen: { activity: string; assistant: string; stop: string }): Promise<void> {
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
		} else if (event.kind === "assistant") {
			seen.assistant = event.text;
			seen.stop = event.stopReason ?? "";
			if (event.text) await appendFile(`${jobDir}/log`, `${event.text}\n`);
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
