import { type FSWatcher, watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { isTerminal } from "../job/job.ts";
import { resolveJob } from "../job/lookup.ts";
export async function waitCommand(args: readonly string[], cwd: string): Promise<void> {
	const query = args[0];
	if (!query || args.length !== 1) {
		throw new Error("wait requires exactly one job id");
	}
	const { id, jobDir } = await resolveJob(cwd, query, "read");
	let state = await readState(jobDir);
	// A coordinator may read an ended job; it never blocks its own conversation on a running one.
	if (state === "running" && process.env.LIMEN_COORDINATOR === "1") {
		throw new Error(
			`limen wait refuses under LIMEN_COORDINATOR=1: job ${id} is running, and waiting would block this coordinator until it ends. Read it now with \`limen jobs ${id}\`. Its completion wake starts your next turn; if this coordinator did not spawn it, run \`limen watch ${id}\` first.`,
		);
	}
	if (state === "running") {
		state = await waitForTerminal(jobDir);
	} else if (!isTerminal(state)) {
		throw new Error(`job ${id} has unknown state ${JSON.stringify(state)}`);
	}
	const label = (await text(`${jobDir}/label`)) || id;
	console.log(`${state.toUpperCase()} ${label} · id ${id}`);
}
function waitForTerminal(jobDir: string): Promise<string> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let watcher: FSWatcher | undefined;
		const interval = setInterval(check, 1_000);
		function finish(action: () => void): void {
			if (settled) {
				return;
			}
			settled = true;
			clearInterval(interval);
			watcher?.close();
			action();
		}
		function check(): void {
			void readState(jobDir).then(
				(state) => {
					if (isTerminal(state)) {
						finish(() => resolve(state));
					} else if (state !== "running") {
						finish(() => reject(new Error(`unknown job state ${JSON.stringify(state)}`)));
					}
				},
				(error: unknown) => finish(() => reject(error)),
			);
		}
		try {
			watcher = watch(jobDir, check);
			watcher.unref();
			watcher.on("error", () => {
				watcher?.close();
				watcher = undefined;
			});
		} catch {}
		check();
	});
}
function readState(jobDir: string): Promise<string> {
	return readFile(`${jobDir}/state`, "utf8").then((value) => value.trim());
}
function text(path: string): Promise<string> {
	return readFile(path, "utf8").then(
		(value) => value.trim(),
		() => "",
	);
}
