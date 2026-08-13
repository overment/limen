import { existsSync, type FSWatcher, readdirSync, readFileSync, watch } from "node:fs";
import { join } from "node:path";

type Context = { readonly cwd: string };
type PiApi = {
	on(event: "session_start" | "session_shutdown", handler: (event: unknown, context: Context) => void): void;
	sendUserMessage(content: string, options: { readonly deliverAs: "followUp" }): void;
};

export default function controlWake(pi: PiApi): void {
	let watcher: FSWatcher | undefined;
	const seen = new Set<string>();
	pi.on("session_start", (_event, context) => {
		if (process.env.CONTROL_JOB === "1") return;
		const jobs = join(context.cwd, ".control", "jobs");
		if (!existsSync(jobs)) return;
		for (const id of readdirSync(jobs)) {
			const state = stateOf(jobs, id);
			if (isTerminal(state)) seen.add(`${id}:${state}`);
		}
		watcher = watch(jobs, { recursive: true }, (_kind, filename) => {
			try {
				const id = filename?.toString().split(/[\\/]/)[0];
				if (!id) return;
				const state = stateOf(jobs, id);
				const key = `${id}:${state}`;
				if (!isTerminal(state) || seen.has(key)) return;
				seen.add(key);
				const branch = text(join(jobs, id, "branch"));
				pi.sendUserMessage(`control job ${id} is ${state}; inspect .control/jobs/${id}/ and branch ${branch}.`, {
					deliverAs: "followUp",
				});
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

function isTerminal(state: string): boolean {
	return state === "done" || state === "failed" || state === "stopped";
}
