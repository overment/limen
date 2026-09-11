import { readdir } from "node:fs/promises";
import { processAlive, processGroupAlive, processInfo } from "./contain.ts";
import { hostedAgentAlive } from "./herdr.ts";
import { claimRecovery, recoverHostedOwner, recoveryTarget } from "./recovery.ts";
import { writeHostedResult } from "./supervisor.ts";
import { finalizeJob, textFile } from "./wrapper.ts";

export const STARTUP_GRACE_MS = 10 * 60_000;
export async function liveJob(jobDir: string, now = Date.now()): Promise<boolean> {
	if ((await textFile(`${jobDir}/state`)) !== "running") return false;
	const pid = Number(await textFile(`${jobDir}/pid`));
	const recorded = Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
	if (recorded !== undefined && (await wrapperAlive(recorded, await textFile(`${jobDir}/born`)))) return true;
	const agent = await textFile(`${jobDir}/herdr/agent`);
	if ((await textFile(`${jobDir}/hosted`)) && agent && hostedAgentAlive(agent)) return true;
	if (recorded !== undefined) return false;
	const startedAt = Date.parse(await textFile(`${jobDir}/started-at`));
	return Number.isFinite(startedAt) && now - startedAt < STARTUP_GRACE_MS;
}
export async function ownerAlive(jobDir: string): Promise<boolean> {
	const pid = Number(await textFile(`${jobDir}/pid`));
	if (!Number.isSafeInteger(pid) || pid <= 0 || !processAlive(pid)) return false;
	const born = await textFile(`${jobDir}/born`);
	if (!born) return true;
	const outcome = await processInfo(pid);
	return outcome.kind === "present" ? outcome.process.born === born : outcome.kind !== "absent";
}
async function wrapperAlive(pid: number, born: string): Promise<boolean> {
	if (!processGroupAlive(pid)) return false;
	if (!born) return true;
	const outcome = await processInfo(pid);
	return outcome.kind === "present" ? outcome.process.born === born : outcome.kind !== "absent";
}
export async function reapDeadJobs(jobsRoot: string, seen: Map<string, number>, now = Date.now(), ids?: readonly string[]): Promise<void> {
	const candidates = ids ?? (await readdir(jobsRoot).catch(() => [] as string[]));
	if (ids) {
		const live = new Set(ids);
		for (const id of seen.keys()) if (!live.has(id)) seen.delete(id);
	}
	for (const id of candidates) {
		const jobDir = `${jobsRoot}/${id}`;
		if ((await textFile(`${jobDir}/state`)) !== "running") {
			seen.delete(id);
			continue;
		}
		const startedAt = Date.parse(await textFile(`${jobDir}/started-at`));
		const pid = Number(await textFile(`${jobDir}/pid`));
		const validPid = Number.isSafeInteger(pid) && pid > 0;
		if ((await ownerAlive(jobDir)) || (!validPid && Number.isFinite(startedAt) && now - startedAt < STARTUP_GRACE_MS)) {
			seen.delete(id);
			continue;
		}
		const first = seen.get(id);
		if (first === undefined) {
			seen.set(id, now);
			continue;
		}
		if (now - first < reapConfirmMs()) continue;
		if (await textFile(`${jobDir}/hosted`)) {
			const target = await recoveryTarget(jobDir);
			if (target === "unknown") continue;
			if (target !== "missing") {
				await recoverHostedOwner(jobDir);
				if (await ownerAlive(jobDir)) seen.delete(id);
				continue;
			}
		}
		const release = await claimRecovery(jobDir);
		if (!release) continue;
		try {
			if ((await textFile(`${jobDir}/state`)) !== "running" || (await ownerAlive(jobDir))) continue;
			const hosted = await textFile(`${jobDir}/hosted`);
			if (hosted && (await recoveryTarget(jobDir)) !== "missing") continue;
			if (hosted) await writeHostedResult(jobDir);
			await finalizeJob(jobDir, "failed", hosted ? "hosted supervisor lost" : "process group gone");
			seen.delete(id);
		} finally {
			await release();
		}
	}
}
export async function confirmDeadJobs(jobsRoot: string): Promise<void> {
	const seen = new Map<string, number>();
	await reapDeadJobs(jobsRoot, seen);
	if (seen.size === 0) return;
	await delay(reapConfirmMs());
	await reapDeadJobs(jobsRoot, seen);
}
function reapConfirmMs(): number {
	const raw = Number(process.env.LIMEN_REAP_CONFIRM_MS);
	return Number.isFinite(raw) && raw > 0 ? raw : 10_000;
}
const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
