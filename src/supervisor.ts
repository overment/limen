import { readdir, readFile, rm } from "node:fs/promises";
import { type HostedAgentStatus, hostedAgentStatus, hostedTerminalReason, locateHostedAgent, reportHostedStall, restoreHostedPane } from "./herdr.ts";
import { assistantStopReason, assistantText } from "./stream.ts";
import { appendLimenLog, atomicWrite, finalizeJob, recordCommits, textFile, writeHandshake } from "./wrapper.ts";

const HOSTED_UNKNOWN_SAMPLES = 5;
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
			await finalizeJob(jobDir, requested ? "stopped" : "done", requested || reason);
			return;
		}
		await noteHostedIdle(jobDir, status, idle);
		await delay(1_000);
	}
	await finalizeJob(jobDir, "stopped", "hosted supervisor interrupted");
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
				const text = assistantText(message);
				const reason = assistantStopReason(message);
				if (text) last = text;
				if (text || reason) stop = reason;
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
