import { execFile } from "node:child_process";
import { existsSync, type FSWatcher, mkdirSync, readdirSync, readFileSync, watch } from "node:fs";
import { join } from "node:path";

type Context = {
	readonly cwd: string;
	isIdle(): boolean;
	readonly ui: {
		notify(message: string, level: "info"): void;
		setStatus(key: string, value: string | undefined): void;
	};
};
type PiApi = {
	on(event: "session_start" | "session_shutdown", handler: (event: unknown, context: Context) => void): void;
	sendUserMessage(content: string, options?: { readonly deliverAs: "steer" }): void;
};

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
type HerdrPane = { readonly binary: string; readonly pane: string };

export default function limenWake(pi: PiApi): void {
	let watcher: FSWatcher | undefined;
	let statusTimer: NodeJS.Timeout | undefined;
	let statusBody = "";
	let frame = 0;
	let active = false;
	const seen = new Set<string>();
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
		const change = body ? ["--token", `limen=${body}`, "--ttl-ms", "180000"] : ["--clear-token", "limen"];
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
			const next = runningStatus(jobs);
			if (!next) {
				clearStatus(context);
				return;
			}
			statusBody = next;
			herdrReportToken(next.slice("limen ".length));
			context.ui.setStatus("limen", `${SPINNER[frame]} ${statusBody}`);
			frame = (frame + 1) % SPINNER.length;
		};
		draw();
		if (statusBody && !statusTimer) {
			statusTimer = setInterval(draw, 120);
			statusTimer.unref();
		}
	};
	pi.on("session_start", (_event, context) => {
		if (process.env.LIMEN_JOB === "1" || process.env.LIMEN_WAKE === "0") return;
		// Only wake inside limen projects, so a global install stays inert and creates nothing elsewhere.
		if (!existsSync(join(context.cwd, ".agents", "limen"))) return;
		const jobs = join(context.cwd, ".limen", "jobs");
		try {
			mkdirSync(jobs, { recursive: true });
		} catch {
			return;
		}
		active = true;
		herdr = herdrTarget();
		for (const id of readdirSync(jobs)) {
			const state = stateOf(jobs, id);
			if (isObservable(state)) seen.add(observationKey(id, state));
		}
		const observe = (id: string) => {
			const state = stateOf(jobs, id);
			if (!isObservable(state)) return;
			const key = observationKey(id, state);
			if (seen.has(key)) return;
			seen.add(key);
			const label = text(join(jobs, id, "label")) || id;
			if (state === "running") {
				context.ui.notify(`limen: ${label} started (${id})`, "info");
				return;
			}
			const branch = text(join(jobs, id, "branch"));
			const message = `limen: ${label} is ${state} (${id}); inspect .limen/jobs/${id}/ and branch ${branch}.`;
			herdrCall(["notification", "show", `limen: ${label} is ${state}`, "--body", `job ${id} · branch ${branch}`, "--sound", state === "done" ? "done" : "request"]);
			if (context.isIdle()) pi.sendUserMessage(message);
			else pi.sendUserMessage(message, { deliverAs: "steer" });
		};
		watcher = watch(jobs, { recursive: true }, (_kind, filename) => {
			try {
				const parts = filename?.toString().split(/[\\/]/);
				const id = parts?.[0];
				const file = parts?.at(-1);
				if (!id || (file !== "state" && file !== "last-tool" && file !== "activity" && file !== "log")) return;
				updateStatus(jobs, context);
				if (file === "state") observe(id);
			} catch {
				// Display and wake delivery are advisory; durable state remains on disk.
			}
		});
		watcher.unref();
		watcher.on("error", () => {
			watcher?.close();
			clearStatus(context);
		});
		for (const id of readdirSync(jobs)) observe(id);
		updateStatus(jobs, context);
	});
	pi.on("session_shutdown", (_event, context) => {
		if (!active) return;
		active = false;
		watcher?.close();
		watcher = undefined;
		clearStatus(context);
	});
}

function herdrTarget(): HerdrPane | undefined {
	const binary = process.env.LIMEN_HERDR || "herdr";
	const pane = process.env.HERDR_PANE_ID;
	if (binary === "0" || process.env.HERDR_ENV !== "1" || !pane) return undefined;
	return { binary, pane };
}

function runningStatus(jobs: string): string {
	const running = readdirSync(jobs)
		.sort()
		.filter((id) => stateOf(jobs, id) === "running")
		.map((id) => {
			const name = shortLabel(text(join(jobs, id, "label")) || id);
			const pulse = pulseOf(jobs, id);
			const tool = text(join(jobs, id, "last-tool"));
			const detail = pulse === "tool" && tool ? `${pulse}:${tool}` : pulse;
			return `${name} ${detail}`;
		});
	if (running.length === 0) return "";
	const visible = running.slice(0, 3).join(" ");
	const more = running.length > 3 ? ` +${running.length - 3}` : "";
	return `limen ${running.length} · ${visible}${more}`;
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
	return state === "running" || state === "done" || state === "failed" || state === "stopped";
}

function observationKey(id: string, state: string): string {
	return `${id}:${state === "running" ? "running" : "terminal"}`;
}
