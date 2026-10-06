import { readFileSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { formatDuration, isTerminal } from "../job/job.ts";
import { atomicWrite, textFile } from "../job/record.ts";

// Match the hosted idle advisory's one-minute persistence window, not the CPU stall timer.
export const HOSTED_UNCERTAINTY_MS = 60_000;
export type HostedUncertainty = { readonly since: number; readonly root: boolean; readonly child: boolean };
export function readHostedUncertainty(jobDir: string): HostedUncertainty | undefined {
	try {
		const value: HostedUncertainty = JSON.parse(readFileSync(`${jobDir}/ownership-uncertainty`, "utf8"));
		if (Number.isFinite(value.since) && value.since > 0 && (value.root || value.child)) {
			return value;
		}
	} catch {}
}
export function hostedUncertaintyText(value: HostedUncertainty): string {
	const scope = [value.root ? "engine" : "", value.child ? "child" : ""].filter(Boolean).join(" and ");
	return `ownership observation unavailable for ${formatDuration(Date.now() - value.since)} (${scope}); this is not proof of a stalled tool`;
}
export async function noteHostedUncertainty(
	jobDir: string,
	root: boolean,
	child: boolean | undefined,
	now = Date.now(),
): Promise<void> {
	const terminal = async () => isTerminal(await textFile(`${jobDir}/state`));
	if (await terminal()) {
		await rm(`${jobDir}/ownership-uncertainty`, { force: true });
		return;
	}
	const previous = readHostedUncertainty(jobDir);
	const next = { since: previous?.since ?? now, root, child: child ?? previous?.child ?? false };
	if (next.root || next.child) {
		if (!previous || previous.root !== next.root || previous.child !== next.child) {
			await atomicWrite(`${jobDir}/ownership-uncertainty`, `${JSON.stringify(next)}\n`);
		}
		if (await terminal()) {
			await rm(`${jobDir}/ownership-uncertainty`, { force: true });
		}
		return;
	}
	if (!previous) {
		return;
	}
	await rm(`${jobDir}/ownership-uncertainty`, { force: true });
	for (const dir of ["claims", "delivered", "herdr", "unconfirmed"]) {
		for (const name of await readdir(`${jobDir}/notify/${dir}`).catch(() => [] as string[])) {
			if (name === "_uncertainty" || name.startsWith("_uncertainty.")) {
				await rm(`${jobDir}/notify/${dir}/${name}`, { recursive: true, force: true });
			}
		}
	}
}
