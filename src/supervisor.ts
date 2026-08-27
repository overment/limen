import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
	type HerdrPlace,
	type HostedAgentStatus,
	hostedAgentStatus,
	hostedTerminalReason,
	locateHostedAgent,
	reportHostedStall,
	restoreHostedPane,
	startHostedPi,
	stopHostedAgent,
} from "./herdr.ts";
import { assistantStopReason, assistantText } from "./stream.ts";
import { appendLimenLog, atomicWrite, finalizeJob, isFailedStopReason, recordCommits, textFile, writeHandshake } from "./wrapper.ts";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const HOSTED_UNKNOWN_SAMPLES = 5;
const DEFAULT_HOSTED_START_MS = 5_000;
export const DEFAULT_HOSTED_IDLE_MS = 60_000;
export const DEFAULT_STALL_RERING_MS = 15 * 60_000;
export type HostedIdleWatch = { leftWorkingAt: number | undefined; armed: boolean; lastRingAt?: number };
function hostedIdleMs(): number {
	const raw = Number(process.env.LIMEN_HOSTED_IDLE_MS);
	return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_HOSTED_IDLE_MS;
}
function stallReringMs(): number {
	const raw = Number(process.env.LIMEN_STALL_RERING_MS);
	return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STALL_RERING_MS;
}
function hostedStartMs(): number {
	const raw = Number(process.env.LIMEN_HOSTED_START_MS);
	return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_HOSTED_START_MS;
}
export async function runHostedSupervisor(): Promise<void> {
	const jobDir = requiredEnvironment("LIMEN_JOB_DIR");
	let interrupted = false;
	process.on("SIGTERM", () => {
		interrupted = true;
	});
	await writeHandshake(jobDir);
	await atomicWrite(`${jobDir}/state`, "running\n");
	await appendLimenLog(jobDir, "hosted supervisor started (weaker guarantees: no timeout, no tool-call cap, no process containment)");
	let target = process.env.LIMEN_HOSTED_TARGET?.trim() ?? "";
	if (process.env.LIMEN_HOSTED_START === "1") {
		try {
			const started = await startHostedAgent(jobDir);
			if (!started) return;
			target = started;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await finalizeJob(jobDir, "failed", `hosted start failed: ${message}`);
			return;
		}
	} else if (!target) target = requiredEnvironment("LIMEN_HOSTED_TARGET");
	const requestedBeforeWatch = await textFile(`${jobDir}/stop-requested`);
	if (requestedBeforeWatch) stopHostedAgent(target);
	let missingStreak = 0;
	let unknownStreak = 0;
	let unknownAliveNoted = false;
	const idle: HostedIdleWatch = { leftWorkingAt: undefined, armed: true };
	while (!interrupted) {
		const status = hostedAgentStatus(target);
		const sessionEnded = Boolean(await textFile(`${jobDir}/session-ended`));
		// Herdr idle/done = unseen background tab, not job completion.
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
			const stopReason = requested ? "" : await textFile(`${jobDir}/stop-reason`);
			const failedReason = isFailedStopReason(stopReason) ? stopReason : "";
			await finalizeJob(jobDir, requested ? "stopped" : failedReason ? "failed" : "done", requested || failedReason || reason);
			return;
		}
		await noteHostedIdle(jobDir, status, idle);
		await delay(1_000);
	}
	await finalizeJob(jobDir, "stopped", (await textFile(`${jobDir}/stop-requested`)) || "hosted supervisor interrupted");
}

