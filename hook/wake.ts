import { execFile } from "node:child_process";
import { existsSync, type FSWatcher, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { reapDeadJobs } from "../src/proc.ts";

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
	on(event: "session_start" | "session_shutdown" | "agent_settled", handler: (event: unknown, context: Context) => void): void;
	sendUserMessage(content: string, options?: { readonly deliverAs: "steer" | "followUp" }): void;
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
type Pulse = "starting" | "think" | "tool" | "wait" | "dead";

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
	let herdr: HerdrPane | undefined;
	let herdrSeq = Date.now();
	let herdrMetadata: string | undefined;
	let herdrMetadataAt = 0;
	const firstDead = new Map<string, number>();
	let sweeping = false;
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
	const setStatus = (value: string | undefined) => {
		if (!session) return;
		try {
			session.ui.setStatus("limen", value);
		} catch {
			// `/reload` and session replacement invalidate the captured ctx; never crash Pi.
			retire(false);
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
		if (!active || muted || !statusBody || !session) return;
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
		if (!statusTimer) {
			statusTimer = setInterval(drawStatus, 120);
			statusTimer.unref();
		}
	};
	const notifyHerdr = (job: string, id: string, state: string, label: string, branch: string, slot: string) => {
		if (!claimMarker(job, "herdr", slot)) return;
		herdrCall(["notification", "show", `limen: ${label} is ${state}`, "--body", `job ${id} · branch ${branch}`, "--sound", state === "done" ? "done" : "request"]);
	};
	const sendCompletion = (jobs: string, id: string, state: string, fallback: boolean): boolean => {
		if (!session) return false;
		const job = join(jobs, id);
		const label = text(join(job, "label")) || id;
		const branch = text(join(job, "branch"));
		const repo = text(join(job, "repo"));
		const slot = fallback ? "_fallback" : sessionId;
		if (fallback && (deliveredSlots(job).length > 0 || session.isIdle() !== true || muted)) return false;
		const eligible = () => {
			recoverClaims(job);
			if (!isTerminal(stateOf(jobs, id)) || !routable(job)) return false;
			// Read claims before delivered records: rename moves atomically between them, so one side is always visible.
			if (fallback) return session?.isIdle() === true && !muted && claimSlots(job).every((claim) => claim === "_fallback") && deliveredSlots(job).length === 0;
			return subscribed(job, sessionId) && !existsSync(join(job, "notify", "claims", "_fallback")) && !existsSync(join(job, "notify", "delivered", "_fallback"));
		};
		const routed = claimDelivery(job, slot, eligible, () => {
			const route = fallback ? " This completion was routed here because no subscribed coordinator received it." : "";
			const location = repo ? ` in repository ${repo}` : "";
			const message = `Limen job ${JSON.stringify(label)} is ${state} (${id}) on branch ${branch}${location}.${route} Inspect the job record, branch diff and commits, log/session, and relevant checks. Use the accepted ticket intent to take the next safe step: merge acceptable reviewed work, or resume focused fixes and re-review. Keep the user informed; ask only when genuine product ambiguity, a scope or risk tradeoff, or an irreversible action needs a human decision.${handoffExcerpt(job)}`;
			// Toast always — steers alone are easy to miss on a busy coordinator, and workers' steer inbox is not this session.
			try {
				session?.ui.notify(`limen: ${label} is ${state} (${id})`, "info");
			} catch {
				retire(false);
			}
			// Idle: real user turn. Streaming: followUp waits until tools finish (steer interrupts mid-turn and is easy to miss).
			if (session?.isIdle()) pi.sendUserMessage(message);
			else pi.sendUserMessage(message, { deliverAs: "followUp" });
		});
		if (routed) notifyHerdr(job, id, state, label, branch, slot);
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
				retire(false);
			}
		}
		if (state === "running" || muted) return;
		if (own && !deliveryExists(job, sessionId) && !deliveryExists(job, "_fallback")) notifyHerdr(job, id, state, label, branch, sessionId);
		if (own) sendCompletion(jobs, id, state, false);
		else if (oldEnoughForFallback(job)) sendCompletion(jobs, id, state, true);
	};
	const sweep = () => {
		if (!active || !session || !jobsDir || sweeping) return;
		sweeping = true;
		void finishSweep(jobsDir);
	};
	const finishSweep = async (jobs: string) => {
		try {
			await reapDeadJobs(jobs, firstDead);
			for (const id of readdirSync(jobs)) {
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
		sessionId = id;
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
	pi.on("agent_settled", sweep);
	pi.on("session_shutdown", () => {
		if (!active && !statusTimer && !sweepTimer) return;
		watcher?.close();
		watcher = undefined;
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
	if (existsSync(join(job, "commits"))) {
		const lines = text(join(job, "commits")).split("\n").filter(Boolean);
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
	// Keep identical to src/job.ts derivePulse.
	const pid = Number(text(join(jobs, id, "pid")));
	const recorded = Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
	const activity = text(join(jobs, id, "activity"));
	if (recorded === undefined) return "starting";
	if (!processGroupAlive(recorded)) return "dead";
	if (activity === "tool" || activity === "wait") return activity;
	return "think";
}
function processGroupAlive(pid: number): boolean {
	try {
		process.kill(-pid, 0);
		return true;
	} catch (error) {
		return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
	}
}
function claimDelivery(job: string, slot: string, eligible: () => boolean, send: () => void): boolean {
	const claim = join(job, "notify", "claims", slot);
	const delivered = join(job, "notify", "delivered", slot);
	mkdirSync(join(job, "notify", "claims"), { recursive: true });
	mkdirSync(join(job, "notify", "delivered"), { recursive: true });
	recoverClaim(claim, delivered);
	if (existsSync(delivered)) return false;
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
	try {
		send();
		writeFileSync(join(claim, "accepted"), "1\n");
		renameSync(claim, delivered);
		return true;
	} catch {
		rmSync(claim, { recursive: true, force: true });
		return false;
	}
}
function recoverClaim(claim: string, delivered: string): void {
	try {
		if (!existsSync(claim)) return;
		const age = Date.now() - statSync(claim).mtimeMs;
		if (age < CLAIM_STALE_MS) return;
		if (existsSync(join(claim, "accepted"))) {
			if (!existsSync(delivered)) renameSync(claim, delivered);
			else rmSync(claim, { recursive: true, force: true });
			return;
		}
		rmSync(claim, { recursive: true, force: true });
	} catch {
		// Another coordinator recovered it first.
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
function recoverClaims(job: string): void {
	for (const slot of claimSlots(job)) recoverClaim(join(job, "notify", "claims", slot), join(job, "notify", "delivered", slot));
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
function oldEnoughForFallback(job: string): boolean {
	const finished = Date.parse(text(join(job, "finished-at")));
	const since = Number.isFinite(finished) ? finished : statSync(join(job, "state")).mtimeMs;
	return Date.now() - since >= FALLBACK_GRACE_MS;
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
	return /(?:^|\/)notify\/(claims|delivered)(?:\/|$)/.test(filename.replaceAll("\\", "/"));
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
