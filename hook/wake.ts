import { existsSync, type FSWatcher, mkdirSync, readdirSync, readFileSync, watch } from "node:fs";
import { join } from "node:path";

type Context = {
	readonly cwd: string;
	isIdle(): boolean;
	readonly ui: { notify(message: string, level: "info"): void };
};
type PiApi = {
	on(event: "session_start" | "session_shutdown", handler: (event: unknown, context: Context) => void): void;
	sendUserMessage(content: string, options?: { readonly deliverAs: "steer" }): void;
};

export default function controlWake(pi: PiApi): void {
	let watcher: FSWatcher | undefined;
	const seen = new Set<string>();
	pi.on("session_start", (_event, context) => {
		if (process.env.CONTROL_JOB === "1") return;
		const jobs = join(context.cwd, ".control", "jobs");
		try {
			mkdirSync(jobs, { recursive: true });
		} catch {
			return;
		}
		for (const id of readdirSync(jobs)) {
			const state = stateOf(jobs, id);
			if (isObservable(state)) seen.add(observationKey(id, state));
		}
		watcher = watch(jobs, { recursive: true }, (_kind, filename) => {
			try {
				const id = filename?.toString().split(/[\\/]/)[0];
				if (!id) return;
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
			} catch {
				// A wake is advisory; races and delivery failures never affect durable state.
			}
		});
		watcher.on("error", () => watcher?.close());
	});
	pi.on("session_shutdown", () => {
		watcher?.close();
		watcher = undefined;
	});
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
