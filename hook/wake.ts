import { execFile, spawnSync } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	type FSWatcher,
	mkdirSync,
	readdirSync,
	readFileSync,
	watch,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { coordinatorSignals } from "../src/integrations/coordinator-signal.ts";
import { herdrBinary } from "../src/integrations/herdr.ts";
import { closedFeatures, closedJobFeatures, derivePulse, isTerminal, type Pulse, SESSION_ID } from "../src/job/job.ts";
import {
	CLAIM_STALE_MS,
	claimDelivery,
	claimMarker,
	claimSlots,
	completionSlots,
	confirmClaim,
	type DeliveryCallbacks,
	deliveredSlots,
	deliveryExists,
	deliverySettled,
	enrollLegacyRunning,
	oldEnoughForFallback,
	receiptFamily,
	recordUnconfirmed,
	recoverClaims,
	refreshClaim,
	routable,
	sessionOwnsJobs,
	subscribed,
	subscribeSession,
} from "../src/job/wake-delivery.ts";
import { advisoryWake, completionWake } from "../src/job/wake-text.ts";
import { unlandedBranches } from "../src/project/git.ts";
import { registerProject } from "../src/project/seat.ts";
import {
	HOSTED_UNCERTAINTY_MS,
	hostedUncertaintyText,
	readHostedUncertainty,
} from "../src/runtime/hosted-uncertainty.ts";
import { ownerAlive, reapDeadJobs } from "../src/runtime/reap.ts";

type Context = {
	readonly cwd: string;
	isIdle(): boolean;
	readonly sessionManager: { getSessionId(): string };
	readonly ui: {
		notify(message: string, level: "info"): void;
		setStatus(key: string, value: string | undefined): void;
	};
};
type PiApi = {
	on(
		event:
			| "session_start"
			| "session_shutdown"
			| "agent_settled"
			| "message_start"
			| "message_end"
			| "tool_execution_start"
			| "tool_execution_end"
			| "tool_result"
			| "goal_updated",
		handler: (event: unknown, context: Context) => void,
	): void;
	sendUserMessage(content: string, options?: { readonly deliverAs: "steer" | "followUp" }): Promise<void> | void;
	registerCommand?(
		name: string,
		options: {
			readonly description: string;
			getArgumentCompletions?(prefix: string): ReadonlyArray<{ readonly value: string; readonly label: string }> | null;
			handler(args: string, context: { readonly ui: { notify(message: string, level: "info"): void } }): void;
		},
	): void;
};

