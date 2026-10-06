import { spawn } from "node:child_process";
import { appendFile, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { jobMembership } from "../job/group-cabinet.ts";
import { appendLimenLog, atomicWrite, finalizeJob, isFailedStopReason, writeHandshake } from "../job/record.ts";
import {
	containEscapedDescendants,
	discoverEscapedDescendants,
	type JobProcess,
	processInfo,
	signalProcessGroup,
} from "./contain.ts";
import { argvFor, engineBinary, jobProfile, prepareSkillConfig } from "./engine.ts";
import { observeToolStall, ownedToolDescendants, type ToolStallWatch, toolStallMs } from "./stalled-tool.ts";
import { createStreamParser, type StreamEvent } from "./stream.ts";
import { readWorkerExtensions } from "./worker-extensions.ts";

const STOP_GRACE_MS = 5_000;
const HOOK = fileURLToPath(new URL("../../hook", import.meta.url));
// A job is one short turn. These bounds stop a silent runaway from burning a session; they are not a review gate.
const DEFAULT_TIMEOUT_MS = 90 * 60_000;
const MAX_TOOL_CALLS = 900;
const toolCallCap = (): number => Number(process.env.LIMEN_MAX_TOOL_CALLS) || MAX_TOOL_CALLS;
export async function launchWrapper(environment: Readonly<Record<string, string>>): Promise<number> {
	return launchDetached({ ...environment, LIMEN_INTERNAL_RUN: "1" });
}
export async function launchHostedSupervisor(environment: Readonly<Record<string, string>>): Promise<number> {
	return launchDetached({ LIMEN_HOSTED_RECOVER: "", ...environment, LIMEN_INTERNAL_HOSTED: "1" });
}
async function launchDetached(environment: Readonly<Record<string, string>>): Promise<number> {
	const executable = fileURLToPath(new URL("../../bin/limen", import.meta.url));
	const child = spawn(process.execPath, [executable], {
		detached: true,
		stdio: "ignore",
		env: { ...process.env, ...environment },
	});
	await new Promise<void>((resolve, reject) => {
		child.once("spawn", resolve);
		child.once("error", reject);
	});
	if (!child.pid) {
		throw new Error("could not start the detached job wrapper");
	}
	child.unref();
	return child.pid;
}
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: split pending: internal job runner
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: same split as the line above
export async function runInternalJob(): Promise<void> {
	const jobDir = requiredEnvironment("LIMEN_JOB_DIR");
	const worktree = requiredEnvironment("LIMEN_WORKTREE");
	const taskFile = requiredEnvironment("LIMEN_TASK_FILE");
	const preambleFile = requiredEnvironment("LIMEN_PREAMBLE");
	const jobId = requiredEnvironment("LIMEN_JOB_ID");
	const label = process.env.LIMEN_LABEL || jobId;
	const membership = await jobMembership(jobDir);
	if (
		membership &&
		(membership.run.stopped || Date.now() >= (membership.member?.deadline ?? membership.run.deadline))
	) {
		await finalizeJob(jobDir, "failed", "group deadline or stop before engine launch");
		return;
	}
	const configuredTimeout = process.env.LIMEN_TIMEOUT_MS ? Number(process.env.LIMEN_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
	const timeoutMs = membership
		? Math.max(1, Math.min(configuredTimeout, (membership.member?.deadline ?? membership.run.deadline) - Date.now()))
		: configuredTimeout;
	const preamble = await readFile(preambleFile, "utf8");
	let confirmedToolStall = false;
	let stopRequested = false;
	let shutdownDeadline: number | undefined;
	let exhausted: string | undefined;
	let graceTimer: NodeJS.Timeout | undefined;
	let tools = 0;
	let pending = Promise.resolve();
	process.on("SIGTERM", () => {
		stopRequested = true;
		if (!confirmedToolStall) {
			shutdownDeadline ??= Date.now() + STOP_GRACE_MS - 500;
		}
	});
	let exhaustionTermination = Promise.resolve();
	const exhaust = (reason: string, captured?: readonly JobProcess[]) => {
		if (exhausted || stopRequested) {
			return;
		}
		confirmedToolStall = Boolean(captured);
		exhausted = reason;
		exhaustionTermination = (async () => {
			// Capture before TERM while ancestry still proves ownership. A confirmed tool stall
			// includes in-group descendants, not only children that escaped the wrapper group.
			const descendants = captured ?? (await discoverEscapedDescendants(jobDir, process.pid, "during exhaustion"));
			await appendLimenLog(jobDir, `${reason}; sending TERM`).catch(() => {});
			if (!captured) {
				shutdownDeadline = Date.now() + STOP_GRACE_MS - 500;
			}
			signalProcessGroup(process.pid, "SIGTERM");
			if (captured) {
				await containEscapedDescendants(jobDir, descendants, "after stalled tool");
			} else {
				graceTimer = setTimeout(() => signalProcessGroup(process.pid, "SIGKILL"), STOP_GRACE_MS);
				graceTimer.unref();
				void containEscapedDescendants(jobDir, descendants, "after exhaustion").catch(() => {});
			}
			await finalizeJob(jobDir, "failed", reason, shutdownDeadline);
		})();
	};
	const profile = await jobProfile(jobDir);
	const skillConfig = profile.id === "omp" ? await prepareSkillConfig(worktree, jobDir) : undefined;
	const args = argvFor(profile, {
		jsonMode: true,
		jobDir,
		...(skillConfig ? { skillConfig } : {}),
		label,
		preamble,
		extensions: [
			`${HOOK}/steering.ts`,
			`${HOOK}/communication.ts`,
			...((await jobMembership(jobDir)) ? [`${HOOK}/group-peer.ts`] : []),
			...(await readWorkerExtensions(jobDir, profile.id)),
		],
		...(process.env.LIMEN_PROVIDER ? { provider: process.env.LIMEN_PROVIDER } : {}),
		...(process.env.LIMEN_MODEL ? { model: process.env.LIMEN_MODEL } : {}),
		...(process.env.LIMEN_THINKING ? { thinking: process.env.LIMEN_THINKING } : {}),
		...(process.env.LIMEN_CONTINUE === "1"
			? { continueValue: (await readFile(taskFile, "utf8")).trim() }
			: { taskFile }),
	});
	const childEnvironment: NodeJS.ProcessEnv = {
		...process.env,
		LIMEN_JOB: "1",
		LIMEN_JOB_ID: jobId,
		LIMEN_JOB_LABEL: label,
	};
	const privateEnvironment =
		"LIMEN_INTERNAL_RUN LIMEN_JOB_DIR LIMEN_WORKTREE LIMEN_TASK_FILE LIMEN_PREAMBLE LIMEN_TIMEOUT_MS LIMEN_MODEL LIMEN_PROVIDER LIMEN_THINKING LIMEN_LABEL PI_SESSION_ID PI_SESSION_FILE PI_PROVIDER PI_MODEL PI_REASONING_LEVEL";
	for (const name of privateEnvironment.split(" ")) {
		delete childEnvironment[name];
	}
	// A detached job must not inherit the coordinator's Herdr pane.
	for (const name of Object.keys(childEnvironment)) {
		if (name.startsWith("HERDR_")) {
			delete childEnvironment[name];
		}
	}
	const parser = createStreamParser();
	const seen = { activity: "", assistant: "", stop: "", tool: "", progress: 0 };
	const failLog = (error: unknown) =>
		appendLimenLog(jobDir, `log write failed: ${error instanceof Error ? error.message : String(error)}`).catch(
			() => {},
		);
	const apply = (events: readonly StreamEvent[]) => {
		pending = pending
			.then(() =>
				recordEvents(
					jobDir,
					events,
					() => {
						tools += 1;
						if (tools >= toolCallCap()) {
							exhaust(`tool-call cap reached after ${tools} calls`);
						}
						return tools;
					},
					seen,
				),
			)
			.catch(failLog);
	};
	const child = spawn(engineBinary(profile), args, {
		cwd: worktree,
		stdio: ["ignore", "pipe", "pipe"],
		env: childEnvironment,
	});
	child.stdout?.on("data", (chunk: Buffer | string) => apply(parser.push(chunk.toString())));
	child.stderr?.on("data", (chunk: Buffer | string) => {
		seen.progress += 1;
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
	const enginePid = child.pid;
	const stallWatch: ToolStallWatch = { tool: "", born: "", started: 0 };
	let observing = false;
	let ownershipWarning = false;
	const warnUncertain = async (detail: string) => {
		if (ownershipWarning) {
			return;
		}
		ownershipWarning = true;
		const line = `tool stall observation uncertain: ${detail}`;
		await atomicWrite(`${jobDir}/advisory`, `${line}\n`);
		await appendLimenLog(jobDir, line);
	};
	const clearUncertain = async () => {
		if (!ownershipWarning) {
			return;
		}
		ownershipWarning = false;
		await rm(`${jobDir}/advisory`, { force: true });
	};
	const observeStall = async (pid: number) => {
		const identity = await processInfo(pid);
		if (identity.kind !== "present" || identity.process.ppid !== process.pid || identity.process.pgid !== process.pid) {
			stallWatch.previous = undefined;
			stallWatch.started = Date.now();
			await warnUncertain("detached engine ownership unavailable");
			return;
		}
		const result = await observeToolStall(stallWatch, pid, `${tools}:${seen.tool}:${seen.progress}`);
		if (result === "uncertain") {
			await warnUncertain("CPU or process identity unavailable");
			return;
		}
		if (result !== "stalled") {
			await clearUncertain();
			return;
		}
		const [owner, engine] = await Promise.all([processInfo(process.pid), processInfo(pid)]);
		if (
			owner.kind !== "present" ||
			owner.process.pgid !== process.pid ||
			engine.kind !== "present" ||
			engine.process.born !== stallWatch.born ||
			engine.process.ppid !== process.pid ||
			engine.process.pgid !== process.pid
		) {
			await warnUncertain("process group ownership changed");
			return;
		}
		const descendants = await ownedToolDescendants(process.pid, owner.process.born);
		if (!descendants?.some((member) => member.pid === pid) || descendants.length < 2) {
			await warnUncertain("child ownership changed before termination");
			return;
		}
		if (
			seen.activity !== "tool" ||
			(await observeToolStall(stallWatch, pid, `${tools}:${seen.tool}:${seen.progress}`)) !== "stalled"
		) {
			return;
		}
		await clearUncertain();
		exhaust(
			`stalled tool ${seen.tool}: ${stallWatch.previous?.children.length ? "CPU-idle child" : "child exited"} for ${Math.round(toolStallMs() / 1000)}s`,
			descendants,
		);
	};
	const checkStall = () => {
		if (observing || exhausted || stopRequested || !enginePid) {
			return;
		}
		if (seen.activity !== "tool") {
			void clearUncertain();
			return;
		}
		observing = true;
		void observeStall(enginePid)
			.catch(failLog)
			.finally(() => {
				observing = false;
			});
	};
	const stallTimer = setInterval(checkStall, 3_000);
	const timeout = setTimeout(() => exhaust(`timeout after ${timeoutMs}ms`), timeoutMs);
	const result = await outcome;
	clearTimeout(timeout);
	clearInterval(stallTimer);
	if (graceTimer) {
		clearTimeout(graceTimer);
	}
	apply(parser.flush());
	await pending;
	if (seen.stop) {
		await atomicWrite(`${jobDir}/stop-reason`, `${seen.stop}\n`).catch(() => {});
		await appendLimenLog(jobDir, `assistant ${seen.stop}`).catch(() => {});
	}
	if (exhausted) {
		await exhaustionTermination;
	} else if (stopRequested || result.signal === "SIGTERM" || result.signal === "SIGKILL") {
		await finalizeJob(jobDir, "stopped", "process group interrupted", shutdownDeadline);
	} else if (result.error) {
		await finalizeJob(jobDir, "failed", result.error.message);
	} else if (result.code === 0) {
		if (seen.assistant) {
			await atomicWrite(`${jobDir}/result`, `${seen.assistant}\n`).catch(() => {});
		}
		const failedReason = isFailedStopReason(seen.stop) ? seen.stop : "";
		await finalizeJob(jobDir, failedReason ? "failed" : "done", failedReason || `${profile.id} exited 0`);
	} else {
		await finalizeJob(jobDir, "failed", `worker exited with code ${result.code ?? "unknown"}`);
	}
}
export async function failInternalJob(error: unknown): Promise<void> {
	const jobDir = process.env.LIMEN_JOB_DIR;
	if (!jobDir) {
		return;
	}
	await finalizeJob(jobDir, "failed", error instanceof Error ? error.message : String(error));
}
async function recordEvents(
	jobDir: string,
	events: readonly StreamEvent[],
	nextCount: () => number,
	seen: { activity: string; assistant: string; stop: string; tool: string; progress: number },
): Promise<void> {
	for (const event of events) {
		if (event.kind === "tool") {
			seen.activity = "tool";
			seen.tool = event.detail ? `${event.name} ${event.detail}` : event.name;
			await atomicWrite(`${jobDir}/last-tool`, `${event.name}\n`);
			await atomicWrite(`${jobDir}/activity`, "tool\n");
			await atomicWrite(`${jobDir}/tool-calls`, `${nextCount()}\n`);
			await appendFile(`${jobDir}/log`, event.detail ? `${event.name} ${event.detail}\n` : `${event.name}\n`);
		} else if (event.kind === "activity") {
			await atomicWrite(`${jobDir}/activity`, `${event.name}\n`);
			if (seen.activity !== event.name) {
				seen.activity = event.name;
				await appendFile(`${jobDir}/log`, `${event.name}\n`);
			}
		} else if (event.kind === "assistant") {
			seen.assistant = event.text;
			seen.stop = event.stopReason ?? "";
			if (event.text) {
				await appendFile(`${jobDir}/log`, `${event.text}\n`);
			}
		} else {
			seen.progress += 1;
			await appendFile(`${jobDir}/log`, `${event.line}\n`);
		}
	}
}
function requiredEnvironment(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`internal job wrapper is missing ${name}`);
	}
	return value;
}
