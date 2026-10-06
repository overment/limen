import { existsSync } from "node:fs";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { deliverJobStall } from "../integrations/finish-webhook.ts";
import {
	type HerdrPlace,
	type HostedAgentStatus,
	hostedAgentStatus,
	hostedLaunchParent,
	hostedTerminalReason,
	locateHostedAgent,
	reportHostedStall,
	restoreHostedPane,
	startHostedPi,
	stopHostedAgent,
} from "../integrations/herdr.ts";
import { jobMembership, ownsLiveChildren } from "../job/group-cabinet.ts";
import { syncLifecycle } from "../job/group-events.ts";
import {
	appendLimenLog,
	atomicWrite,
	finalizeJob,
	isFailedStopReason,
	recordCommits,
	requestedTerminal,
	textFile,
	writeHandshake,
} from "../job/record.ts";
import { noteKind } from "../job/view.ts";
import { cleanWorktree } from "../project/git.ts";
import { argvFor, jobProfile, prepareSkillConfig } from "./engine.ts";
import {
	hostedBindingInPane,
	hostedBindingSupported,
	hostedEngineOwned,
	hostedIdentityObservation,
	prepareHostedLaunch,
	readHostedBinding,
} from "./hosted-binding.ts";
import { noteHostedUncertainty } from "./hosted-uncertainty.ts";
import { prepareRecoveredOwner } from "./recovery.ts";
import { observeToolStall, type ToolStallWatch } from "./stalled-tool.ts";
import { assistantStopReason, assistantText } from "./stream.ts";
import { readWorkerExtensions } from "./worker-extensions.ts";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
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
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: split pending: hosted supervisor loop
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: same split as the line above
export async function runHostedSupervisor(): Promise<void> {
	const jobDir = requiredEnvironment("LIMEN_JOB_DIR");
	let interrupted = false;
	process.on("SIGTERM", () => {
		interrupted = true;
	});
	const recovering = process.env.LIMEN_HOSTED_RECOVER === "1";
	const release = recovering ? await prepareRecoveredOwner(jobDir) : undefined;
	if (recovering && !release) {
		return;
	}
	if ((await textFile(`${jobDir}/state`)) !== "running") {
		await release?.();
		return;
	}
	await rm(`${jobDir}/born`, { force: true });
	await writeHandshake(jobDir);
	await release?.();
	await appendLimenLog(
		jobDir,
		"hosted supervisor started (no outer timeout or tool-call cap; quiet-tool observation never signals processes)",
	);
	let target = process.env.LIMEN_HOSTED_TARGET?.trim() ?? "";
	if (!recovering && process.env.LIMEN_HOSTED_START === "1") {
		try {
			const started = await startHostedAgent(jobDir);
			if (!started) {
				return;
			}
			target = started;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await finalizeJob(jobDir, "failed", `hosted start failed: ${message}`);
			return;
		}
	} else if (!target) {
		target = requiredEnvironment("LIMEN_HOSTED_TARGET");
	}
	const requestedBeforeWatch = await textFile(`${jobDir}/stop-requested`);
	if (requestedBeforeWatch) {
		stopHostedAgent(target);
	}
	let missingStreak = 0;
	let unknownStreak = 0;
	let unknownAliveNoted = false;
	const idle: HostedIdleWatch = { leftWorkingAt: undefined, armed: true };
	const toolWatch: ToolStallWatch = { tool: "", born: "", started: 0 };
	const engine = (await jobProfile(jobDir)).id;
	// An engine or platform that never binds has no ownership to lose; a standing note there would hide real blocked or errored jobs.
	const bindable = hostedBindingSupported(engine);
	if ((await textFile(`${jobDir}/advisory`)).startsWith("tool stall observation uncertain")) {
		const since = await stat(`${jobDir}/advisory`).then(
			(value) => value.mtimeMs,
			() => Date.now(),
		);
		await noteHostedUncertainty(jobDir, bindable, undefined, since);
		await clearHostedAdvisory(jobDir);
	}
	while (!interrupted) {
		if ((await textFile(`${jobDir}/state`)) !== "running") {
			return;
		}
		const membership = await jobMembership(jobDir);
		if (
			membership &&
			(membership.run.stopped || Date.now() >= (membership.member?.deadline ?? membership.run.deadline))
		) {
			stopHostedAgent(target);
			await atomicWrite(`${jobDir}/stop-requested`, "group deadline or stop\n");
			await writeHostedResult(jobDir);
			await finalizeJob(jobDir, "failed", "group deadline or stop");
			return;
		}
		if (membership) {
			await syncLifecycle(membership.run, "skip");
		}
		const status = hostedAgentStatus(target);
		const sessionEnded = Boolean(await textFile(`${jobDir}/session-ended`));
		// Herdr idle/done = unseen background tab, not job completion.
		if (status === "missing") {
			missingStreak += 1;
		} else if (status === "unknown") {
			unknownStreak += 1;
		} else {
			missingStreak = 0;
			unknownStreak = 0;
			unknownAliveNoted = false;
		}
		// A moved pane or degraded Herdr must neither stall finalize forever nor kill a live worker.
		if ((missingStreak > 0 || unknownStreak >= HOSTED_UNKNOWN_SAMPLES) && !sessionEnded) {
			const located = locateHostedAgent(target, engine, process.env.LIMEN_AGENT_NAME?.trim() ?? "");
			if (located) {
				if (located !== target) {
					const binding = readHostedBinding(jobDir);
					if (!binding || (await hostedBindingInPane(located, binding.pid, engine, jobDir)) !== "owned") {
						await noteHostedUncertainty(jobDir, true, undefined);
						await delay(1_000);
						continue;
					}
					await atomicWrite(`${jobDir}/herdr/agent`, `${located}\n`);
					await atomicWrite(`${jobDir}/herdr/pane`, `${located}\n`);
					await appendLimenLog(jobDir, `hosted agent relocated ${target} -> ${located}`);
					target = located;
				} else if (status === "unknown" && !unknownAliveNoted) {
					unknownAliveNoted = true;
					await appendLimenLog(
						jobDir,
						`herdr cannot classify the hosted agent (${HOSTED_UNKNOWN_SAMPLES} samples); the recorded pane still runs ${engine}`,
					);
				}
				missingStreak = 0;
				unknownStreak = 0;
			} else if (unknownStreak >= HOSTED_UNKNOWN_SAMPLES) {
				// The probe confirms gone despite unclassifiable status; let the missing window decide.
				missingStreak += 1;
				unknownStreak = 0;
			}
		}
		const bound = missingStreak >= 3 ? readHostedBinding(jobDir) : undefined;
		const boundAlive = bound && (await hostedIdentityObservation(bound)) !== "mismatch";
		let reason: string | undefined = sessionEnded
			? hostedTerminalReason(status, true)
			: missingStreak >= 3 && !boundAlive
				? hostedTerminalReason(status, false)
				: undefined;
		const activity = await textFile(`${jobDir}/activity`);
		if (Date.now() - (toolWatch.lastSampleAt ?? 0) >= 3_000) {
			toolWatch.lastSampleAt = Date.now();
			const binding = readHostedBinding(jobDir);
			const owned = Boolean(binding && (await hostedEngineOwned(target, binding.pid, engine, jobDir)));
			let child: boolean | undefined;
			if (owned && binding && activity === "tool") {
				const tool = `${await textFile(`${jobDir}/tool-calls`)}:${await textFile(`${jobDir}/tool-detail`)}`;
				child = (await observeToolStall(toolWatch, binding.pid, tool)) === "uncertain";
			} else {
				toolWatch.tool = "";
				toolWatch.previous = undefined;
			}
			// Think/tool transitions do not prove that an unavailable child observation recovered.
			await noteHostedUncertainty(jobDir, bindable && !owned, child);
		}
		if (!reason) {
			reason = await noteHostedIdle(jobDir, status, idle);
		}
		if (reason) {
			const requested = await textFile(`${jobDir}/stop-requested`);
			await writeHostedResult(jobDir);
			const stopReason = requested ? "" : await textFile(`${jobDir}/stop-reason`);
			const failedReason = isFailedStopReason(stopReason) ? stopReason : "";
			await finalizeJob(
				jobDir,
				requested ? requestedTerminal(requested) : failedReason ? "failed" : "done",
				requested || failedReason || reason,
			);
			return;
		}
		await delay(1_000);
	}
	const halt = (await textFile(`${jobDir}/stop-requested`)) || "hosted supervisor interrupted";
	await finalizeJob(jobDir, requestedTerminal(halt), halt);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: split pending: hosted agent start and retry
async function startHostedAgent(jobDir: string): Promise<string | undefined> {
	const stopped = () => existsSync(`${jobDir}/stop-requested`);
	const requestedBeforeStart = await textFile(`${jobDir}/stop-requested`);
	if (requestedBeforeStart) {
		await finalizeJob(jobDir, requestedTerminal(requestedBeforeStart), requestedBeforeStart);
		return;
	}
	const [workspace, tab, pane, coordinatorTab] = await Promise.all(
		["workspace", "tab", "pane"]
			.map((name) => textFile(`${jobDir}/herdr/${name}`))
			.concat(textFile(`${jobDir}/origin-tab`)),
	);
	if (!workspace || !tab || !pane) {
		await finalizeJob(jobDir, "failed", "hosted start failed: hosted place is incomplete");
		return;
	}
	const place: HerdrPlace = { workspace, tab, pane, mode: "hosted" };
	const taskFile = requiredEnvironment("LIMEN_TASK_FILE");
	const continueFile = process.env.LIMEN_CONTINUE_FILE?.trim();
	const profile = await jobProfile(jobDir);
	const worktree = requiredEnvironment("LIMEN_WORKTREE");
	const skillConfig = profile.id === "omp" ? await prepareSkillConfig(worktree, jobDir) : undefined;
	const membership = await jobMembership(jobDir);
	if (
		membership &&
		(membership.run.stopped || Date.now() >= (membership.member?.deadline ?? membership.run.deadline))
	) {
		await finalizeJob(jobDir, "failed", "group deadline or stop before hosted engine launch");
		return;
	}
	const args = argvFor(profile, {
		jsonMode: false,
		jobDir,
		...(skillConfig ? { skillConfig } : {}),
		label: requiredEnvironment("LIMEN_LABEL"),
		preamble: requiredEnvironment("LIMEN_PREAMBLE"),
		extensions: [
			...["hosted", "steering", "communication", ...((await jobMembership(jobDir)) ? ["group-peer"] : [])].map(
				(name) => `${PACKAGE_ROOT}/hook/${name}.ts`,
			),
			...(await readWorkerExtensions(jobDir, profile.id)),
		],
		...(process.env.LIMEN_PROVIDER ? { provider: process.env.LIMEN_PROVIDER } : {}),
		...(process.env.LIMEN_MODEL ? { model: process.env.LIMEN_MODEL } : {}),
		...(process.env.LIMEN_THINKING ? { thinking: process.env.LIMEN_THINKING } : {}),
		...(continueFile ? { continueValue: `@${continueFile}` } : { taskFile }),
	});
	try {
		await prepareHostedLaunch(jobDir, pane, profile.id, hostedLaunchParent(pane));
		const target = startHostedPi({
			place,
			name: requiredEnvironment("LIMEN_AGENT_NAME"),
			kind: profile.herdrKind,
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
			const stoppedBeforeAgent =
				typeof error === "object" && error !== null && "code" in error && error.code === "hosted_start_stopped";
			const live = stoppedBeforeAgent ? undefined : locateHostedAgent(pane, profile.id);
			if (live) {
				await writeFile(`${jobDir}/herdr/agent`, `${live}\n`);
				stopHostedAgent(live);
				return live;
			}
			await finalizeJob(jobDir, requestedTerminal(requested), requested);
			return;
		}
		const message = error instanceof Error ? error.message : String(error);
		await finalizeJob(jobDir, "failed", `hosted start failed: ${message}`);
		return;
	}
}
/** Publish a stall while the hosted session stays open. Re-arm only after the agent works again. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: split pending: hosted idle checks
export async function noteHostedIdle(
	jobDir: string,
	status: HostedAgentStatus,
	watch: HostedIdleWatch,
	now = Date.now(),
	thresholdMs = hostedIdleMs(),
) {
	if (status === "working") {
		watch.leftWorkingAt = undefined;
		delete watch.lastRingAt;
		if (!watch.armed) {
			watch.armed = true;
			await clearHostedAdvisory(jobDir);
		}
		return;
	}
	if (status !== "idle" && status !== "done" && status !== "blocked") {
		return;
	}
	// Herdr idle/done is not a stall while the agent is still in a turn (think/tool).
	if (status !== "blocked" && (await textFile(`${jobDir}/activity`)) !== "wait") {
		watch.leftWorkingAt = undefined;
		return;
	}
	if (watch.leftWorkingAt === undefined) {
		watch.leftWorkingAt = now;
	}
	const stalled = status === "blocked" || now - watch.leftWorkingAt >= thresholdMs;
	if (!stalled) {
		return;
	}
	const { text, stop } = await lastHostedAssistant(jobDir);
	const errored = stop === "error" || stop.startsWith("error: ");
	const tree = await textFile(`${jobDir}/worktree`);
	if (await ownsLiveChildren(jobDir)) {
		return;
	}
	if (!errored && status !== "blocked" && text && tree && cleanWorktree(tree)) {
		return "closed a clean idle session";
	}
	const tools = Number(await textFile(`${jobDir}/tool-calls`));
	const count = Number.isSafeInteger(tools) && tools > 0 ? tools : 0;
	if (!errored && status !== "blocked" && count < 1) {
		return;
	}
	const elapsed = now - watch.leftWorkingAt;
	const duration =
		elapsed < 60_000 ? `${Math.max(1, Math.round(elapsed / 1000))}s` : `${Math.round(elapsed / 60_000)}m`;
	if (watch.armed) {
		const line = errored
			? `errored: last turn failed with ${stop}, session still open`
			: status === "blocked"
				? `blocked after ${count} tool calls, session still open`
				: `idle ${duration} after ${count} tool calls, session still open`;
		await writeHostedResult(jobDir);
		await recordCommits(jobDir).catch(() => {});
		// A recovered supervisor re-arms on a stall it already reported; the same kind of standing note is not a new event.
		const before = await textFile(`${jobDir}/advisory`);
		await atomicWrite(`${jobDir}/advisory`, `${line}\n`);
		watch.armed = false;
		await appendLimenLog(jobDir, `advisory: ${line}`).catch(() => {});
		if (!before || noteKind(before) !== noteKind(line)) {
			void deliverJobStall(jobDir, line).catch(() => {});
		}
	}
	const pane = await textFile(`${jobDir}/herdr/pane`);
	if (pane) {
		const delivered = (await readdir(`${jobDir}/notify/delivered`).catch(() => [] as string[])).some((name) =>
			name.startsWith("_advisory."),
		);
		const ring = !delivered && (watch.lastRingAt === undefined || now - watch.lastRingAt >= stallReringMs());
		reportHostedStall({
			pane,
			label: (await textFile(`${jobDir}/label`)) || jobDir.split("/").at(-1) || "hosted worker",
			duration,
			notify: ring,
		});
		if (ring) {
			watch.lastRingAt = now;
		}
	}
}
async function clearHostedAdvisory(jobDir: string): Promise<void> {
	await rm(`${jobDir}/advisory`, { force: true });
	for (const dir of [
		`${jobDir}/notify/claims`,
		`${jobDir}/notify/delivered`,
		`${jobDir}/notify/herdr`,
		`${jobDir}/notify/unconfirmed`,
	]) {
		for (const name of await readdir(dir).catch(() => [] as string[])) {
			if (name === "_advisory" || name.startsWith("_advisory.")) {
				await rm(`${dir}/${name}`, { recursive: true, force: true });
			}
		}
	}
	const pane = await textFile(`${jobDir}/herdr/pane`);
	if (pane) {
		restoreHostedPane(pane, process.env.LIMEN_ROLE?.trim() || "worker");
	}
}
async function lastHostedAssistant(jobDir: string): Promise<{ text: string; stop: string }> {
	let text = "",
		stop = "";
	try {
		const newest = (await readdir(`${jobDir}/session`))
			.filter((name) => name.endsWith(".jsonl"))
			.sort()
			.at(-1);
		if (!newest) {
			return { text, stop };
		}
		for (const line of (await readFile(`${jobDir}/session/${newest}`, "utf8")).split("\n")) {
			if (!line.trim()) {
				continue;
			}
			try {
				const entry: unknown = JSON.parse(line);
				if (typeof entry !== "object" || entry === null || (entry as Record<string, unknown>).type !== "message") {
					continue;
				}
				const message = (entry as Record<string, unknown>).message;
				if (typeof message !== "object" || message === null || !("role" in message) || message.role !== "assistant") {
					continue;
				}
				const next = assistantText(message);
				if (next) {
					text = next;
				}
				stop = assistantStopReason(message);
			} catch {}
		}
	} catch {}
	return { text, stop };
}
export async function writeHostedResult(jobDir: string): Promise<void> {
	try {
		const { text: last, stop } = await lastHostedAssistant(jobDir);
		if (!(await textFile(`${jobDir}/result`)) && last) {
			await atomicWrite(`${jobDir}/result`, `${last}\n`);
		}
		if (stop) {
			await atomicWrite(`${jobDir}/stop-reason`, `${stop}\n`);
		}
	} catch {
		// Result capture is advisory; the job record and branch remain the source of truth.
	}
}
function requiredEnvironment(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`internal job wrapper is missing ${name}`);
	}
	return value;
}
const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