const CACHE_REFRESH_MS = 30_000;
// Herdr drops pane metadata after its TTL; an unchanged label is re-sent well before then.
const METADATA_TTL_MS = 180_000;
const METADATA_REFRESH_MS = 60_000;
const TAB_TAIL = /(?:\s*·\s*\d+\s+(?:running|finished))+$/;
type FinishedJob = { readonly id: string; readonly label: string; readonly state: string; readonly finishedAt: number };
type HerdrPane = { readonly binary: string; readonly pane: string };

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: split pending: hook factory, handlers share its state
export default function limenWake(pi: PiApi): void {
	let watcher: FSWatcher | undefined;
	let sweepTimer: NodeJS.Timeout | undefined;
	let changeTimer: NodeJS.Timeout | undefined;
	let statusBody = "";
	let active = false;
	let muted = false;
	let session: Context | undefined;
	let sessionGeneration = 0;
	let jobsDir: string | undefined;
	let sessionId = "";
	let limenDir: string | undefined;
	let lastSweepAt = 0;
	let initialSweep = false;
	let footerAlive = true;
	let footerNoted = false;
	let herdr: HerdrPane | undefined;
	let herdrSeq = Date.now();
	let herdrMetadata: string | undefined;
	let herdrMetadataAt = 0;
	let tabTail: string | undefined;
	let ownerTurnAt = 0;
	let finishedCache:
		| { readonly key: string; readonly until: number; readonly jobs: readonly FinishedJob[] }
		| undefined;
	const firstDead = new Map<string, number>();
	const settled = new Set<string>();
	let ownsJobs: boolean | undefined;
	let cacheExpiresAt = 0;
	let sweeping = false;
	const coordinator = coordinatorSignals();
	let injectedThisSweep = false;
	type PendingDelivery = {
		readonly claim: string;
		readonly delivered: string;
		readonly message: string;
		readonly blocked: () => void;
		accepted: boolean;
		entered: boolean;
		answered: boolean;
		errored: boolean;
		settled: boolean;
	};
	const pendingDeliveries = new Map<string, PendingDelivery>();
	const activeDeliveries = new Set<string>();
	const herdrCall = (args: readonly string[]) => {
		if (!herdr) {
			return;
		}
		try {
			execFile(herdr.binary, args, { timeout: 2_000 }, () => {}).unref();
		} catch {
			// Herdr reporting is advisory; durable state remains on disk.
		}
	};
	const herdrReport = (body: string, title: string, pulses: readonly Pulse[] = [], watched = 0) => {
		if (!herdr) {
			return;
		}
		const jobs = `${pulses.length} RUNNING · ${watched} watched · ${pulses.length - watched} unwatched`;
		const label = `${jobs} · ${body}`;
		const agent = herdrDisplayAgent(pulses, session?.isIdle() === true);
		const signature = `${title}\0${label}\0${agent}`;
		if (signature === herdrMetadata && Date.now() - herdrMetadataAt < METADATA_REFRESH_MS) {
			return;
		}
		herdrMetadata = signature;
		herdrMetadataAt = Date.now();
		const change = body
			? [
					"--title",
					title,
					"--display-agent",
					agent,
					"--token",
					`limen=${label}`,
					"--state-label",
					`idle=${label}`,
					"--state-label",
					`done=${label}`,
				]
			: ["--clear-title", "--display-agent", "Limen coordinator", "--clear-token", "limen", "--clear-state-labels"];
		herdrSeq += 1;
		herdrCall([
			"pane",
			"report-metadata",
			herdr.pane,
			"--source",
			"limen",
			"--seq",
			String(herdrSeq),
			...change,
			"--ttl-ms",
			String(METADATA_TTL_MS),
		]);
	};
	const releaseHerdr = () => {
		if (!herdr) {
			return;
		}
		herdrSeq += 1;
		herdrCall([
			"pane",
			"report-metadata",
			herdr.pane,
			"--source",
			"limen",
			"--seq",
			String(herdrSeq),
			"--clear-title",
			"--clear-display-agent",
			"--clear-token",
			"limen",
			"--clear-state-labels",
		]);
	};
	const stopTimers = () => {
		if (sweepTimer) {
			clearInterval(sweepTimer);
		}
		sweepTimer = undefined;
		if (changeTimer) {
			clearTimeout(changeTimer);
		}
		changeTimer = undefined;
	};
	const dropFooter = (reason: string) => {
		footerAlive = false;
		statusBody = "";
		if (footerNoted || !limenDir) {
			return;
		}
		footerNoted = true;
		try {
			appendFileSync(
				join(limenDir, "log"),
				`[limen ${new Date().toISOString()}] coordinator footer disabled: ${reason}; wake delivery remains active\n`,
			);
		} catch {
			// Delivery and the liveness stamp remain the durable signals when this note cannot be written.
		}
	};
	const setStatus = (value: string | undefined) => {
		if (!session || !footerAlive) {
			return;
		}
		try {
			session.ui.setStatus("limen", value);
		} catch {
			dropFooter("setStatus failed");
		}
	};
	const retire = (reportHerdr = true) => {
		active = false;
		sessionGeneration += 1;
		session = undefined;
		stopTimers();
		statusBody = "";
		if (reportHerdr) {
			herdrReport("", "");
		}
	};
	const clearStatus = (reportHerdr = true) => {
		statusBody = "";
		setStatus(undefined);
		if (reportHerdr) {
			herdrReport("", "");
		}
	};
	const drawStatus = () => {
		if (!active || !footerAlive || muted || !statusBody || !session) {
			return;
		}
		setStatus(statusBody);
	};
	const sessionOwns = (jobs: string) => {
		if (ownsJobs === undefined) {
			ownsJobs = sessionOwnsJobs(jobs, sessionId);
		}
		return ownsJobs;
	};
	// Limen owns the tab tail; the coordinator owns the stem. Rewriting only on a tail change keeps this to a spawn, a completion, a land, or an owner turn.
	const updateTabTail = (jobs: string, running: readonly string[], finished: readonly FinishedJob[]) => {
		const tab = process.env.HERDR_TAB_ID?.trim();
		if (!herdr || !tab) {
			return;
		}
		const count = running.filter((id) => text(join(jobs, id, "origin-tab")) === tab).length;
		// The finished count is news since the owner last spoke; the job line keeps naming older finished jobs.
		const fresh = finished.filter(
			({ id, finishedAt }) => finishedAt >= ownerTurnAt && text(join(jobs, id, "origin-tab")) === tab,
		).length;
		const tail = `${count > 0 ? ` · ${count} running` : ""}${fresh > 0 ? ` · ${fresh} finished` : ""}`;
		if (tail === tabTail) {
			return;
		}
		tabTail = tail;
		const current = tabLabel(herdr.binary, tab);
		if (current === undefined) {
			return;
		}
		const stem = current.replace(TAB_TAIL, "").trim();
		// A tab still carrying Herdr's own number was never named by a coordinator; decorating it would invent a stem.
		if (!stem || /^\d+$/.test(stem)) {
			return;
		}
		const next = `${stem}${tail}`;
		if (next !== current) {
			herdrCall(["tab", "rename", tab, next]);
		}
	};
	// Lands and closes happen in Git and spec/, outside the jobs directory: refresh when a job leaves the running set, after each coordinator turn, and on the cache timer.
	const finishedNow = (jobs: string, running: readonly string[]): readonly FinishedJob[] => {
		const key = running.join("\n");
		if (finishedCache && finishedCache.key === key && Date.now() < finishedCache.until) {
			return finishedCache.jobs;
		}
		const found = finishedJobs(jobs, process.env.HERDR_TAB_ID?.trim(), sessionId);
		finishedCache = { key, until: Date.now() + CACHE_REFRESH_MS, jobs: found };
		return found;
	};
	const updateStatus = async (jobs: string, running: readonly string[], generation: number) => {
		const finished = finishedNow(jobs, running);
		const next = await jobDisplay(jobs, sessionId, running, finished);
		if (!active || generation !== sessionGeneration) {
			return;
		}
		updateTabTail(jobs, running, finished);
		if (!next) {
			clearStatus();
			return;
		}
		statusBody = next.status;
		herdrReport(next.summary, next.title, next.pulses, next.watched);
		drawStatus();
	};
	const notifyHerdr = (job: string, id: string, state: string, label: string, branch: string, slot: string) => {
		if (!claimMarker(job, "herdr", slot)) {
			return;
		}
		herdrCall([
			"notification",
			"show",
			state === "done" ? `limen: ${label} done; next step: land it` : `limen: ${label} is ${state}`,
			"--body",
			state === "done"
				? `job ${id} · branch ${branch} · land it, or name the check that blocks landing`
				: `job ${id} · branch ${branch}`,
			"--sound",
			state === "done" ? "done" : "request",
		]);
	};
	const injectWake = (message: string): Promise<void> => {
		// First idle inject in a sweep is a real turn; later injects, and any inject while busy, are followUp.
		if (session?.isIdle() === true && !injectedThisSweep) {
			injectedThisSweep = true;
			return Promise.resolve(pi.sendUserMessage(message));
		}
		return Promise.resolve(pi.sendUserMessage(message, { deliverAs: "followUp" }));
	};
	const deliveryCallbacks = (message: string, blocked: () => void): DeliveryCallbacks => ({
		blocked,
		protected(claim) {
			const pending = pendingDeliveries.get(claim);
			return Boolean(pending && (pending.entered || session?.isIdle() !== true));
		},
		pending(claim, delivered) {
			pendingDeliveries.set(claim, {
				claim,
				delivered,
				message,
				blocked,
				accepted: false,
				entered: false,
				answered: false,
				errored: false,
				settled: false,
			});
			refreshClaim(claim);
		},
		accepted(claim) {
			const pending = pendingDeliveries.get(claim);
			if (pending) {
				pending.accepted = true;
			}
			confirmDeliveries();
		},
		released(claim) {
			pendingDeliveries.delete(claim);
			activeDeliveries.delete(claim);
		},
	});
	const sendCompletion = (jobs: string, id: string, state: string, delivery: "own" | "fallback"): boolean => {
		const fallback = delivery === "fallback";
		if (!session) {
			return false;
		}
		const job = join(jobs, id);
		const label = text(join(job, "label")) || id;
		const branch = text(join(job, "branch"));
		const repo = text(join(job, "repo"));
		const slot = fallback ? "_fallback" : sessionId;
		if (!fallback && deliveryExists(job, sessionId)) {
			return false;
		}
		if (
			fallback &&
			(completionSlots(deliveredSlots(job)).length > 0 || session.isIdle() !== true || muted || !sessionOwns(jobs))
		) {
			return false;
		}
		const blocked = () => {
			try {
				session?.ui.notify(`limen: ${label} wake was unconfirmed twice; automatic delivery stopped (${id})`, "info");
			} catch {
				dropFooter("ui.notify failed");
			}
		};
		const eligible = () => {
			if (recoverClaims(job, (claim) => pendingDeliveries.has(claim))) {
				blocked();
			}
			if (!isTerminal(stateOf(jobs, id)) || !routable(job)) {
				return false;
			}
			// Read claims before delivered records: rename moves atomically between them, so one side is always visible.
			if (fallback) {
				return (
					session?.isIdle() === true &&
					!muted &&
					sessionOwns(jobs) &&
					completionSlots(claimSlots(job)).every((claim) => claim === "_fallback") &&
					completionSlots(deliveredSlots(job)).length === 0
				);
			}
			return (
				subscribed(job, sessionId) &&
				!existsSync(join(job, "notify", "claims", "_fallback")) &&
				!existsSync(join(job, "notify", "delivered", "_fallback"))
			);
		};
		const message = completionWake(job, label, state, id, branch, repo, fallback);
		const routed = claimDelivery(
			job,
			slot,
			eligible,
			() => {
				// Toast always — steers alone are easy to miss on a busy coordinator, and workers' steer inbox is not this session.
				try {
					session?.ui.notify(
						state === "done"
							? `limen: ${label} done; next step: land it, or name the check that blocks landing (${id})`
							: `limen: ${label} is ${state}; inspect failure (${id})`,
						"info",
					);
				} catch {
					dropFooter("ui.notify failed");
				}
				return injectWake(message);
			},
			deliveryCallbacks(message, blocked),
		);
		if (routed) {
			notifyHerdr(job, id, state, label, branch, slot);
		}
		return routed;
	};
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: split pending: wake advisory delivery
	// biome-ignore lint/complexity/noExcessiveLinesPerFunction: same split as the line above
	const sendAdvisory = (jobs: string, id: string, delivery: "own" | "fallback"): boolean => {
		const fallback = delivery === "fallback";
		if (!session) {
			return false;
		}
		const job = join(jobs, id);
		const genuine = text(join(job, "advisory"));
		const uncertainty = genuine ? undefined : readHostedUncertainty(job);
		if (
			!genuine &&
			(!uncertainty ||
				Date.now() - uncertainty.since < HOSTED_UNCERTAINTY_MS ||
				session.isIdle() !== true ||
				injectedThisSweep)
		) {
			return false;
		}
		const advisory = uncertainty ? hostedUncertaintyText(uncertainty) : genuine;
		const family = genuine ? "_advisory" : "_uncertainty";
		const slots = (names: readonly string[]) => names.filter((name) => receiptFamily(name) === family);
		const label = text(join(job, "label")) || id;
		const branch = text(join(job, "branch"));
		const repo = text(join(job, "repo"));
		const slot = `${family}.${fallback ? "_fallback" : sessionId}`;
		if (!fallback && deliveryExists(job, slot)) {
			return false;
		}
		if (
			fallback &&
			(slots(deliveredSlots(job)).length > 0 || session.isIdle() !== true || muted || !sessionOwns(jobs))
		) {
			return false;
		}
		const kind = uncertainty
			? "ownership observation unavailable"
			: advisory.startsWith("blocked")
				? "blocked"
				: advisory.startsWith("errored:")
					? "errored"
					: "idle";
		const blocked = () => {
			try {
				session?.ui.notify(
					`limen: ${label} advisory wake was unconfirmed twice; automatic delivery stopped (${id})`,
					"info",
				);
			} catch {
				dropFooter("ui.notify failed");
			}
		};
		const eligible = () => {
			if (recoverClaims(job, (claim) => pendingDeliveries.has(claim))) {
				blocked();
			}
			if (stateOf(jobs, id) !== "running" || !routable(job)) {
				return false;
			}
			if (uncertainty) {
				if (
					readHostedUncertainty(job)?.since !== uncertainty.since ||
					text(join(job, "advisory")) ||
					session?.isIdle() !== true ||
					injectedThisSweep
				) {
					return false;
				}
			} else if (!text(join(job, "advisory"))) {
				return false;
			}
			if (fallback) {
				return (
					session?.isIdle() === true &&
					!muted &&
					sessionOwns(jobs) &&
					slots(claimSlots(job)).every((claim) => claim === `${family}._fallback`) &&
					slots(deliveredSlots(job)).length === 0
				);
			}
			return (
				subscribed(job, sessionId) &&
				!existsSync(join(job, "notify", "claims", `${family}._fallback`)) &&
				!existsSync(join(job, "notify", "delivered", `${family}._fallback`))
			);
		};
		const message = uncertainty
			? `Limen job ${JSON.stringify(label)} (${id}) on branch ${branch}: ${advisory}. The job was running at dispatch. Inspect the saved observation; do not infer a timeout or stop authority from it.`
			: advisoryWake(job, label, id, branch, repo, advisory, fallback);
		const routed = claimDelivery(
			job,
			slot,
			eligible,
			() => {
				if (uncertainty) {
					if (!eligible()) {
						return false;
					}
					injectedThisSweep = true;
					return Promise.resolve(pi.sendUserMessage(message));
				}
				try {
					session?.ui.notify(
						kind === "errored" ? `limen: ${label} last turn failed (${id})` : `limen: ${label} is ${kind} (${id})`,
						"info",
					);
				} catch {
					dropFooter("ui.notify failed");
				}
				return injectWake(message);
			},
			deliveryCallbacks(message, blocked),
		);
		if (routed) {
			notifyHerdr(job, id, kind, label, branch, slot);
		}
		return routed;
	};
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: split pending: job observer in the wake hook
	const observe = (jobs: string, id: string) => {
		if (existsSync(join(jobs, id, "group"))) {
			return;
		}
		if (!session || !routable(join(jobs, id))) {
			return;
		}
		const state = stateOf(jobs, id);
		if (!isObservable(state)) {
			return;
		}
		const job = join(jobs, id);
		const own = subscribed(job, sessionId);
		const label = text(join(job, "label")) || id;
		const branch = text(join(job, "branch"));
		if (own && state === "running" && !muted && claimMarker(job, "started", sessionId)) {
			try {
				session.ui.notify(`limen: ${label} started (${id})`, "info");
			} catch {
				dropFooter("ui.notify failed");
			}
		}
		if (muted) {
			return;
		}
		if (state === "running") {
			const stamp = text(join(job, "advisory")) ? "advisory" : "ownership-uncertainty";
			if (!existsSync(join(job, stamp))) {
				return;
			}
			if (own) {
				sendAdvisory(jobs, id, "own");
			} else if (oldEnoughForFallback(job, join(job, stamp))) {
				sendAdvisory(jobs, id, "fallback");
			}
			return;
		}
		if (own && !deliveryExists(job, sessionId) && !deliveryExists(job, "_fallback")) {
			notifyHerdr(job, id, state, label, branch, sessionId);
		}
		if (own) {
			sendCompletion(jobs, id, state, "own");
		} else if (oldEnoughForFallback(job)) {
			sendCompletion(jobs, id, state, "fallback");
		}
	};
	const confirmDeliveries = () => {
		for (const pending of pendingDeliveries.values()) {
			if (!pending.accepted || !pending.settled) {
				continue;
			}
			if (!pending.errored && pending.entered && pending.answered) {
				confirmClaim(pending.claim, pending.delivered);
			} else if (recordUnconfirmed(pending.claim)) {
				pending.blocked();
			}
			pendingDeliveries.delete(pending.claim);
		}
	};
	const refreshPendingClaims = () => {
		for (const pending of pendingDeliveries.values()) {
			refreshClaim(pending.claim);
		}
	};
	const stampSweep = () => {
		if (!limenDir || Date.now() - lastSweepAt < CLAIM_STALE_MS) {
			return;
		}
		lastSweepAt = Date.now();
		try {
			writeFileSync(join(limenDir, "last-sweep"), `${new Date(lastSweepAt).toISOString()}\n${sessionId}\n`);
		} catch {
			// F043 treats an absent or stale stamp as no listener; never claim liveness we could not write.
		}
	};
	const sweep = () => {
		if (!active || !session || !jobsDir || sweeping) {
			return;
		}
		sweeping = true;
		void finishSweep(jobsDir);
	};
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: split pending: finish sweep in the wake hook
	const finishSweep = async (jobs: string) => {
		const generation = sessionGeneration;
		injectedThisSweep = false;
		refreshPendingClaims();
		stampSweep();
		try {
			// Watch events invalidate individual records; a bounded refresh recovers missed events and manual wake repair.
			if (Date.now() >= cacheExpiresAt) {
				settled.clear();
				ownsJobs = undefined;
				cacheExpiresAt = Date.now() + CACHE_REFRESH_MS;
			}
			const { observe: ids, running } = collectSweep(jobs, settled);
			if (initialSweep) {
				initialSweep = false;
				for (const id of running) {
					if (text(join(jobs, id, "advisory")) || readHostedUncertainty(join(jobs, id))) {
						observe(jobs, id);
					}
				}
			}
			await reapDeadJobs(jobs, firstDead, Date.now(), running);
			if (!active || generation !== sessionGeneration) {
				return;
			}
			for (const id of ids) {
				const job = join(jobs, id);
				if (stateOf(jobs, id) === "running" && !routable(job)) {
					enrollLegacyRunning(job);
				}
				observe(jobs, id);
				if (deliverySettled(job, sessionId)) {
					settled.add(id);
				}
			}
			await updateStatus(
				jobs,
				running.filter((id) => stateOf(jobs, id) === "running"),
				generation,
			);
		} catch {
			// Display and delivery are advisory; durable state remains on disk.
		} finally {
			sweeping = false;
			if (active && generation !== sessionGeneration) {
				sweep();
			}
		}
	};
	const scheduleSweep = () => {
		if (!active || changeTimer) {
			return;
		}
		changeTimer = setTimeout(() => {
			changeTimer = undefined;
			sweep();
		}, 50);
		changeTimer.unref();
	};
	pi.on("session_start", (_event, context) => {
		if (process.env.LIMEN_JOB === "1" || process.env.LIMEN_WAKE === "0") {
			return;
		}
		const root = projectRoot(context.cwd);
		if (!root) {
			return;
		}
		coordinator.start(root, context);
		stopTimers();
		const id = context.sessionManager.getSessionId();
		if (!SESSION_ID.test(id)) {
			return;
		}
		const jobs = join(root, ".limen", "jobs");
		try {
			mkdirSync(jobs, { recursive: true });
		} catch {
			return;
		}
		void registerProject(root).catch(() => {});
		active = true;
		sessionGeneration += 1;
		session = context;
		jobsDir = jobs;
		limenDir = join(root, ".limen");
		sessionId = id;
		lastSweepAt = 0;
		initialSweep = true;
		footerAlive = true;
		footerNoted = false;
		tabTail = undefined;
		ownerTurnAt = 0;
		finishedCache = undefined;
		pendingDeliveries.clear();
		activeDeliveries.clear();
		firstDead.clear();
		settled.clear();
		ownsJobs = undefined;
		cacheExpiresAt = 0;
		herdr = herdrTarget();
		const tab = process.env.HERDR_TAB_ID?.trim();
		for (const jobId of readdirSync(jobs)) {
			const job = join(jobs, jobId);
			if (stateOf(jobs, jobId) !== "running") {
				continue;
			}
			if (!routable(job)) {
				enrollLegacyRunning(job);
			}
			// A job recording origin-pane is woken through Herdr at finalize; subscribing here would wake the same coordinator twice.
			if (tab && text(join(job, "origin-tab")) === tab && !text(join(job, "origin-pane"))) {
				subscribeSession(job, id);
			}
			if (subscribed(job, id)) {
				claimMarker(job, "started", id);
			}
		}
		watcher = watch(jobs, { recursive: true }, (_event, filename) => {
			if (progressFilename(filename)) {
				return;
			}
			const path = filename?.replaceAll("\\", "/") ?? "";
			if (!filename) {
				settled.clear();
			} else {
				const id = path.split("/")[0];
				if (id) {
					settled.delete(id);
				}
			}
			// Claims do not schedule sweeps, but deleting a delivered slot must reopen a cached job on the next timer tick.
			if (notifyBookkeeping(filename)) {
				return;
			}
			if (!filename || !path.includes("/") || /^[^/]+\/notify(?:\/subscribers(?:\/|$)|$)/.test(path)) {
				ownsJobs = undefined;
			}
			scheduleSweep();
		});
		watcher.unref();
		watcher.on("error", () => {
			watcher?.close();
			cacheExpiresAt = 0;
			clearStatus();
		});
		sweepTimer = setInterval(sweep, 500);
		sweepTimer.unref();
		sweep();
	});
	pi.on("message_start", (event) => {
		const message = eventMessage(event);
		if (message?.role !== "user") {
			return;
		}
		// Every Limen wake opens with "Limen job"; any other user message is the owner's turn and resets the title's finished count.
		if (!message.content.startsWith("Limen job ")) {
			ownerTurnAt = Date.now();
		}
		const pending = [...pendingDeliveries.values()].find(
			(candidate) => !candidate.entered && candidate.message === message.content,
		);
		if (!pending) {
			return;
		}
		pending.entered = true;
		activeDeliveries.add(pending.claim);
	});
	pi.on("message_end", (event) => {
		const message = eventMessage(event);
		if (message?.role !== "assistant") {
			return;
		}
		coordinator.messageEnd(message.stopReason);
		const failed = message.stopReason === "error" || message.stopReason === "aborted";
		for (const claim of activeDeliveries) {
			const pending = pendingDeliveries.get(claim);
			if (!pending) {
				continue;
			}
			if (failed) {
				pending.errored = true;
			} else {
				pending.answered = true;
			}
		}
	});
	pi.on("agent_settled", () => {
		coordinator.settled();
		for (const pending of pendingDeliveries.values()) {
			pending.settled = true;
		}
		confirmDeliveries();
		activeDeliveries.clear();
		finishedCache = undefined;
		sweep();
	});
	pi.on("session_shutdown", () => {
		coordinator.shutdown();
		if (!active && !sweepTimer) {
			return;
		}
		watcher?.close();
		watcher = undefined;
		for (const pending of pendingDeliveries.values()) {
			try {
				writeFileSync(join(pending.claim, "live"), "closed\n");
			} catch {
				// The claim may already have been confirmed or recovered.
			}
		}
		pendingDeliveries.clear();
		activeDeliveries.clear();
		retire(false);
		releaseHerdr();
	});
	pi.on("tool_execution_start", (event) => coordinator.toolStart(event));
	pi.on("tool_execution_end", (event) => coordinator.toolEnd(event));
	pi.on("tool_result", (event) => coordinator.toolResult(event));
	pi.on("goal_updated", (event) => coordinator.goalUpdated(event));
	if (process.env.LIMEN_JOB === "1") {
		return;
	}
	pi.registerCommand?.("limen", {
		description: "Mute or resume limen job display and wakes for this session",
		getArgumentCompletions(prefix) {
			const items = ["on", "off"].filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value }));
			return items.length ? items : null;
		},
		handler(args, commandContext) {
			const request = args.trim();
			if (request === "on") {
				muted = false;
			} else if (request === "off") {
				muted = true;
			} else {
				muted = !muted;
			}
			if (active && session && jobsDir) {
				if (muted) {
					setStatus(undefined);
				} else {
					sweep();
				}
			}
			commandContext.ui.notify(`limen wake ${muted ? "off" : "on"}${active ? "" : " (inactive here)"}`, "info");
		},
	});
}

