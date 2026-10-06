import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { hostedAgentStatus } from "../integrations/herdr.ts";
import { limenRoot } from "../project/git.ts";
import type { PlanningSource } from "../project/planning.ts";
import { processAlive, processInfo } from "../runtime/contain.ts";
import { SESSION_ID } from "./job.ts";

export type GroupMember = { id: string; team: string; role: "coordinator" | "worker"; parent?: string; deadline: number };
export type GroupRun = {
	id: string;
	root: string;
	feature: string;
	planningSource?: PlanningSource;
	lead: string;
	startedAt: number;
	teams: string[];
	workersPerTeam: number;
	engine: string;
	provider: string;
	model: string;
	thinking: string;
	workerThinking: string;
	deadline: number;
	workerTimeoutMs: number;
	reserveMs: number;
	stopped: boolean;
	closed: boolean;
	mode: "auto" | "detached" | "tab";
	members: GroupMember[];
	teamModels?: Record<string, { provider: string; model: string }>;
	teamExtensions?: Record<string, string[]>;
};
export type GroupIdentity = { run: GroupRun; member?: GroupMember; recipient: string };
export const groupPath = (run: Pick<GroupRun, "root" | "id">): string => `${run.root}/.limen/groups/${run.id}`;
export const teamRoute = (run: GroupRun, team: string): { provider: string; model: string } => run.teamModels?.[team] ?? { provider: run.provider, model: run.model };
export async function readRun(root: string, id: string): Promise<GroupRun> {
	if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error(`invalid group ID ${JSON.stringify(id)}; run limen group start FEATURE with the group settings`);
	let record: string;
	try {
		record = await readFile(`${root}/.limen/groups/${id}/run.json`, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		throw new Error(`no group record for ${id}; run limen group start FEATURE with the group settings`);
	}
	const run = JSON.parse(record) as GroupRun;
	if ("teamExtensions" in run) {
		const selections = run.teamExtensions;
		if (
			!selections ||
			typeof selections !== "object" ||
			Array.isArray(selections) ||
			Object.keys(selections).length !== run.teams.length ||
			!run.teams.every(
				(team) => Object.hasOwn(selections, team) && Array.isArray(selections[team]) && selections[team]?.every((path) => typeof path === "string" && isAbsolute(path)),
			)
		)
			throw new Error(`invalid teamExtensions in group ${id}: expected complete team lists of absolute local paths`);
	}
	return run;
}
export async function saveJson(path: string, value: unknown): Promise<void> {
	const temporary = `${path}.${randomUUID()}.tmp`;
	await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", flush: true });
	await rename(temporary, path);
}
// Dead owners may be recovered; a live owner (including PID reuse) is never evicted.
export function groupLock<T>(directory: string, operation: () => Promise<T>, mode: "skip"): Promise<T | undefined>;
export function groupLock<T>(directory: string, operation: () => Promise<T>, mode?: "wait"): Promise<T>;
export async function groupLock<T>(directory: string, operation: () => Promise<T>, mode?: "skip" | "wait"): Promise<T | undefined> {
	await mkdir(directory, { recursive: true });
	const path = `${directory}/.lock`;
	const deadline = mode === "wait" ? Infinity : Date.now() + (mode === "skip" ? 0 : 10_000);
	while (true) {
		try {
			await mkdir(path);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const pid = Number(await readFile(`${path}/owner`, "utf8").catch(() => ""));
			const identity = await stat(path).catch(() => undefined);
			if (!identity) continue;
			const age = Date.now() - identity.mtimeMs;
			if (age > 5_000 && (!pid || !processAlive(pid))) {
				const claim = `${path}.reclaimer.${identity.dev}.${identity.ino}`;
				let claimed = false;
				try {
					await writeFile(claim, `${process.pid}\n`, { flag: "wx" });
					claimed = true;
					const current = await stat(path).catch(() => undefined);
					const owner = Number(await readFile(`${path}/owner`, "utf8").catch(() => ""));
					if (current?.ino === identity.ino && current.dev === identity.dev && owner === pid) {
						const abandoned = `${path}.abandoned.${randomUUID()}`;
						await rename(path, abandoned);
						await rm(abandoned, { recursive: true, force: true });
					}
				} catch (claimError) {
					if (!["EEXIST", "ENOENT"].includes((claimError as NodeJS.ErrnoException).code ?? "")) throw claimError;
				} finally {
					if (claimed) await rm(claim, { force: true });
				}
			}
			if (Date.now() >= deadline) {
				if (mode === "skip") return;
				throw new Error(`group lock busy or uncertain: ${path}; inspect its owner before recovery`);
			}
			await delay(25);
		}
	}
	try {
		await writeFile(`${path}/owner`, `${process.pid}\n`, { flag: "wx", flush: true });
		return await operation();
	} finally {
		await rm(path, { recursive: true, force: true });
	}
}
export async function runs(root: string): Promise<GroupRun[]> {
	const result: GroupRun[] = [];
	for (const id of await readdir(`${root}/.limen/groups`).catch(() => [])) {
		if (id.startsWith(".")) continue;
		result.push(await readRun(root, id));
	}
	return result.sort((left, right) => left.startedAt - right.startedAt);
}
export async function groupIdentity(cwd: string, explicitId?: string): Promise<GroupIdentity | undefined> {
	const memberId = process.env.LIMEN_JOB_ID;
	if (process.env.LIMEN_GROUP_ID) {
		const root = process.env.LIMEN_CONTEXT_ROOT;
		if (!root || !memberId) throw new Error("this job has incomplete group membership; run limen jobs to inspect its job record");
		const run = await readRun(root, process.env.LIMEN_GROUP_ID);
		const member = run.members.find((entry) => entry.id === memberId);
		if (!member || member.team !== process.env.LIMEN_TEAM_ID || (explicitId && explicitId !== run.id))
			throw new Error(`this job does not match group ${run.feature} (${run.id})'s roster; run limen jobs ${memberId}`);
		return { run, member, recipient: member.id };
	}
	if (!explicitId) return;
	const run = await readRun(limenRoot(cwd), explicitId);
	if (!run.lead || run.lead !== (await leadSession(run.root)))
		throw new Error(`group ${run.feature} (${run.id}) belongs to another lead pane; return to that pane and run limen group status ${run.id}`);
	return { run, recipient: `lead-${run.lead}` };
}
// OMP does not export its session to tool commands, so a registered lead is also recognized as a live ancestor process.
export async function leadSession(root: string): Promise<string | undefined> {
	const declared = process.env.PI_SESSION_ID?.trim();
	if (declared) return declared;
	const listeners = new Map<number, string>();
	for (const session of await readdir(`${root}/.limen/group-leads`).catch(() => [])) {
		const pid = Number(await readFile(`${root}/.limen/group-leads/${session}`, "utf8").catch(() => ""));
		if (SESSION_ID.test(session) && Number.isSafeInteger(pid) && pid > 1) listeners.set(pid, session);
	}
	let pid = process.ppid;
	for (let hop = 0; listeners.size && hop < 32 && pid > 1; hop++) {
		const session = listeners.get(pid);
		if (session) return session;
		const parent = await processInfo(pid);
		if (parent.kind !== "present") return;
		pid = parent.process.ppid;
	}
}
/** How long a lead registration stays live after the group-peer hook last finished a delivery sweep. The hook sweeps every second. */
const LEAD_HEARTBEAT_MS = 30_000;
/**
 * The lead hook is live when its registration names a live process and the hook refreshed it recently.
 * A process alone is not proof: a pane can run without hook/group-peer.ts, and a hand-written registration never refreshes.
 */
export async function leadHookLive(root: string, session: string, now = Date.now()): Promise<boolean> {
	const path = `${root}/.limen/group-leads/${session}`;
	const [pid, info] = await Promise.all([readFile(path, "utf8").then(Number, () => 0), stat(path).catch(() => undefined)]);
	return Boolean(info && now - info.mtimeMs < LEAD_HEARTBEAT_MS && Number.isSafeInteger(pid) && pid > 1 && processAlive(pid));
}
export async function commandRoot(cwd: string): Promise<string> {
	return (await groupIdentity(cwd))?.run.root ?? limenRoot(cwd);
}
export async function claimMember(run: GroupRun, team: string, role: GroupMember["role"], id: string, parent?: string): Promise<GroupMember> {
	return groupLock(
		groupPath(run),
		async () => {
			const current = await readRun(run.root, run.id);
			if (current.stopped || current.closed || Date.now() >= current.deadline)
				throw new Error(`group ${current.feature} (${current.id}) is stopped, closed, or past its deadline; run limen group status ${current.id}`);
			if (!current.teams.includes(team)) throw new Error(`${team} is not in group ${current.feature} (${current.id})'s roster; run limen group status ${current.id}`);
			const used = current.members.filter((entry) => entry.team === team && entry.role === role).length;
			if (used >= (role === "coordinator" ? 1 : current.workersPerTeam))
				throw new Error(`${team} has used its ${role} job allowance; run limen group status ${current.id} before asking the lead`);
			const deadline = role === "coordinator" ? current.deadline : Math.min(Date.now() + current.workerTimeoutMs, current.deadline - current.reserveMs);
			if (deadline <= Date.now())
				throw new Error(`group ${current.feature} (${current.id}) has no worker time left before the coordinator wraps up; run limen group status ${current.id}`);
			const member: GroupMember = { id, team, role, deadline, ...(parent ? { parent } : {}) };
			current.members.push(member);
			await saveJson(`${groupPath(run)}/run.json`, current);
			return member;
		},
		"wait",
	);
}
export async function jobMembership(jobDir: string): Promise<GroupIdentity | undefined> {
	const id = (await readFile(`${jobDir}/group`, "utf8").catch(() => "")).trim();
	if (!id) return;
	const root = dirname(dirname(dirname(jobDir)));
	const run = await readRun(root, id);
	const member = run.members.find((entry) => `${root}/.limen/jobs/${entry.id}` === jobDir);
	if (!member) throw new Error(`job ${jobDir.split("/").at(-1)} is absent from group ${run.feature} (${run.id})'s roster; run limen group status ${run.id}`);
	return { run, member, recipient: member.id };
}
export async function retainedGroupJob(jobDir: string): Promise<boolean> {
	return Boolean((await jobMembership(jobDir))?.run.closed === false);
}
export async function memberLive(root: string, member: GroupMember): Promise<boolean> {
	const dir = `${root}/.limen/jobs/${member.id}`;
	const state = (await readFile(`${dir}/state`, "utf8").catch(() => "")).trim();
	if (state === "running") return true;
	const pid = Number(await readFile(`${dir}/pid`, "utf8").catch(() => ""));
	if (pid > 0 && (await processInfo(pid)).kind !== "absent") return true;
	const target = (await readFile(`${dir}/herdr/agent`, "utf8").catch(() => "")).trim();
	if (target && hostedAgentStatus(target) !== "missing") return true;
	const owner = JSON.parse(await readFile(`${dir}/group-owner.json`, "utf8").catch(() => "null")) as { pid: number; born: string } | null;
	if (owner) {
		const info = await processInfo(owner.pid);
		if (info.kind === "unavailable" || (info.kind === "present" && info.process.born === owner.born)) return true;
	}
	return !state && !existsSync(`${dir}/finished-at`);
}
export async function ownsLiveChildren(jobDir: string): Promise<boolean> {
	const identity = await jobMembership(jobDir);
	if (!identity?.member || identity.member.role !== "coordinator") return false;
	for (const member of identity.run.members) if (member.team === identity.member.team && member.role === "worker" && (await memberLive(identity.run.root, member))) return true;
	return false;
}
