import { execFile } from "node:child_process";
import { existsSync, type FSWatcher, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";

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
	sendUserMessage(content: string, options?: { readonly deliverAs: "steer" }): void;
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
	let statusBody = "";
	let frame = 0;
	let active = false;
	let muted = false;
	let session: Context | undefined;
	let jobsDir: string | undefined;
	let sessionId = "";
	let herdr: HerdrPane | undefined;
	let herdrSeq = Date.now();
	let herdrToken = "";
	let herdrTokenAt = 0;
	const herdrCall = (args: readonly string[]) => {
		if (!herdr) return;
		try {
			execFile(herdr.binary, args, { timeout: 2_000 }, () => {}).unref();
		} catch {
			// Herdr reporting is advisory; durable state remains on disk.
		}
	};
	const herdrReportToken = (body: string) => {
		if (!herdr) return;
		if (body === herdrToken && (body === "" || Date.now() - herdrTokenAt < 60_000)) return;
		herdrToken = body;
		herdrTokenAt = Date.now();
		const change = body
			? ["--token", `limen=${body}`, "--state-label", `idle=${body}`, "--state-label", `done=${body}`, "--ttl-ms", "180000"]
			: ["--clear-token", "limen", "--clear-state-labels"];
		herdrCall(["pane", "report-metadata", herdr.pane, "--source", "limen", "--seq", String((herdrSeq += 1)), ...change]);
	};
	const clearStatus = (context: Context) => {
		if (statusTimer) clearInterval(statusTimer);
		statusTimer = undefined;
		statusBody = "";
		frame = 0;
		context.ui.setStatus("limen", undefined);
		herdrReportToken("");
	};
	const updateStatus = (jobs: string, context: Context) => {
		const draw = () => {
			const next = runningStatus(jobs, sessionId);
			if (!next) {
				clearStatus(context);
				return;
			}
			statusBody = next;
			herdrReportToken(next.slice("limen ".length));
			if (muted) return;
			context.ui.setStatus("limen", `${SPINNER[frame]} ${statusBody}`);
			frame = (frame + 1) % SPINNER.length;
		};
		draw();
		if (statusBody && !statusTimer) {
			statusTimer = setInterval(draw, 120);
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
			const message = `Limen job ${JSON.stringify(label)} is ${state} (${id}) on branch ${branch}${location}.${route} Inspect the job record, branch diff and commits, log/session, and relevant checks. Use the accepted ticket intent to take the next safe step: merge acceptable reviewed work, or resume focused fixes and re-review. Keep the user informed; ask only when genuine product ambiguity, a scope or risk tradeoff, or an irreversible action needs a human decision.`;
			if (session?.isIdle()) pi.sendUserMessage(message);
			else pi.sendUserMessage(message, { deliverAs: "steer" });
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
		if (own && state !== "running" && !deliveryExists(job, sessionId) && !deliveryExists(job, "_fallback")) notifyHerdr(job, id, state, label, branch, sessionId);
		if (own && state === "running" && !muted && claimMarker(job, "started", sessionId)) session.ui.notify(`limen: ${label} started (${id})`, "info");
		if (state === "running" || muted) return;
		if (own) sendCompletion(jobs, id, state, false);
		else if (oldEnoughForFallback(job)) sendCompletion(jobs, id, state, true);
	};
	const sweep = () => {
		if (!active || !session || !jobsDir) return;
		try {
			for (const id of readdirSync(jobsDir)) {
				const job = join(jobsDir, id);
				if (stateOf(jobsDir, id) === "running" && !routable(job)) enrollLegacyRunning(job);
				observe(jobsDir, id);
			}
			updateStatus(jobsDir, session);
		} catch {
			// Display and delivery are advisory; durable state remains on disk.
		}
	};
	pi.on("session_start", (_event, context) => {
		if (process.env.LIMEN_JOB === "1" || process.env.LIMEN_WAKE === "0") return;
		if (!existsSync(join(context.cwd, ".agents", "limen"))) return;
		const id = context.sessionManager.getSessionId();
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) return;
		const jobs = join(context.cwd, ".limen", "jobs");
		try {
			mkdirSync(jobs, { recursive: true });
		} catch {
			return;
		}
		active = true;
		session = context;
		jobsDir = jobs;
		sessionId = id;
		herdr = herdrTarget();
		for (const jobId of readdirSync(jobs)) {
			const job = join(jobs, jobId);
			if (stateOf(jobs, jobId) === "running" && !routable(job)) enrollLegacyRunning(job);
			if (subscribed(job, id) && stateOf(jobs, jobId) === "running") claimMarker(job, "started", id);
		}
		watcher = watch(jobs, { recursive: true }, sweep);
		watcher.unref();
		watcher.on("error", () => {
			watcher?.close();
			clearStatus(context);
		});
		sweepTimer = setInterval(sweep, 250);
		sweepTimer.unref();
		sweep();
	});
	pi.on("agent_settled", sweep);
	pi.on("session_shutdown", (_event, context) => {
		if (!active) return;
		active = false;
		watcher?.close();
		watcher = undefined;
		if (sweepTimer) clearInterval(sweepTimer);
		sweepTimer = undefined;
		clearStatus(context);
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
				if (muted) session.ui.setStatus("limen", undefined);
				else sweep();
			}
			commandContext.ui.notify(`limen wake ${muted ? "off" : "on"}${active ? "" : " (inactive here)"}`, "info");
		},
	});
}

function runningStatus(jobs: string, session: string): string {
	const running = readdirSync(jobs)
		.sort()
		.filter((id) => stateOf(jobs, id) === "running" && subscribed(join(jobs, id), session))
		.map((id) => {
			const name = shortLabel(text(join(jobs, id, "label")) || id);
			const pulse = pulseOf(jobs, id);
			const tool = text(join(jobs, id, "last-tool"));
			return `${name} ${pulse === "tool" && tool ? `${pulse}:${tool}` : pulse}`;
		});
	if (running.length === 0) return "";
	return `limen ${running.length} · ${running.slice(0, 3).join(" ")}${running.length > 3 ? ` +${running.length - 3}` : ""}`;
}
function pulseOf(jobs: string, id: string): string {
	// Copied into the project as a standalone extension; keep identical to src/job.ts derivePulse.
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
function herdrTarget(): HerdrPane | undefined {
	const binary = process.env.LIMEN_HERDR || "herdr";
	const pane = process.env.HERDR_PANE_ID;
	if (binary === "0" || process.env.HERDR_ENV !== "1" || !pane) return undefined;
	return { binary, pane };
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
