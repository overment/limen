import { readFile } from "node:fs/promises";
import { resolveJob } from "../lookup.ts";
import { appendLimenLog, containEscapedDescendants, finalizeJob, listEscapedDescendants, signalProcessGroup, waitForProcessGroup } from "../proc.ts";
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
	// Snapshot escaped descendants before TERM: once the wrapper's tree dies they re-parent to init.
	const escaped = await listEscapedDescendants(pid).catch(() => []);
	const result = signalProcessGroup(pid, "SIGTERM");
	if (result !== "missing" && !(await waitForProcessGroup(pid, 5_000))) {
		await appendLimenLog(jobDir, "TERM grace elapsed; sending KILL");
		signalProcessGroup(pid, "SIGKILL");
		await waitForProcessGroup(pid, 1_000);
	}
	await containEscapedDescendants(jobDir, escaped, "after stop");
	const settledState = (await readFile(`${jobDir}/state`, "utf8")).trim();
	if (settledState !== "running") {
		console.log(`${id} is already ${settledState}`);
		return;
	}
	await finalizeJob(jobDir, "stopped", reason);
	console.log(`stopped ${id}: ${reason}`);
}
