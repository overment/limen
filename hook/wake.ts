import { execFile } from "node:child_process";
import { appendFileSync, existsSync, type FSWatcher, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { derivePulse, type Pulse, producedNothing } from "../src/job.ts";
import { processGroupAlive, reapDeadJobs } from "../src/proc.ts";

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
	on(event: "session_start" | "session_shutdown" | "agent_settled" | "message_start" | "message_end", handler: (event: unknown, context: Context) => void): void;
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

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const FALLBACK_GRACE_MS = 2_000;
const CLAIM_STALE_MS = 30_000;
type HerdrPane = { readonly binary: string; readonly pane: string };

export default function limenWake(pi: PiApi): void {
	let watcher: FSWatcher | undefined;
	let statusTimer: NodeJS.Timeout | undefined;
	let sweepTimer: NodeJS.Timeout | undefined;
	let changeTimer: NodeJS.Timeout | undefined;
	let statusBody = "";
	let frame = 0;
	let active = false;
	let muted = false;
	let session: Context | undefined;
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
	const firstDead = new Map<string, number>();
	let sweeping = false;
	let injectedThisSweep = false;
	type PendingDelivery = {
		readonly claim: string;
		readonly delivered: string;
		readonly message: string;
		readonly blocked: () => void;
		accepted: boolean;
		entered: boolean;
		answered: boolean;
		settled: boolean;
	};
	const pendingDeliveries = new Map<string, PendingDelivery>();
	const activeDeliveries = new Set<string>();
	const herdrCall = (args: readonly string[]) => {
		if (!herdr) return;
		try {
			execFile(herdr.binary, args, { timeout: 2_000 }, () => {}).unref();
		} catch {
			// Herdr reporting is advisory; durable state remains on disk.
		}
	};
	const herdrReport = (body: string, title: string, pulses: readonly Pulse[] = []) => {
		if (!herdr) return;
		const signature = `${title}\0${body}`;
		if (signature === herdrMetadata && Date.now() - herdrMetadataAt < 60_000) return;
		herdrMetadata = signature;
		herdrMetadataAt = Date.now();
		const change = body
			? ["--title", title, "--display-agent", herdrDisplayAgent(pulses), "--token", `limen=${body}`, "--state-label", `idle=${body}`, "--state-label", `done=${body}`]
			: ["--clear-title", "--display-agent", "Limen coordinator", "--clear-token", "limen", "--clear-state-labels"];
		herdrCall(["pane", "report-metadata", herdr.pane, "--source", "limen", "--seq", String((herdrSeq += 1)), ...change, "--ttl-ms", "180000"]);
	};
	const releaseHerdr = () => {
		if (!herdr) return;
		herdrCall([
			"pane",
			"report-metadata",
			herdr.pane,
			"--source",
			"limen",
			"--seq",
			String((herdrSeq += 1)),
			"--clear-title",
			"--clear-display-agent",
			"--clear-token",
			"limen",
			"--clear-state-labels",
		]);
	};
	const stopTimers = () => {
		if (statusTimer) clearInterval(statusTimer);
		statusTimer = undefined;
		if (sweepTimer) clearInterval(sweepTimer);
		sweepTimer = undefined;
		if (changeTimer) clearTimeout(changeTimer);
		changeTimer = undefined;
	};
	const dropFooter = (reason: string) => {
		if (statusTimer) clearInterval(statusTimer);
		statusTimer = undefined;
		footerAlive = false;
		statusBody = "";
		frame = 0;
		if (footerNoted || !limenDir) return;
		footerNoted = true;
		try {
			appendFileSync(join(limenDir, "log"), `[limen ${new Date().toISOString()}] coordinator footer disabled: ${reason}; wake delivery remains active\n`);
		} catch {
			// Delivery and the liveness stamp remain the durable signals when this note cannot be written.
		}
	};
	const setStatus = (value: string | undefined) => {
		if (!session || !footerAlive) return;
		try {
			session.ui.setStatus("limen", value);
		} catch {
			dropFooter("setStatus failed");
		}
	};
	const retire = (reportHerdr = true) => {
		active = false;
		session = undefined;
		stopTimers();
		statusBody = "";
		frame = 0;
		if (reportHerdr) herdrReport("", "");
	};
	const clearStatus = (reportHerdr = true) => {
		if (statusTimer) clearInterval(statusTimer);
		statusTimer = undefined;
		statusBody = "";
		frame = 0;
		setStatus(undefined);
		if (reportHerdr) herdrReport("", "");
	};
	const drawStatus = () => {
		if (!active || !footerAlive || muted || !statusBody || !session) return;
		setStatus(`${SPINNER[frame]} ${statusBody}`);
		frame = (frame + 1) % SPINNER.length;
	};
	const updateStatus = (jobs: string) => {
		const next = runningDisplay(jobs, sessionId);
		if (!next) {
			clearStatus();
			return;
		}
		statusBody = next.status;
		herdrReport(next.status.slice("limen ".length), next.title, next.pulses);
		drawStatus();
		if (footerAlive && !statusTimer) {
			statusTimer = setInterval(drawStatus, 120);
			statusTimer.unref();
		}
	};
	const notifyHerdr = (job: string, id: string, state: string, label: string, branch: string, slot: string) => {
		if (!claimMarker(job, "herdr", slot)) return;
		herdrCall(["notification", "show", `limen: ${label} is ${state}`, "--body", `job ${id} · branch ${branch}`, "--sound", state === "done" ? "done" : "request"]);
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
			pendingDeliveries.set(claim, { claim, delivered, message, blocked, accepted: false, entered: false, answered: false, settled: false });
			refreshClaim(claim);
		},
		accepted(claim) {
			const pending = pendingDeliveries.get(claim);
			if (pending) pending.accepted = true;
			confirmDeliveries();
		},
		released(claim) {
			pendingDeliveries.delete(claim);
			activeDeliveries.delete(claim);
		},
	});
	const sendCompletion = (jobs: string, id: string, state: string, fallback: boolean): boolean => {
		if (!session) return false;
		const job = join(jobs, id);
		const label = text(join(job, "label")) || id;
		const branch = text(join(job, "branch"));
		const repo = text(join(job, "repo"));
		const slot = fallback ? "_fallback" : sessionId;
		if (fallback && (completionSlots(deliveredSlots(job)).length > 0 || session.isIdle() !== true || muted)) return false;
		const blocked = () => {
			try {
				session?.ui.notify(`limen: ${label} wake was unconfirmed twice; automatic delivery stopped (${id})`, "info");
			} catch {
				dropFooter("ui.notify failed");
			}
		};
		const eligible = () => {
			if (recoverClaims(job, (claim) => pendingDeliveries.has(claim))) blocked();
			if (!isTerminal(stateOf(jobs, id)) || !routable(job)) return false;
			// Read claims before delivered records: rename moves atomically between them, so one side is always visible.
			if (fallback)
				return (
					session?.isIdle() === true && !muted && completionSlots(claimSlots(job)).every((claim) => claim === "_fallback") && completionSlots(deliveredSlots(job)).length === 0
				);
			return subscribed(job, sessionId) && !existsSync(join(job, "notify", "claims", "_fallback")) && !existsSync(join(job, "notify", "delivered", "_fallback"));
		};
		const route = fallback ? " This completion was routed here because no subscribed coordinator received it." : "";
		const location = repo ? ` in repository ${repo}` : "";
		const next = jobProducedNothing(job)
			? " It produced nothing (0 tool calls, no commits). Inspect the job record and log/session to understand why, then resume focused work if the ticket remains open."
			: " Inspect the job record, branch diff and commits, log/session, and relevant checks. Use the accepted ticket intent to take the next safe step: merge acceptable reviewed work, or resume focused fixes and re-review.";
		const message = `Limen job ${JSON.stringify(label)} is ${state} (${id}) on branch ${branch}${location}.${route}${next} Keep the user informed; ask only when genuine product ambiguity, a scope or risk tradeoff, or an irreversible action needs a human decision.${handoffExcerpt(job)}`;
		const routed = claimDelivery(
			job,
			slot,
			eligible,
			() => {
				// Toast always — steers alone are easy to miss on a busy coordinator, and workers' steer inbox is not this session.
				try {
					session?.ui.notify(`limen: ${label} is ${state} (${id})`, "info");
				} catch {
					dropFooter("ui.notify failed");
				}
				return injectWake(message);
			},
			deliveryCallbacks(message, blocked),
		);
		if (routed) notifyHerdr(job, id, state, label, branch, slot);
		return routed;
	};
	const sendAdvisory = (jobs: string, id: string, fallback: boolean): boolean => {
		if (!session) return false;
		const job = join(jobs, id);
		const advisory = text(join(job, "advisory"));
		if (!advisory) return false;
		const label = text(join(job, "label")) || id;
		const branch = text(join(job, "branch"));
		const repo = text(join(job, "repo"));
		const slot = fallback ? "_advisory._fallback" : `_advisory.${sessionId}`;
		if (fallback && (advisorySlots(deliveredSlots(job)).length > 0 || session.isIdle() !== true || muted)) return false;
		const kind = advisory.startsWith("blocked") ? "blocked" : "idle";
		const blocked = () => {
			try {
				session?.ui.notify(`limen: ${label} advisory wake was unconfirmed twice; automatic delivery stopped (${id})`, "info");
			} catch {
				dropFooter("ui.notify failed");
			}
		};
		const eligible = () => {
			if (recoverClaims(job, (claim) => pendingDeliveries.has(claim))) blocked();
			if (stateOf(jobs, id) !== "running" || !text(join(job, "advisory")) || !routable(job)) return false;
			if (fallback)
				return (
					session?.isIdle() === true &&
					!muted &&
					advisorySlots(claimSlots(job)).every((claim) => claim === "_advisory._fallback") &&
					advisorySlots(deliveredSlots(job)).length === 0
				);
			return (
				subscribed(job, sessionId) && !existsSync(join(job, "notify", "claims", "_advisory._fallback")) && !existsSync(join(job, "notify", "delivered", "_advisory._fallback"))
			);
		};
		const route = fallback ? " This advisory was routed here because no subscribed coordinator received it." : "";
		const location = repo ? ` in repository ${repo}` : "";
		const message = `Limen job ${JSON.stringify(label)} is still running (${id}) on branch ${branch}${location}: ${advisory}.${route} Inspect the job record and continue the loop; steer; or open the tab and exit if you mean the session to end.${handoffExcerpt(job)}`;
		const routed = claimDelivery(
			job,
			slot,
			eligible,
			() => {
				try {
					session?.ui.notify(`limen: ${label} is ${kind} (${id})`, "info");
				} catch {
					dropFooter("ui.notify failed");
				}
				return injectWake(message);
			},
			deliveryCallbacks(message, blocked),
		);
		if (routed) notifyHerdr(job, id, kind, label, branch, slot);
		return routed;
	};
	const observe = (jobs: string, id: string) => {
		if (!session || !routable(join(jobs, id))) return;
		const state = stateOf(jobs, id);
		if (!isObservable(state)) return;
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
		if (muted) return;
		if (state === "running") {
			if (!text(join(job, "advisory"))) return;
			if (own) sendAdvisory(jobs, id, false);
			else if (oldEnoughForFallback(job, join(job, "advisory"))) sendAdvisory(jobs, id, true);
			return;
		}
		if (own && !deliveryExists(job, sessionId) && !deliveryExists(job, "_fallback")) notifyHerdr(job, id, state, label, branch, sessionId);
		if (own) sendCompletion(jobs, id, state, false);
		else if (oldEnoughForFallback(job)) sendCompletion(jobs, id, state, true);
	};
	const confirmDeliveries = () => {
		for (const pending of pendingDeliveries.values()) {
			if (!pending.accepted || !pending.settled) continue;
			if (pending.entered && pending.answered) confirmClaim(pending.claim, pending.delivered);
			else if (recordUnconfirmed(pending.claim)) pending.blocked();
			pendingDeliveries.delete(pending.claim);
		}
	};
	const refreshPendingClaims = () => {
		for (const pending of pendingDeliveries.values()) refreshClaim(pending.claim);
	};
	const stampSweep = () => {
		if (!limenDir || Date.now() - lastSweepAt < CLAIM_STALE_MS) return;
		lastSweepAt = Date.now();
		try {
			writeFileSync(join(limenDir, "last-sweep"), `${new Date(lastSweepAt).toISOString()}\n${sessionId}\n`);
		} catch {
			// F043 treats an absent or stale stamp as no listener; never claim liveness we could not write.
		}
	};
	const sweep = () => {
		if (!active || !session || !jobsDir || sweeping) return;
		sweeping = true;
		void finishSweep(jobsDir);
	};
	const finishSweep = async (jobs: string) => {
		injectedThisSweep = false;
		refreshPendingClaims();
		stampSweep();
		try {
			if (initialSweep) {
				initialSweep = false;
				for (const id of readdirSync(jobs).sort()) {
					const job = join(jobs, id);
					if (stateOf(jobs, id) === "running" && text(join(job, "advisory"))) observe(jobs, id);
				}
			}
			await reapDeadJobs(jobs, firstDead);
			for (const id of readdirSync(jobs).sort()) {
				const job = join(jobs, id);
				if (stateOf(jobs, id) === "running" && !routable(job)) enrollLegacyRunning(job);
				observe(jobs, id);
			}
			updateStatus(jobs);
		} catch {
			// Display and delivery are advisory; durable state remains on disk.
		}
		sweeping = false;
	};
	const scheduleSweep = () => {
		if (!active || changeTimer) return;
		changeTimer = setTimeout(() => {
			changeTimer = undefined;
			sweep();
		}, 50);
		changeTimer.unref();
	};
	pi.on("session_start", (_event, context) => {
		if (process.env.LIMEN_JOB === "1" || process.env.LIMEN_WAKE === "0") return;
		const root = projectRoot(context.cwd);
		if (!root) return;
		stopTimers();
		const id = context.sessionManager.getSessionId();
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) return;
		const jobs = join(root, ".limen", "jobs");
		try {
			mkdirSync(jobs, { recursive: true });
		} catch {
			return;
		}
		active = true;
		session = context;
		jobsDir = jobs;
		limenDir = join(root, ".limen");
		sessionId = id;
		lastSweepAt = 0;
		initialSweep = true;
		footerAlive = true;
		footerNoted = false;
		pendingDeliveries.clear();
		activeDeliveries.clear();
		firstDead.clear();
		sweeping = false;
		herdr = herdrTarget();
		for (const jobId of readdirSync(jobs)) {
			const job = join(jobs, jobId);
			if (stateOf(jobs, jobId) === "running" && !routable(job)) enrollLegacyRunning(job);
			if (subscribed(job, id) && stateOf(jobs, jobId) === "running") claimMarker(job, "started", id);
		}
		watcher = watch(jobs, { recursive: true }, (_event, filename) => {
			if (notifyBookkeeping(filename)) return;
			scheduleSweep();
		});
		watcher.unref();
		watcher.on("error", () => {
			watcher?.close();
			clearStatus();
		});
		sweepTimer = setInterval(sweep, 500);
		sweepTimer.unref();
		sweep();
	});
	pi.on("message_start", (event) => {
		const message = eventMessage(event);
		if (!message || message.role !== "user") return;
		const pending = [...pendingDeliveries.values()].find((candidate) => !candidate.entered && candidate.message === message.content);
		if (!pending) return;
		pending.entered = true;
		activeDeliveries.add(pending.claim);
	});
	pi.on("message_end", (event) => {
		const message = eventMessage(event);
		if (!message || message.role !== "assistant" || message.stopReason === "error" || message.stopReason === "aborted") return;
		for (const claim of activeDeliveries) {
			const pending = pendingDeliveries.get(claim);
			if (pending) pending.answered = true;
		}
	});
	pi.on("agent_settled", () => {
		for (const pending of pendingDeliveries.values()) pending.settled = true;
		confirmDeliveries();
		activeDeliveries.clear();
		sweep();
	});
	pi.on("session_shutdown", () => {
		if (!active && !statusTimer && !sweepTimer) return;
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
	if (process.env.LIMEN_JOB === "1") return;
	pi.registerCommand?.("limen", {
		description: "Mute or resume limen job display and wakes for this session",
		getArgumentCompletions(prefix) {
			const items = ["on", "off"].filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value }));
			return items.length ? items : null;
		},
		handler(args, commandContext) {
			const request = args.trim();
			muted = request === "on" ? false : request === "off" ? true : !muted;
			if (active && session && jobsDir) {
				if (muted) setStatus(undefined);
				else sweep();
			}
			commandContext.ui.notify(`limen wake ${muted ? "off" : "on"}${active ? "" : " (inactive here)"}`, "info");
		},
	});
}

