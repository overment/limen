import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { hostedAgentStatus, stopHostedAgent } from "../integrations/herdr.ts";
import { SESSION_ID } from "../job/job.ts";
import { resolveJob } from "../job/lookup.ts";
import { appendLimenLog, finalizeJob, requestedTerminal } from "../job/record.ts";
import {
	containEscapedDescendants,
	discoverEscapedDescendants,
	processGroupAlive,
	signalProcessGroup,
	waitForProcessGroup,
} from "../runtime/contain.ts";
export async function stopCommand(args: readonly string[], cwd: string): Promise<void> {
	const query = args[0];
	if (!query) {
		throw new Error("stop requires a job id");
	}
	const { id, jobDir } = await resolveJob(cwd, query, "control");
	const state = (await readFile(`${jobDir}/state`, "utf8")).trim();
	if (state !== "running") {
		console.log(`${id} is already ${state}`);
		return;
	}
	const reason = args.slice(1).join(" ").trim() || "stopped by request";
	await appendLimenLog(jobDir, `stop requested: ${reason}`);
	const hostedTarget = await text(`${jobDir}/herdr/agent`);
	if (hostedTarget || (await text(`${jobDir}/hosted`))) {
		await stopHosted(jobDir, id, reason, hostedTarget);
		return;
	}
	const pid = Number((await readFile(`${jobDir}/pid`, "utf8")).trim());
	if (!Number.isSafeInteger(pid) || pid <= 0) {
		throw new Error(`running job ${id} has no valid pid`);
	}
	// A wrapper in the start queue ends its own job with this reason at once; then this command finalizes nothing.
	const queued = existsSync(`${jobDir}/queued`);
	const remoteHost = await text(`${jobDir}/host`);
	if (queued) {
		await writeFile(`${jobDir}/stop-requested`, `${reason}\n`);
	}
	// Complete the bounded ownership snapshot while the parent chain is intact, then signal. A Devin job's wrapper and a
	// queued one run no engine child, so they have no process tree to search and an empty one is no attribution loss.
	const childless = queued || (await text(`${jobDir}/engine`)) === "devin";
	const escaped = childless ? [] : await discoverEscapedDescendants(jobDir, pid, "during stop");
	const result = signalProcessGroup(pid, "SIGTERM");
	void containEscapedDescendants(jobDir, escaped, "after stop").catch((error: unknown) =>
		appendLimenLog(
			jobDir,
			`escaped cleanup unconfirmed after stop: ${error instanceof Error ? error.message : String(error)}`,
		),
	);
	void (async () => {
		if (result !== "missing" && !(await waitForProcessGroup(pid, 5_000))) {
			await appendLimenLog(jobDir, "TERM grace elapsed; sending KILL");
			signalProcessGroup(pid, "SIGKILL");
			await waitForProcessGroup(pid, 1_000);
		}
	})().catch(() => {});
	// Give a signaled wrapper one brief turn to publish its own terminal state before overwriting it.
	// A remote wrapper needs a few seconds to signal the host before this command finalizes over it.
	let grace = 25;
	if (queued) {
		grace = 2_000;
	} else if (remoteHost) {
		grace = 4_000;
	}
	const turn = Date.now() + grace;
	const waitForWrapper = queued || Boolean(remoteHost);
	do {
		await new Promise((resolve) => setTimeout(resolve, 25));
	} while (waitForWrapper && Date.now() < turn && (await text(`${jobDir}/state`)) === "running");
	const settledState = (await readFile(`${jobDir}/state`, "utf8")).trim();
	if (settledState !== "running") {
		await markCallerDelivered(jobDir);
		console.log(queued ? `${settledState} ${id}: ${reason}` : `${id} is already ${settledState}`);
		return;
	}
	await finalizeJob(jobDir, requestedTerminal(reason), reason);
	await markCallerDelivered(jobDir);
	console.log(`${requestedTerminal(reason)} ${id}: ${reason}`);
}
/** A hosted job's owner ends it: the request is a file, the agent is told, and this waits for the owner to finish. */
async function stopHosted(jobDir: string, id: string, reason: string, hostedTarget: string): Promise<void> {
	await writeFile(`${jobDir}/stop-requested`, `${reason}\n`);
	if (hostedTarget) {
		stopHostedAgent(hostedTarget);
	}
	const pid = Number(await text(`${jobDir}/pid`));
	const deadline = Date.now() + (Number(process.env.LIMEN_HOSTED_STOP_WAIT_MS) || 15_000);
	while ((await text(`${jobDir}/state`)) === "running" && Date.now() < deadline) {
		const dead = !Number.isSafeInteger(pid) || pid <= 0 || !processGroupAlive(pid);
		if (dead && (!hostedTarget || hostedAgentStatus(hostedTarget) === "missing")) {
			await finalizeJob(jobDir, requestedTerminal(reason), reason);
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	const ended = await text(`${jobDir}/state`);
	if (ended === "running") {
		throw new Error(`${id} agent is still up; closing the tab ends it`);
	}
	await markCallerDelivered(jobDir);
	console.log(`${ended} ${id}: ${reason}`);
}
async function markCallerDelivered(jobDir: string): Promise<void> {
	const session = process.env.PI_SESSION_ID?.trim();
	if (session && SESSION_ID.test(session)) {
		await mkdir(`${jobDir}/notify/delivered/${session}`, { recursive: true });
	}
}
function text(path: string): Promise<string> {
	return readFile(path, "utf8").then(
		(value) => value.trim(),
		() => "",
	);
}
