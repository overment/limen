import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

// Inspection only: never discover evidence in a job/worktree or read sender config.
async function readExport(path: string, limit: number): Promise<unknown> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW).catch(() => undefined);
	if (!handle) return;
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || stat.size > limit) return;
		const buffer = Buffer.alloc(limit + 1);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		if (bytesRead > limit) return;
		return JSON.parse(buffer.toString("utf8", 0, bytesRead));
	} catch {
		return;
	} finally {
		await handle.close();
	}
}
function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string): boolean {
	return Object.keys(value).sort().join() === expected;
}
function token(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value);
}

export async function inspectFinishTurns(event: string): Promise<Map<number, string>> {
	const turns = new Map<number, string>();
	const source = process.env.LIMEN_FINISH_EVIDENCE_DIR;
	if (!source || !isAbsolute(source) || !/^limen-finish-[a-f0-9]{64}$/.test(event)) return turns;
	const manifest = await readExport(join(source, "receivers.json"), 16_384);
	if (
		!record(manifest) ||
		!keys(manifest, "targets,version") ||
		manifest.version !== 1 ||
		!Array.isArray(manifest.targets) ||
		!manifest.targets.length ||
		manifest.targets.length > 64
	)
		return turns;
	const mappings = new Map<number, string>();
	for (const target of manifest.targets) {
		if (
			!record(target) ||
			!keys(target, "receiver,target") ||
			typeof target.target !== "number" ||
			!Number.isInteger(target.target) ||
			target.target < 1 ||
			target.target > 64 ||
			!token(target.receiver) ||
			mappings.has(target.target)
		)
			return turns;
		mappings.set(target.target, target.receiver);
	}
	for (const [target, receiver] of mappings) {
		const value = await readExport(join(source, `${event}.${target}.json`), 4096);
		if (!record(value) || !keys(value, "completedAt,event,receiver,session,state,target,turn,version")) continue;
		if (
			value.version !== 1 ||
			value.event !== event ||
			value.target !== target ||
			value.receiver !== receiver ||
			value.state !== "completed" ||
			!token(value.session) ||
			!token(value.turn)
		)
			continue;
		if (
			typeof value.completedAt !== "string" ||
			!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.completedAt) ||
			!Number.isFinite(Date.parse(value.completedAt)) ||
			new Date(value.completedAt).toISOString() !== value.completedAt
		)
			continue;
		turns.set(target, `observed (operator-trusted export) · receiver ${receiver} · session ${value.session} · turn ${value.turn} · ${value.completedAt}`);
	}
	return turns;
}
