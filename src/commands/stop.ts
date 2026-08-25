import { readFile, writeFile } from "node:fs/promises";
import { containEscapedDescendants, discoverEscapedDescendants, processGroupAlive, signalProcessGroup, waitForProcessGroup } from "../contain.ts";
import { hostedAgentStatus, stopHostedAgent } from "../herdr.ts";
import { resolveJob } from "../lookup.ts";
import { appendLimenLog, finalizeJob } from "../wrapper.ts";
export async function stopCommand(args: readonly string[], cwd: string): Promise<void> {
	const query = args[0];
	if (!query) throw new Error("stop requires a job id");
	const { id, jobDir } = await resolveJob(cwd, query);
	const state = (await readFile(`${jobDir}/state`, "utf8")).trim();
	if (state !== "running") {
		console.log(`${id} is already ${state}`);
		return;
	}
	const reason = args.slice(1).join(" ").trim() || "stopped by request";
	await appendLimenLog(jobDir, `stop requested: ${reason}`);
	const hostedTarget = await text(`${jobDir}/herdr/agent`);
	if (hostedTarget || (await text(`${jobDir}/hosted`))) {
		await writeFile(`${jobDir}/stop-requested`, `${reason}\n`);
		if (hostedTarget) stopHostedAgent(hostedTarget);
		const pid = Number(await text(`${jobDir}/pid`));
		const deadline = Date.now() + (Number(process.env.LIMEN_HOSTED_STOP_WAIT_MS) || 15_000);
		while ((await text(`${jobDir}/state`)) === "running" && Date.now() < deadline) {
			const dead = !Number.isSafeInteger(pid) || pid <= 0 || !processGroupAlive(pid);
			if (dead && (!hostedTarget || hostedAgentStatus(hostedTarget) === "missing")) {
				await finalizeJob(jobDir, "stopped", reason);
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		if ((await text(`${jobDir}/state`)) === "running") throw new Error(`${id} agent is still up; closing the tab ends it`);
		console.log(`stopped ${id}: ${reason}`);
		return;
	}
	const pid = Number((await readFile(`${jobDir}/pid`, "utf8")).trim());
	if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`running job ${id} has no valid pid`);
	// Complete the bounded ownership snapshot while the parent chain is intact, then signal.
	const escaped = await discoverEscapedDescendants(jobDir, pid, "during stop");
	const result = signalProcessGroup(pid, "SIGTERM");
	void containEscapedDescendants(jobDir, escaped, "after stop").catch((error: unknown) =>
		appendLimenLog(jobDir, `escaped cleanup unconfirmed after stop: ${error instanceof Error ? error.message : String(error)}`),
	);
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
function text(path: string): Promise<string> {
	return readFile(path, "utf8").then(
		(value) => value.trim(),
		() => "",
	);
}