/** Bounded commits and final-message excerpts; either is omitted when its file is absent — that absence is information. */
function handoffExcerpt(job: string): string {
	const sections: string[] = [];
	const stop = text(join(job, "stop-reason"));
	if (stop) sections.push(`Stop reason: ${stop}`);
	const commits = existsSync(join(job, "commits")) ? text(join(job, "commits")) : undefined;
	if (commits !== undefined) {
		const lines = commits.split("\n").filter(Boolean);
		sections.push(lines.length ? `Commits:\n${lines.slice(0, 10).join("\n")}${lines.length > 10 ? `\n… ${lines.length - 10} more` : ""}` : "Commits: none");
	}
	const result = text(join(job, "result"));
	if (result) {
		const head = result.split("\n").slice(0, 15).join("\n").slice(0, 1200);
		sections.push(`Final message:\n${head}${head.length < result.length ? "\n… (full text in the job record)" : ""}`);
	}
	try {
		const unseen = readdirSync(join(job, "steer", "inbox")).length;
		if (unseen) sections.push(`${unseen} steer(s) never delivered`);
	} catch {
		// Inbox may be absent; that is not an undelivered steer.
	}
	return sections.length ? `\n\n${sections.join("\n\n")}` : "";
}
function jobProducedNothing(job: string): boolean {
	const commits = existsSync(join(job, "commits")) ? text(join(job, "commits")) : undefined;
	return producedNothing(recordedToolCalls(job), commits);
}
function recordedToolCalls(job: string): number | undefined {
	const value = text(join(job, "tool-calls"));
	if (!value) return undefined;
	const count = Number(value);
	return Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}