function collectSweep(
	jobs: string,
	settled: ReadonlySet<string>,
): { readonly observe: string[]; readonly running: string[] } {
	const observe: string[] = [];
	const running: string[] = [];
	for (const id of readdirSync(jobs).sort()) {
		if (settled.has(id)) {
			continue;
		}
		observe.push(id);
		if (stateOf(jobs, id) === "running") {
			running.push(id);
		}
	}
	return { observe, running };
}
export function progressFilename(filename: string | null): boolean {
	if (!filename) {
		return false;
	}
	return /^[^/]+\/(activity|last-tool)$/.test(filename.replaceAll("\\", "/"));
}
/** The job line: each running job with its pulse, then each finished job with its state, until it lands or closes. */
async function jobDisplay(
	jobs: string,
	session: string,
	runningIds: readonly string[],
	finished: readonly FinishedJob[],
): Promise<
	| {
			readonly status: string;
			readonly title: string;
			readonly summary: string;
			readonly pulses: readonly Pulse[];
			readonly watched: number;
	  }
	| undefined
> {
	const running = await Promise.all(
		runningIds.map(async (id) => {
			const label = text(join(jobs, id, "label")) || id;
			const pulse = await pulseOf(jobs, id);
			const tool = text(join(jobs, id, "last-tool"));
			const watching = subscribed(join(jobs, id), session);
			return {
				label,
				pulse,
				watching,
				status: `${shortLabel(label)} ${pulse === "tool" && tool ? `${pulse}:${tool}` : pulse}${watching ? "" : " (unwatched)"}`,
			};
		}),
	);
	if (running.length === 0 && finished.length === 0) {
		return undefined;
	}
	const summary = [
		running.map(({ status }) => status),
		finished.map(({ label, state }) => `${shortLabel(label)} ${state}`),
	]
		.filter((names) => names.length > 0)
		.map((names) => `${names.slice(0, 3).join(" ")}${names.length > 3 ? ` +${names.length - 3}` : ""}`)
		.join(" · ");
	const title =
		running.length === 0
			? `Limen · ${finished.length} finished`
			: running.length === 1
				? `Limen · ${shortLabel(running[0]?.label ?? "")}`
				: `Limen · ${running.length} jobs · ${running
						.slice(0, 3)
						.map(({ label }) => shortLabel(label))
						.join(" ")}`;
	return {
		status: `limen ${running.length} · ${summary}`,
		title,
		summary,
		pulses: running.map(({ pulse }) => pulse),
		watched: running.filter(({ watching }) => watching).length,
	};
}
/** Finished jobs this coordinator still answers for: terminal, spawned from its tab or watched by its session, not landed, and not closed. */
function finishedJobs(jobs: string, tab: string | undefined, session: string): FinishedJob[] {
	const root = dirname(dirname(jobs));
	// `limen close` and this line share one rule: a job leaves once every feature it names is in done/ or dropped/.
	const closed = closedFeatures(root);
	const candidates: Array<
		FinishedJob & { readonly branch: string; readonly repo: string; readonly landable: boolean }
	> = [];
	for (const id of readdirSync(jobs).sort()) {
		const job = join(jobs, id);
		const state = text(join(job, "state"));
		if (!isTerminal(state) || existsSync(join(job, "group"))) {
			continue;
		}
		if (!(tab && text(join(job, "origin-tab")) === tab) && !subscribed(job, session)) {
			continue;
		}
		const label = text(join(job, "label")) || id;
		if (closedJobFeatures(label, id, closed).length > 0) {
			continue;
		}
		const finishedAt = Date.parse(text(join(job, "finished-at"))) || 0;
		candidates.push({
			id,
			label,
			state,
			finishedAt,
			branch: text(join(job, "branch")),
			repo: text(join(job, "repo")),
			landable: text(join(job, "commits")) !== "",
		});
	}
	// Only a job with commits can land. Without commits it stays until its feature closes or `limen prune` retires the record.
	const landed = new Set<string>();
	for (const [repo, group] of Map.groupBy(
		candidates.filter(({ landable, branch }) => landable && branch),
		({ repo }) => repo,
	)) {
		try {
			const unlanded = unlandedBranches(
				repo ? join(root, repo) : root,
				group.map(({ branch }) => branch),
			);
			for (const job of group) {
				if (!unlanded.has(job.branch)) {
					landed.add(job.id);
				}
			}
		} catch {
			// Git state unknown: the job stays visible rather than silently dropped.
		}
	}
	return candidates.filter(({ id }) => !landed.has(id));
}
async function pulseOf(jobs: string, id: string): Promise<Pulse> {
	const pid = Number(text(join(jobs, id, "pid")));
	const recorded = Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
	const activity = text(join(jobs, id, "activity"));
	return derivePulse({
		alive: await ownerAlive(join(jobs, id)),
		...(recorded !== undefined ? { pid: recorded } : {}),
		...(activity ? { activity } : {}),
	});
}
function projectRoot(cwd: string): string | undefined {
	let dir = resolve(cwd);
	for (;;) {
		if (existsSync(join(dir, ".agents", "limen"))) {
			return dir;
		}
		const parent = dirname(dir);
		if (parent === dir) {
			return undefined;
		}
		dir = parent;
	}
}
function notifyBookkeeping(filename: string | null): boolean {
	if (!filename) {
		return false;
	}
	return /(?:^|\/)notify\/(claims|delivered|unconfirmed|seat)(?:\/|$)/.test(filename.replaceAll("\\", "/"));
}
function eventMessage(
	event: unknown,
): { readonly role: string; readonly content: string; readonly stopReason?: string } | undefined {
	if (!event || typeof event !== "object" || !("message" in event)) {
		return undefined;
	}
	const message = event.message;
	if (!message || typeof message !== "object" || !("role" in message) || typeof message.role !== "string") {
		return undefined;
	}
	const content = "content" in message && Array.isArray(message.content) ? message.content : [];
	const textContent = content
		.filter((part): part is { readonly type: "text"; readonly text: string } =>
			Boolean(
				part &&
					typeof part === "object" &&
					"type" in part &&
					part.type === "text" &&
					"text" in part &&
					typeof part.text === "string",
			),
		)
		.map((part) => part.text)
		.join("\n");
	const stopReason = "stopReason" in message && typeof message.stopReason === "string" ? message.stopReason : undefined;
	return { role: message.role, content: textContent, ...(stopReason ? { stopReason } : {}) };
}
/** The tab's current name, so a rewritten tail preserves whatever stem the coordinator set. */
function tabLabel(binary: string, tab: string): string | undefined {
	const result = spawnSync(binary, ["tab", "get", tab], { encoding: "utf8", timeout: 2_000 });
	if (result.status !== 0 || !result.stdout) {
		return undefined;
	}
	try {
		const row: unknown = JSON.parse(result.stdout);
		const label = record(record(record(row).result).tab).label;
		return typeof label === "string" ? label : undefined;
	} catch {
		return undefined;
	}
}
function record(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
function herdrTarget(): HerdrPane | undefined {
	const binary = herdrBinary();
	const pane = process.env.HERDR_PANE_ID;
	if (!binary || process.env.HERDR_ENV !== "1" || !pane) {
		return undefined;
	}
	return { binary, pane };
}
// The display agent names the lead pane, so it describes the lead: an idle lead waits on its jobs; a working lead only counts them.
function herdrDisplayAgent(pulses: readonly Pulse[], leadIdle: boolean): string {
	if (!pulses.length) {
		return "Limen coordinator";
	}
	const dead = pulses.filter((pulse) => pulse === "dead").length;
	if (dead > 0) {
		return `⚠ Limen · ${dead} of ${pulses.length} needs attention`;
	}
	const jobs = `${pulses.length} ${pulses.length === 1 ? "job" : "jobs"}`;
	return leadIdle ? `Limen · waiting on ${jobs}` : `Limen · ${jobs}`;
}
function shortLabel(label: string): string {
	const name = label.trim();
	const feature = /\bF\d{3,}\b/i.exec(name)?.[0];
	if (!feature) {
		return name;
	}
	const legacy = /^(F\d{3,})(?:-([^\s]+))?(?:\s+(.+))?$/i.exec(name);
	const words = (legacy ? legacy[3] || legacy[2]?.replaceAll("-", " ") || "" : name.replace(feature, ""))
		.replace(/^[\s·-]+|[\s·-]+$/g, "")
		.replace(/\s+/g, " ");
	return words ? `${words} · ${feature.toUpperCase()}` : feature.toUpperCase();
}
function stateOf(jobs: string, id: string): string {
	return text(join(jobs, id, "state"));
}
function text(path: string): string {
	if (!existsSync(path)) {
		return "";
	}
	return readFileSync(path, "utf8").trim();
}
function isObservable(state: string): boolean {
	return state === "running" || isTerminal(state);
}
