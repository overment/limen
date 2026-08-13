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

export default function controlWake(pi: PiApi): void {
	let watcher: FSWatcher | undefined;
	let active = false;
	const seen = new Set<string>();
	pi.on("session_start", (_event, context) => {
		if (process.env.CONTROL_JOB === "1") return;
		const jobs = join(context.cwd, ".control", "jobs");
		try {
			mkdirSync(jobs, { recursive: true });
		} catch {
			return;
		}
		active = true;
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
				context.ui.notify(`control: ${label} started (${id})`, "info");
				return;
			}
			const branch = text(join(jobs, id, "branch"));
			const message = `control: ${label} is ${state} (${id}); inspect .control/jobs/${id}/ and branch ${branch}.`;
			if (context.isIdle()) pi.sendUserMessage(message);
			else pi.sendUserMessage(message, { deliverAs: "steer" });
		};
		watcher = watch(jobs, { recursive: true }, (_kind, filename) => {
			try {
				const parts = filename?.toString().split(/[\\/]/);
				const id = parts?.[0];
				if (!id || parts?.at(-1) !== "state") return;
				updateStatus(jobs, context);
				observe(id);
			} catch {
				// Display and wake delivery are advisory; durable state remains on disk.
			}
		});
		watcher.on("error", () => {
			watcher?.close();
			context.ui.setStatus("control", undefined);
		});
		for (const id of readdirSync(jobs)) observe(id);
		updateStatus(jobs, context);
	});
	pi.on("session_shutdown", (_event, context) => {
		if (!active) return;
		active = false;
		watcher?.close();
		watcher = undefined;
		context.ui.setStatus("control", undefined);
	});
}

function updateStatus(jobs: string, context: Context): void {
	const running = readdirSync(jobs)
		.sort()
		.filter((id) => stateOf(jobs, id) === "running")
		.map((id) => shortLabel(text(join(jobs, id, "label")) || id));
	const visible = running.slice(0, 3).join(" ");
	const more = running.length > 3 ? ` +${running.length - 3}` : "";
	context.ui.setStatus("control", running.length > 0 ? `ctl ${running.length} · ${visible}${more}` : undefined);
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