function runningDisplay(jobs: string, session: string): { readonly status: string; readonly title: string; readonly pulses: readonly Pulse[] } | undefined {
	const running = readdirSync(jobs)
		.sort()
		.filter((id) => stateOf(jobs, id) === "running")
		.map((id) => {
			const label = text(join(jobs, id, "label")) || id;
			const pulse = pulseOf(jobs, id);
			const tool = text(join(jobs, id, "last-tool"));
			const watching = subscribed(join(jobs, id), session);
			return { label, pulse, status: `${shortLabel(label)} ${pulse === "tool" && tool ? `${pulse}:${tool}` : pulse}${watching ? "" : " (unwatched)"}` };
		});
	if (running.length === 0) return undefined;
	const summary = `${running
		.slice(0, 3)
		.map(({ status }) => status)
		.join(" ")}${running.length > 3 ? ` +${running.length - 3}` : ""}`;
	const title =
		running.length === 1
			? `Limen · ${running[0]?.label}`
			: `Limen · ${running.length} jobs · ${running
					.slice(0, 3)
					.map(({ label }) => shortLabel(label))
					.join(" ")}`;
	return { status: `limen ${running.length} · ${summary}`, title, pulses: running.map(({ pulse }) => pulse) };
}
function pulseOf(jobs: string, id: string): Pulse {
	const pid = Number(text(join(jobs, id, "pid")));
	const recorded = Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
	const activity = text(join(jobs, id, "activity"));
	return derivePulse({
		alive: recorded !== undefined && processGroupAlive(recorded),
		...(recorded !== undefined ? { pid: recorded } : {}),
		...(activity ? { activity } : {}),
	});
}
type DeliveryCallbacks = {
	readonly blocked: () => void;
	readonly protected: (claim: string) => boolean;
	readonly pending: (claim: string, delivered: string) => void;
	readonly accepted: (claim: string) => void;
	readonly released: (claim: string) => void;
};
function claimDelivery(job: string, slot: string, eligible: () => boolean, send: () => void | Promise<void>, callbacks: DeliveryCallbacks): boolean {
	const claim = join(job, "notify", "claims", slot);
	const delivered = join(job, "notify", "delivered", slot);
	mkdirSync(join(job, "notify", "claims"), { recursive: true });
	mkdirSync(join(job, "notify", "delivered"), { recursive: true });
	if (!callbacks.protected(claim)) {
		const recovered = recoverClaim(claim);
		if (recovered) callbacks.released(claim);
		if (recovered === "blocked") callbacks.blocked();
	}
	if (existsSync(delivered) || existsSync(claim)) return false;
	try {
		mkdirSync(claim);
		writeFileSync(join(claim, "owner"), `${process.pid}\n${new Date().toISOString()}\n`);
	} catch {
		return false;
	}
	if (!eligible()) {
		rmSync(claim, { recursive: true, force: true });
		return false;
	}
	callbacks.pending(claim, delivered);
	try {
		const injected = send();
		const accept = () => {
			writeFileSync(join(claim, "accepted"), "1\n");
			callbacks.accepted(claim);
		};
		const reject = () => {
			callbacks.released(claim);
			rmSync(claim, { recursive: true, force: true });
			try {
				appendFileSync(join(job, "log"), `[limen ${new Date().toISOString()}] wake injection failed; the next sweep retries\n`);
			} catch {
				// The log is best-effort; the released claim is the durable fact.
			}
		};
		if (injected instanceof Promise) injected.then(accept, reject);
		else accept();
		return true;
	} catch {
		callbacks.released(claim);
		rmSync(claim, { recursive: true, force: true });
		return false;
	}
}
function recoverClaim(claim: string): "released" | "blocked" | undefined {
	try {
		if (!existsSync(claim) || existsSync(join(claim, "blocked"))) return undefined;
		if (Date.now() - statSync(claim).mtimeMs < CLAIM_STALE_MS) return undefined;
		if (existsSync(join(claim, "accepted"))) {
			const live = join(claim, "live");
			if (text(live) !== "closed" && existsSync(live) && Date.now() - statSync(live).mtimeMs < CLAIM_STALE_MS) return undefined;
			if (recordUnconfirmed(claim)) return "blocked";
			return existsSync(claim) ? undefined : "released";
		}
		rmSync(claim, { recursive: true, force: true });
		return "released";
	} catch {
		// Another coordinator recovered it first.
	}
	return undefined;
}
function refreshClaim(claim: string): void {
	try {
		writeFileSync(join(claim, "live"), `${new Date().toISOString()}\n`);
	} catch {
		// A missing claim was confirmed or recovered between the sweep and this heartbeat.
	}
}
function recordUnconfirmed(claim: string): boolean {
	try {
		if (!existsSync(claim) || existsSync(join(claim, "blocked"))) return false;
		const slot = claim.slice(claim.lastIndexOf("/") + 1);
		const notify = dirname(dirname(claim));
		const attemptsDir = join(notify, "unconfirmed");
		const attemptsFile = join(attemptsDir, isAdvisorySlot(slot) ? "_advisory" : "_completion");
		mkdirSync(attemptsDir, { recursive: true });
		const attempts = Number(text(attemptsFile)) + 1;
		writeFileSync(attemptsFile, `${attempts}\n`);
		if (attempts < 2) {
			rmSync(claim, { recursive: true, force: true });
			return false;
		}
		writeFileSync(join(claim, "blocked"), "automatic retries stopped after two unconfirmed injections\n", { flag: "wx" });
		const job = dirname(notify);
		appendFileSync(
			join(job, "log"),
			`[limen ${new Date().toISOString()}] wake remained unconfirmed after two accepted injections; automatic retries stopped; claim retained for human recovery\n`,
		);
		return true;
	} catch {
		return false;
	}
}
function confirmClaim(claim: string, delivered: string): void {
	try {
		if (!existsSync(join(claim, "accepted"))) return;
		if (!existsSync(delivered)) renameSync(claim, delivered);
		else rmSync(claim, { recursive: true, force: true });
		const slot = delivered.slice(delivered.lastIndexOf("/") + 1);
		rmSync(join(dirname(dirname(delivered)), "unconfirmed", isAdvisorySlot(slot) ? "_advisory" : "_completion"), { force: true });
	} catch {
		// Another coordinator confirmed or recovered it first.
	}
}
function deliveredSlots(job: string): string[] {
	try {
		return readdirSync(join(job, "notify", "delivered"));
	} catch {
		return [];
	}
}
function claimSlots(job: string): string[] {
	try {
		return readdirSync(join(job, "notify", "claims"));
	} catch {
		return [];
	}
}
function recoverClaims(job: string, protectedClaim: (claim: string) => boolean = () => false): boolean {
	let blocked = false;
	for (const slot of claimSlots(job)) {
		const claim = join(job, "notify", "claims", slot);
		if (!protectedClaim(claim) && recoverClaim(claim) === "blocked") blocked = true;
	}
	return blocked;
}
function claimMarker(job: string, kind: string, slot: string): boolean {
	const root = join(job, "notify", kind);
	mkdirSync(root, { recursive: true });
	try {
		writeFileSync(join(root, slot), "1\n", { flag: "wx" });
		return true;
	} catch {
		return false;
	}
}
function deliveryExists(job: string, slot: string): boolean {
	return existsSync(join(job, "notify", "delivered", slot));
}
function subscribed(job: string, session: string): boolean {
	return routable(job) && existsSync(join(job, "notify", "subscribers", session));
}
function routable(job: string): boolean {
	return existsSync(join(job, "notify", "ready"));
}
function enrollLegacyRunning(job: string): void {
	mkdirSync(join(job, "notify", "subscribers"), { recursive: true });
	try {
		writeFileSync(join(job, "notify", "ready"), "1\n", { flag: "wx" });
	} catch {
		// Another coordinator enrolled it first.
	}
}
function oldEnoughForFallback(job: string, stamp = join(job, "finished-at")): boolean {
	const finished = Date.parse(text(stamp));
	const since = Number.isFinite(finished) ? finished : statSync(existsSync(stamp) ? stamp : join(job, "state")).mtimeMs;
	return Date.now() - since >= FALLBACK_GRACE_MS;
}
function isAdvisorySlot(slot: string): boolean {
	return slot.startsWith("_advisory.");
}
function advisorySlots(names: readonly string[]): string[] {
	return names.filter((name) => isAdvisorySlot(name));
}
function completionSlots(names: readonly string[]): string[] {
	return names.filter((name) => !isAdvisorySlot(name));
}
function projectRoot(cwd: string): string | undefined {
	let dir = resolve(cwd);
	for (;;) {
		if (existsSync(join(dir, ".agents", "limen"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}
function notifyBookkeeping(filename: string | null): boolean {
	if (!filename) return false;
	return /(?:^|\/)notify\/(claims|delivered|unconfirmed)(?:\/|$)/.test(filename.replaceAll("\\", "/"));
}
function eventMessage(event: unknown): { readonly role: string; readonly content: string; readonly stopReason?: string } | undefined {
	if (!event || typeof event !== "object" || !("message" in event)) return undefined;
	const message = event.message;
	if (!message || typeof message !== "object" || !("role" in message) || typeof message.role !== "string") return undefined;
	const content = "content" in message && Array.isArray(message.content) ? message.content : [];
	const textContent = content
		.filter((part): part is { readonly type: "text"; readonly text: string } =>
			Boolean(part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string"),
		)
		.map((part) => part.text)
		.join("\n");
	const stopReason = "stopReason" in message && typeof message.stopReason === "string" ? message.stopReason : undefined;
	return { role: message.role, content: textContent, ...(stopReason ? { stopReason } : {}) };
}
function herdrTarget(): HerdrPane | undefined {
	const binary = process.env.LIMEN_HERDR || "herdr";
	const pane = process.env.HERDR_PANE_ID;
	if (binary === "0" || process.env.HERDR_ENV !== "1" || !pane) return undefined;
	return { binary, pane };
}
function herdrDisplayAgent(pulses: readonly Pulse[]): string {
	if (!pulses.length) return "Limen coordinator";
	if (pulses.includes("dead")) return `⚠ Limen · ${pulses.length} needs attention`;
	const states = [...new Set(pulses)];
	const glyph = (pulse: Pulse): string => ({ starting: "✦", think: "◌", tool: "⚙", wait: "◴", dead: "⚠" })[pulse];
	if (states.length > 1) return `${states.map(glyph).join("")} Limen · ${pulses.length} active`;
	const state = states[0] as Pulse;
	const description: Record<Pulse, string> = { starting: "waking", think: "thinking", tool: "working", wait: "waiting", dead: "needs attention" };
	return `${glyph(state)} Limen · ${pulses.length} ${description[state]}`;
}
function shortLabel(label: string): string {
	return /\bF\d{3,}\b/i.exec(label)?.[0]?.toUpperCase() ?? label.split(/\s+/, 1)[0]?.slice(0, 12) ?? "job";
}
function stateOf(jobs: string, id: string): string {
	return text(join(jobs, id, "state"));
}
function text(path: string): string {
	if (!existsSync(path)) return "";
	return readFileSync(path, "utf8").trim();
}
function isObservable(state: string): boolean {
	return state === "running" || isTerminal(state);
}
function isTerminal(state: string): boolean {
	return state === "done" || state === "failed" || state === "stopped";
}
