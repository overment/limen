import { readFile, rm } from "node:fs/promises";
import { repoRoot } from "../git.ts";
import { appendControlLog, atomicWrite, signalProcessGroup, waitForProcessGroup } from "../proc.ts";

export async function stopCommand(args: readonly string[], cwd: string): Promise<void> {
	const id = args[0];
	if (!id) throw new Error("stop requires a job id");
	const root = repoRoot(cwd);
	const jobDir = `${root}/.control/jobs/${id}`;
	const state = (await readFile(`${jobDir}/state`, "utf8")).trim();
	if (state !== "running") {
		console.log(`${id} is already ${state}`);
		return;
	}
	const pid = Number((await readFile(`${jobDir}/pid`, "utf8")).trim());
	if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`running job ${id} has no valid pid`);
	const reason = args.slice(1).join(" ").trim() || "stopped by request";
	await appendControlLog(jobDir, `stop requested: ${reason}`);
	const result = signalProcessGroup(pid, "SIGTERM");
	if (result !== "missing" && !(await waitForProcessGroup(pid, 5_000))) {
		await appendControlLog(jobDir, "TERM grace elapsed; sending KILL");
		signalProcessGroup(pid, "SIGKILL");
		await waitForProcessGroup(pid, 1_000);
	}
	const settledState = (await readFile(`${jobDir}/state`, "utf8")).trim();
	if (settledState !== "running") {
		console.log(`${id} is already ${settledState}`);
		return;
	}
	await appendControlLog(jobDir, `stopped: ${reason}`);
	await atomicWrite(`${jobDir}/state`, "stopped\n");
	await rm(`${jobDir}/pid`, { force: true });
	console.log(`stopped ${id}: ${reason}`);
}
