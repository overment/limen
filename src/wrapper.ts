import { spawn } from "node:child_process";
import { appendFile, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { containEscapedDescendants, discoverEscapedDescendants, processAlive, processInfo, signalProcessGroup } from "./contain.ts";
import { changedFileCount, commitList } from "./git.ts";
import { settleJobTab } from "./herdr.ts";
import { createClaudeStreamParser, createStreamParser, type StreamEvent } from "./stream.ts";

const STOP_GRACE_MS = 5_000;
const HOOK = fileURLToPath(new URL("../hook", import.meta.url));
// A job is one short turn. These bounds stop a silent runaway from burning a session; they are not a review gate.
const DEFAULT_TIMEOUT_MS = 90 * 60_000;
const MAX_TOOL_CALLS = 900;
const toolCallCap = (): number => Number(process.env.LIMEN_MAX_TOOL_CALLS) || MAX_TOOL_CALLS;
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
	// A role names a preamble; an engine names a binary. Both agents get the same preamble, the same
	// worktree, and the same trust the README states — pi takes --approve, claude takes bypassPermissions.
	const engine = process.env.LIMEN_ENGINE === "claude" ? "claude" : "pi";
	const contextRoot = process.env.LIMEN_CONTEXT_ROOT ?? "";
	const args: string[] = [];
	if (engine === "claude") {
		args.push("-p", (await readFile(taskFile, "utf8")).trim());
		args.push("--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions", "--append-system-prompt", preamble);
		if (contextRoot && contextRoot !== worktree) args.push("--add-dir", contextRoot);
	} else {
		args.push("--mode", "json", "--approve", "--no-extensions", "--session-dir", `${jobDir}/session`, "--name", `limen: ${label}`, "--append-system-prompt", preamble);
		args.push("--extension", `${HOOK}/steering.ts`, "--extension", `${HOOK}/communication.ts`);
	}
	if (process.env.LIMEN_MODEL) args.push("--model", process.env.LIMEN_MODEL);
	if (engine === "pi") {
		if (process.env.LIMEN_CONTINUE === "1") args.push("--continue", (await readFile(taskFile, "utf8")).trim());
		else args.push(`@${taskFile}`);
	}
	const childEnvironment: NodeJS.ProcessEnv = {
		...process.env,
		LIMEN_JOB: "1",
		LIMEN_JOB_ID: jobId,
		LIMEN_JOB_LABEL: label,
	};
	const privateEnvironment =
		"LIMEN_INTERNAL_RUN LIMEN_JOB_DIR LIMEN_WORKTREE LIMEN_TASK_FILE LIMEN_PREAMBLE LIMEN_TIMEOUT_MS LIMEN_MODEL LIMEN_LABEL LIMEN_ENGINE LIMEN_CLAUDE PI_SESSION_ID PI_SESSION_FILE PI_PROVIDER PI_MODEL PI_REASONING_LEVEL";
	for (const name of privateEnvironment.split(" ")) delete childEnvironment[name];
	// A detached job must not inherit the coordinator's Herdr pane.
	for (const name of Object.keys(childEnvironment)) if (name.startsWith("HERDR_")) delete childEnvironment[name];
	const parser = engine === "claude" ? createClaudeStreamParser() : createStreamParser();
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
	const child = spawn(engine === "claude" ? (process.env.LIMEN_CLAUDE ?? "claude") : (process.env.LIMEN_PI ?? "pi"), args, {
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
	await appendLimenLog(jobDir, engine === "claude" ? "worker started (claude)" : "worker started");
	const timeout = setTimeout(() => exhaust(`timeout after ${timeoutMs}ms`), timeoutMs);
	const result = await outcome;
	clearTimeout(timeout);
	if (graceTimer) clearTimeout(graceTimer);
	apply(parser.flush());
	await pending;
	if (seen.stop) {
		await atomicWrite(`${jobDir}/stop-reason`, `${seen.stop}\n`).catch(() => {});
		await appendLimenLog(jobDir, `assistant ${seen.stop}`).catch(() => {});
	}
	if (exhausted) {
		await exhaustionTermination;
	} else if (stopRequested || result.signal === "SIGTERM" || result.signal === "SIGKILL") {
		await finalizeJob(jobDir, "stopped", "process group interrupted");
	} else if (result.error) await finalizeJob(jobDir, "failed", result.error.message);
	else if (result.code === 0) {
		if (seen.assistant) await atomicWrite(`${jobDir}/result`, `${seen.assistant}\n`).catch(() => {});
		const failedReason = isFailedStopReason(seen.stop) ? seen.stop : "";
		await finalizeJob(jobDir, failedReason ? "failed" : "done", failedReason || `${engine} exited 0`);
	} else await finalizeJob(jobDir, "failed", `worker exited with code ${result.code ?? "unknown"}`);
}
export async function failInternalJob(error: unknown): Promise<void> {
	const jobDir = process.env.LIMEN_JOB_DIR;
	if (!jobDir) return;
	await finalizeJob(jobDir, "failed", error instanceof Error ? error.message : String(error));
}
export function isFailedStopReason(reason: string): boolean {
	return reason === "error" || reason.startsWith("error: ") || reason === "aborted" || reason.startsWith("aborted: ");
}
export const requestedTerminal = (reason: string): "done" | "stopped" => (reason.startsWith("done:") ? "done" : "stopped");
export async function finalizeJob(jobDir: string, state: "done" | "failed" | "stopped", detail: string): Promise<void> {
	if (["done", "failed", "stopped"].includes(await textFile(`${jobDir}/state`))) return;
	await recordCommits(jobDir).catch(() => {});
	await atomicWrite(`${jobDir}/finished-at`, `${new Date().toISOString()}\n`);
	// The terminal log line lands before the state flip; state is the commit point observers key on, and the story must already be durable when they see it.
	const inbox = await readdir(`${jobDir}/steer/inbox`).catch(() => []);
	await appendLimenLog(jobDir, inbox.length ? `${state}: ${detail}; ${inbox.length} steer(s) never delivered` : `${state}: ${detail}`).catch(() => {});
	await atomicWrite(`${jobDir}/state`, `${state}\n`);
	await rm(`${jobDir}/pid`, { force: true });
	await rm(`${jobDir}/born`, { force: true });
	// A tmp whose writer still runs is an in-flight rename by a racing finalizer, not a leftover; deleting it makes that rename ENOENT and crashes the other process.
	for (const name of await readdir(jobDir).catch(() => [])) {
		const writer = /\.(\d+)\.[0-9a-f]+\.tmp$/.exec(name);
		if (writer && !processAlive(Number(writer[1]))) await rm(`${jobDir}/${name}`, { force: true });
	}
	await settleJobTab(jobDir);
}
export async function recordCommits(jobDir: string): Promise<void> {
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
			await recordChangedFiles(jobDir);
			await appendFile(`${jobDir}/log`, event.detail ? `${event.name} ${event.detail}\n` : `${event.name}\n`);
		} else if (event.kind === "activity") {
			await atomicWrite(`${jobDir}/activity`, `${event.name}\n`);
			await recordChangedFiles(jobDir);
			if (seen.activity !== event.name) await appendFile(`${jobDir}/log`, `${(seen.activity = event.name)}\n`);
		} else if (event.kind === "session") {
			await atomicWrite(`${jobDir}/claude-session`, `${event.id}\n`);
		} else if (event.kind === "assistant") {
			seen.assistant = event.text;
			seen.stop = event.stopReason ?? "";
			if (event.text) await appendFile(`${jobDir}/log`, `${event.text}\n`);
		} else await appendFile(`${jobDir}/log`, `${event.line}\n`);
	}
}
async function recordChangedFiles(jobDir: string): Promise<void> {
	const count = changedFileCount(await textFile(`${jobDir}/worktree`));
	if (count === undefined) await rm(`${jobDir}/changed-files`, { force: true });
	else await atomicWrite(`${jobDir}/changed-files`, `${count}\n`);
}
export async function textFile(path: string): Promise<string> {
	return readFile(path, "utf8").then(
		(value) => value.trim(),
		() => "",
	);
}
export async function writeHandshake(jobDir: string): Promise<void> {
	await atomicWrite(`${jobDir}/pid`, `${process.pid}\n`);
	void recordBorn(jobDir);
}
async function recordBorn(jobDir: string): Promise<void> {
	const outcome = await processInfo(process.pid);
	if (outcome.kind !== "present" || ["done", "failed", "stopped"].includes(await textFile(`${jobDir}/state`))) return;
	await atomicWrite(`${jobDir}/born`, `${outcome.process.born}\n`);
}
function requiredEnvironment(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`internal job wrapper is missing ${name}`);
	return value;
}
