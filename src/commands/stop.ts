import { readFile } from "node:fs/promises";
import { resolveJob } from "../lookup.ts";
import { appendLimenLog, containEscapedDescendants, discoverEscapedDescendants, finalizeJob, signalProcessGroup, waitForProcessGroup } from "../proc.ts";
export async function stopCommand(args: readonly string[], cwd: string): Promise<void> {
	const query = args[0];
	if (!query) throw new Error("stop requires a job id");
	const { id, jobDir } = await resolveJob(cwd, query);
	const state = (await readFile(`${jobDir}/state`, "utf8")).trim();
	if (state !== "running") {
		console.log(`${id} is already ${state}`);
		return;
	}
	const pid = Number((await readFile(`${jobDir}/pid`, "utf8")).trim());
	if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`running job ${id} has no valid pid`);
	const reason = args.slice(1).join(" ").trim() || "stopped by request";
	await appendLimenLog(jobDir, `stop requested: ${reason}`);
	// Snapshot before TERM, then leave identity checks and escalation detached from terminal truth.
	const escaped = discoverEscapedDescendants(jobDir, pid, "during stop");
	const result = signalProcessGroup(pid, "SIGTERM");
	void escaped
		.then((processes) => containEscapedDescendants(jobDir, processes, "after stop"))
		.catch((error: unknown) => appendLimenLog(jobDir, `escaped cleanup unconfirmed after stop: ${error instanceof Error ? error.message : String(error)}`));
	void (async () => {
		if (result !== "missing" && !(await waitForProcessGroup(pid, 5_000))) {
			await appendLimenLog(jobDir, "TERM grace elapsed; sending KILL");
			signalProcessGroup(pid, "SIGKILL");
			await waitForProcessGroup(pid, 1_000);
		}
	})().catch(() => {});
	// Give a signaled wrapper one brief turn to publish its own terminal state before overwriting it.
	await new Promise((resolve) => setTimeout(resolve, 25));
	const settledState = (await readFile(`${jobDir}/state`, "utf8")).trim();
	if (settledState !== "running") {
		console.log(`${id} is already ${settledState}`);
		return;
	}
	await finalizeJob(jobDir, "stopped", reason);
	console.log(`stopped ${id}: ${reason}`);
}
