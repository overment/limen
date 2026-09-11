import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { hostedAgentName } from "./commands/spawn.ts";
import { processAlive, processInfo } from "./contain.ts";
import { hostedAgentStatus, locateHostedAgent } from "./herdr.ts";
import { ownerAlive } from "./reap.ts";
import { atomicWrite, launchHostedSupervisor, textFile } from "./wrapper.ts";

/** A populated directory is published atomically. Retire only the observed unique entry:
 * competing stale-claim removers cannot unlink a replacement owner's entry. */
export async function claimRecovery(jobDir: string): Promise<(() => Promise<void>) | undefined> {
	const claim = `${jobDir}/recovery`;
	const entry = `${process.pid}.${Date.now()}.${randomUUID()}`;
	const prepared = `${claim}.${entry}`;
	await mkdir(prepared);
	const identity = await processInfo(process.pid);
	await writeFile(`${prepared}/${entry}`, identity.kind === "present" ? identity.process.born : "");
	try {
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				await rename(prepared, claim);
				return async () => {
					await rm(`${claim}/${entry}`, { force: true });
					await rmdir(claim).catch(() => {});
				};
			} catch (error) {
				if (!(error instanceof Error && "code" in error && ["EEXIST", "ENOTEMPTY"].includes(String(error.code)))) throw error;
			}
			for (const name of await readdir(claim).catch(() => [] as string[])) {
				const [rawPid, rawTime] = name.split(".");
				const pid = Number(rawPid),
					time = Number(rawTime);
				if (Number.isSafeInteger(pid) && pid > 0 && processAlive(pid)) {
					const born = await textFile(`${claim}/${name}`);
					const info = born ? await processInfo(pid) : undefined;
					if (!info || info.kind === "unavailable" || (info.kind === "present" && info.process.born === born)) return;
				} else if (!Number.isSafeInteger(pid) || pid <= 0) {
					if (Number.isFinite(time) && Date.now() - time < 5_000) return;
				}
				await rm(`${claim}/${name}`, { force: true });
			}
			await rmdir(claim).catch(() => {});
		}
	} finally {
		await rm(prepared, { recursive: true, force: true });
	}
}

/** Unlike visibility, recovery requires a fresh concrete answer, not Herdr's last good status. */
export async function recoveryTarget(jobDir: string): Promise<string | "missing" | "unknown"> {
	const name = (await textFile(`${jobDir}/agent-name`)) || hostedAgentName(basename(jobDir));
	const target = (await textFile(`${jobDir}/herdr/agent`)) || (await textFile(`${jobDir}/herdr/pane`)) || name;
	const status = hostedAgentStatus(target, true);
	if (status === "unknown") return "unknown";
	if (status !== "missing") return target;
	const located = locateHostedAgent(target, name, true);
	if (!located) return "missing";
	if (located === "unknown") return "unknown";
	const found = hostedAgentStatus(located, true);
	return found === "unknown" || found === "missing" ? "unknown" : located;
}

export async function recoverHostedOwner(jobDir: string): Promise<void> {
	const id = basename(jobDir);
	// The detached candidate claims in its own process, so a dead caller can never strand
	// a launch-to-handshake ownership transfer. Losing candidates exit without a handshake.
	const pid = await launchHostedSupervisor({
		LIMEN_INTERNAL_RUN: "",
		LIMEN_HOSTED_START: "",
		LIMEN_HOSTED_RECOVER: "1",
		LIMEN_JOB_DIR: jobDir,
		LIMEN_JOB_ID: id,
		LIMEN_HOSTED_TARGET: "",
		LIMEN_LABEL: (await textFile(`${jobDir}/label`)) || id,
		LIMEN_ROLE: (await textFile(`${jobDir}/role`)) || "worker",
		LIMEN_AGENT_NAME: (await textFile(`${jobDir}/agent-name`)) || hostedAgentName(id),
		LIMEN_CONTEXT_ROOT: dirname(dirname(dirname(jobDir))),
	});
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline && processAlive(pid) && (await textFile(`${jobDir}/state`)) === "running" && !(await ownerAlive(jobDir))) {
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

export async function prepareRecoveredOwner(jobDir: string): Promise<(() => Promise<void>) | undefined> {
	const release = await claimRecovery(jobDir);
	if (!release) return;
	if ((await textFile(`${jobDir}/state`)) === "running" && !(await ownerAlive(jobDir))) {
		const target = await recoveryTarget(jobDir);
		if (target !== "missing" && target !== "unknown" && (await textFile(`${jobDir}/state`)) === "running") {
			await atomicWrite(`${jobDir}/herdr/agent`, `${target}\n`);
			await atomicWrite(`${jobDir}/herdr/pane`, `${target}\n`);
			process.env.LIMEN_HOSTED_TARGET = target;
			return release;
		}
	}
	await release();
}