async function startHostedAgent(jobDir: string): Promise<string | undefined> {
	const stopped = () => existsSync(`${jobDir}/stop-requested`);
	const requestedBeforeStart = await textFile(`${jobDir}/stop-requested`);
	if (requestedBeforeStart) {
		await finalizeJob(jobDir, "stopped", requestedBeforeStart);
		return;
	}
	const [workspace, tab, pane, coordinatorTab] = await Promise.all(
		["workspace", "tab", "pane"].map((name) => textFile(`${jobDir}/herdr/${name}`)).concat(textFile(`${jobDir}/origin-tab`)),
	);
	if (!workspace || !tab || !pane) {
		await finalizeJob(jobDir, "failed", "hosted start failed: hosted place is incomplete");
		return;
	}
	const place: HerdrPlace = { workspace, tab, pane, mode: "hosted" };
	const taskFile = requiredEnvironment("LIMEN_TASK_FILE");
	const continueFile = process.env.LIMEN_CONTINUE_FILE?.trim();
	const continuation = continueFile ? (await readFile(continueFile, "utf8")).trim() : undefined;
	const extensions = ["hosted", "steering", "communication"].flatMap((name) => ["--extension", `${PACKAGE_ROOT}/hook/${name}.ts`]);
	const args = [
		"--approve",
		"--no-extensions",
		"--session-dir",
		`${jobDir}/session`,
		"--name",
		`limen: ${requiredEnvironment("LIMEN_LABEL")}`,
		"--append-system-prompt",
		requiredEnvironment("LIMEN_PREAMBLE"),
		...extensions,
		...(process.env.LIMEN_MODEL ? ["--model", process.env.LIMEN_MODEL] : []),
		...(continuation !== undefined ? ["--continue", continuation] : [`@${taskFile}`]),
	];
	try {
		const target = startHostedPi({
			place,
			name: requiredEnvironment("LIMEN_AGENT_NAME"),
			args,
			timeoutMs: hostedStartMs(),
			...(coordinatorTab ? { coordinatorTab } : {}),
			stopped,
			log: (line) => void appendLimenLog(jobDir, line).catch(() => {}),
		});
		await writeFile(`${jobDir}/herdr/agent`, `${target}\n`);
		return target;
	} catch (error) {
		const requested = await textFile(`${jobDir}/stop-requested`);
		if (requested) {
			const stoppedBeforeAgent = typeof error === "object" && error !== null && "code" in error && error.code === "hosted_start_stopped";
			const live = stoppedBeforeAgent ? undefined : locateHostedAgent(pane);
			if (live) {
				await writeFile(`${jobDir}/herdr/agent`, `${live}\n`);
				stopHostedAgent(live);
				return live;
			}
			await finalizeJob(jobDir, "stopped", requested);
			return;
		}
		const message = error instanceof Error ? error.message : String(error);
		await finalizeJob(jobDir, "failed", `hosted start failed: ${message}`);
		return;
	}
}
/** Publish a stall while the hosted session stays open. Re-arm only after the agent works again. */
export async function noteHostedIdle(jobDir: string, status: HostedAgentStatus, watch: HostedIdleWatch, now = Date.now(), thresholdMs = hostedIdleMs()): Promise<void> {
	if (status === "working") {
		watch.leftWorkingAt = undefined;
		delete watch.lastRingAt;
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
	const stalled = status === "blocked" || now - watch.leftWorkingAt >= thresholdMs;
	if (!stalled) return;
	const tools = Number(await textFile(`${jobDir}/tool-calls`));
	const count = Number.isSafeInteger(tools) && tools > 0 ? tools : 0;
	if (status !== "blocked" && count < 1) return;
	const elapsed = now - watch.leftWorkingAt;
	const duration = elapsed < 60_000 ? `${Math.max(1, Math.round(elapsed / 1000))}s` : `${Math.round(elapsed / 60_000)}m`;
	if (watch.armed) {
		const line = status === "blocked" ? `blocked after ${count} tool calls, session still open` : `idle ${duration} after ${count} tool calls, session still open`;
		await writeHostedResult(jobDir);
		await recordCommits(jobDir).catch(() => {});
		await atomicWrite(`${jobDir}/advisory`, `${line}\n`);
		watch.armed = false;
		await appendLimenLog(jobDir, `advisory: ${line}`).catch(() => {});
	}
	const pane = await textFile(`${jobDir}/herdr/pane`);
	if (pane) {
		const delivered = (await readdir(`${jobDir}/notify/delivered`).catch(() => [] as string[])).some((name) => name.startsWith("_advisory."));
		const ring = !delivered && (watch.lastRingAt === undefined || now - watch.lastRingAt >= stallReringMs());
		reportHostedStall({
			pane,
			label: (await textFile(`${jobDir}/label`)) || jobDir.split("/").at(-1) || "hosted worker",
			duration,
			notify: ring,
		});
		if (ring) watch.lastRingAt = now;
	}
}
async function clearHostedAdvisory(jobDir: string): Promise<void> {
	await rm(`${jobDir}/advisory`, { force: true });
	for (const dir of [`${jobDir}/notify/claims`, `${jobDir}/notify/delivered`, `${jobDir}/notify/herdr`]) {
		for (const name of await readdir(dir).catch(() => [] as string[])) {
			if (name.startsWith("_advisory.")) await rm(`${dir}/${name}`, { recursive: true, force: true });
		}
	}
	const pane = await textFile(`${jobDir}/herdr/pane`);
	if (pane) restoreHostedPane(pane, process.env.LIMEN_ROLE === "reviewer" ? "reviewer" : "worker");
}
export async function writeHostedResult(jobDir: string): Promise<void> {
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
				if (typeof message !== "object" || message === null || !("role" in message) || message.role !== "assistant") continue;
				const text = assistantText(message);
				const reason = assistantStopReason(message);
				if (text) last = text;
				stop = reason;
			} catch {}
		}
		if (last) await atomicWrite(`${jobDir}/result`, `${last}\n`);
		if (stop) await atomicWrite(`${jobDir}/stop-reason`, `${stop}\n`);
	} catch {
		// Result capture is advisory; the job record and branch remain the source of truth.
	}
}
function requiredEnvironment(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`internal job wrapper is missing ${name}`);
	return value;
}
const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
