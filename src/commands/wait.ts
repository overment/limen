import { type FSWatcher, watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { repoRoot } from "../git.ts";

export async function waitCommand(args: readonly string[], cwd: string): Promise<void> {
	const id = args[0];
	if (!id || args.length !== 1) throw new Error("wait requires exactly one job id");
	const jobDir = `${repoRoot(cwd)}/.control/jobs/${id}`;
	let state = await readState(jobDir);
	if (state === "running") state = await waitForTerminal(jobDir);
	else if (!isTerminal(state)) throw new Error(`job ${id} has unknown state ${JSON.stringify(state)}`);
	const label = (await text(`${jobDir}/label`)) || id;
	console.log(`${state.toUpperCase()} ${label} · id ${id}`);
}

function waitForTerminal(jobDir: string): Promise<string> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let watcher: FSWatcher | undefined;
		const interval = setInterval(check, 1_000);
		function finish(action: () => void): void {
			if (settled) return;
			settled = true;
			clearInterval(interval);
			watcher?.close();
			action();
		}
		function check(): void {
			void readState(jobDir).then(
				(state) => {
					if (isTerminal(state)) finish(() => resolve(state));
					else if (state !== "running") finish(() => reject(new Error(`unknown job state ${JSON.stringify(state)}`)));
				},
				(error: unknown) => finish(() => reject(error)),
			);
		}
		try {
			watcher = watch(jobDir, check);
			watcher.on("error", () => {
				watcher?.close();
				watcher = undefined;
			});
		} catch {
			// The periodic check remains as the portable fallback.
		}
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

function isTerminal(state: string): boolean {
	return state === "done" || state === "failed" || state === "stopped";
}
