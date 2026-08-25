import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { appendLimenLog, atomicWrite } from "./wrapper.ts";

const ESCAPED_TERM_GRACE_MS = 2_000;
const ESCAPED_KILL_GRACE_MS = 1_000;
const PROCESS_QUERY_TIMEOUT_MS = 1_000;
const PROCESS_QUERY_MAX_BYTES = 1024 * 1024;
const PIDINFO_HELPER = fileURLToPath(new URL("./proc-pidinfo.rb", import.meta.url));
type ProcessIdentity = { readonly pid: number; readonly born: string };
export type JobProcess = ProcessIdentity & { readonly pgid: number; readonly command: string };
type ProcessInfo = JobProcess & { readonly ppid: number };
export type ProcessQueryOutcome = { readonly kind: "present"; readonly process: ProcessInfo } | { readonly kind: "absent" } | { readonly kind: "unavailable" };
type ProcessTableRow = { readonly pid: number; readonly ppid: number; readonly pgid: number; readonly state: string };
type ContainmentDependencies = {
	readonly query?: (pid: number) => Promise<ProcessQueryOutcome>;
	readonly signal?: (pid: number, signal: NodeJS.Signals) => "sent" | "missing" | "denied";
};
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
async function listEscapedDescendants(rootPid: number): Promise<readonly JobProcess[]> {
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
function isCode(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
