import { open, readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { GroupRun } from "../job/group-cabinet.ts";
import { isTerminal } from "../job/job.ts";
import { textFile } from "../job/record.ts";
import { processAlive } from "../runtime/contain.ts";
import { ownerAlive, startingJob } from "../runtime/reap.ts";

export type LiveState = "starting" | "working" | "waiting" | "quiet" | "dead" | "done" | "failed" | "stopped";
export type LiveJob = {
	readonly id: string;
	readonly label: string;
	/** Picture work ids the label or id names, lowercase: `f932`. A label can name two features. */
	readonly work: readonly string[];
	readonly engine: string;
	readonly model: string;
	readonly state: LiveState;
	readonly doing: string;
	readonly detail: string;
	readonly lastEventAt: string;
	readonly startedAt: string;
	readonly finishedAt: string | null;
	readonly tools: number;
	readonly hosted: boolean;
	readonly role: string;
	/** The job on the page this one works under: the job that spawned it, or a group worker's team coordinator. */
	readonly parent: string | null;
	readonly group: string | null;
	readonly team: string | null;
};
export type StateCount = Partial<Record<LiveState, number>>;
export type LiveTeam = { readonly name: string; readonly jobs: readonly string[]; readonly count: StateCount };
/** A `limen group` run with a member on the page: its lead, then each team's coordinator and workers. */
export type LiveGroup = {
	readonly id: string;
	readonly work: readonly string[];
	readonly feature: string;
	readonly lead: string;
	readonly teams: readonly LiveTeam[];
	readonly count: StateCount;
};
export type GroupRecord = Pick<GroupRun, "id" | "feature" | "lead" | "teams" | "members">;
export type LiveSnapshot = {
	readonly at: string;
	readonly jobs: readonly LiveJob[];
	readonly groups: readonly LiveGroup[];
};
/** What one job folder says at one moment. `owner` is `none` until the job records its process. */
export type JobFiles = {
	readonly id: string;
	readonly state: string;
	readonly spawning: boolean;
	readonly owner: "alive" | "gone" | "none";
	readonly label: string;
	readonly engine: string;
	readonly model: string;
	readonly activity: string;
	readonly lastTool: string;
	readonly detail: string;
	readonly stopReason: string;
	readonly tools: number;
	readonly hosted: boolean;
	readonly role: string;
	readonly spawnedBy: string;
	readonly group: string;
	readonly team: string;
	readonly startedAt: number;
	readonly lastEventAt: number;
	readonly finishedAt: number | undefined;
};

/** A live job with no event for this long is quiet, not working. */
export const QUIET_MS = 5 * 60_000;
/** A job that runs a test or check command may stay silent this long before it is quiet. */
export const CHECK_QUIET_MS = 15 * 60_000;
/** A finished job stays on the page this long. */
export const FINISHED_SHOWN_MS = 60 * 60_000;
const RANK: Record<LiveState, number> = {
	starting: 0,
	working: 0,
	waiting: 0,
	dead: 1,
	quiet: 2,
	done: 3,
	failed: 3,
	stopped: 3,
};

/** The page's view of one job, or nothing when the job is long finished or its record is half written. */
export function jobActivity(files: JobFiles, now: number): LiveJob | undefined {
	const state = liveState(files, now);
	if (!state) {
		return undefined;
	}
	const terminal = state === "done" || state === "failed" || state === "stopped";
	const doing = terminal ? (state === "done" ? "" : files.stopReason.slice(0, 160)) : currentWords(files, state);
	return {
		id: files.id,
		label: files.label || files.id,
		work: namedWork(files.label, files.id),
		engine: files.engine,
		model: files.model,
		state,
		doing,
		detail: (state === "working" || state === "quiet") && files.activity === "tool" ? files.detail : "",
		lastEventAt: new Date(files.lastEventAt).toISOString(),
		startedAt: new Date(files.startedAt).toISOString(),
		finishedAt: terminal && files.finishedAt !== undefined ? new Date(files.finishedAt).toISOString() : null,
		tools: files.tools,
		hosted: files.hosted,
		role: files.role,
		parent: files.spawnedBy || null,
		group: files.group || null,
		team: files.team || null,
	};
}

function liveState(files: JobFiles, now: number): LiveState | undefined {
	if (isTerminal(files.state)) {
		const finished = files.finishedAt ?? files.lastEventAt;
		return now - finished > FINISHED_SHOWN_MS ? undefined : files.state;
	}
	if (files.state === "") {
		return files.spawning ? "starting" : undefined;
	}
	if (files.state !== "running") {
		return undefined;
	}
	if (files.owner === "none") {
		return "starting";
	}
	if (files.owner === "gone") {
		return "dead";
	}
	const checks = files.activity === "tool" && toolWords(files.lastTool, files.detail) === "running tests and checks";
	if (now - files.lastEventAt > (checks ? CHECK_QUIET_MS : QUIET_MS)) {
		return "quiet";
	}
	return files.activity === "wait" ? "waiting" : "working";
}

/** The current action; for a quiet or dead job, the last one it recorded. The state itself says quiet or dead. */
function currentWords(files: JobFiles, state: LiveState): string {
	if (state === "starting") {
		return "starting";
	}
	if (files.activity === "wait") {
		return "waiting";
	}
	return files.activity === "tool" ? toolWords(files.lastTool, files.detail) : "thinking";
}

const TOOL_WORDS: Record<string, string> = {
	edit: "editing files",
	write: "editing files",
	ast_edit: "editing files",
	apply_patch: "editing files",
	notebook: "editing files",
	read: "reading code",
	grep: "reading code",
	glob: "reading code",
	find: "reading code",
	ls: "reading code",
	lsp: "reading code",
	ast_grep: "reading code",
	task: "running helpers",
	agent: "running helpers",
	wait: "waiting for helpers",
	web_search: "reading the web",
	web_fetch: "reading the web",
	fetch: "reading the web",
	browser: "reading the web",
	eval: "running code",
	todo: "planning",
	finish: "finishing",
};
const SHELL_TOOLS: Record<string, true> = { bash: true, shell: true, exec: true };
/** A test runner or checker as a command word, so `browser-check` or `echo test` stays a plain command. */
const CHECKS =
	/(?:^|[\s;&|(])(?:(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+(?:test|check|lint|typecheck)|node\s+--test|(?:npx\s+)?(?:tsc|biome|eslint|vitest|jest|mocha|pytest)|(?:cargo|go)\s+test)\b/;

/** Plain words for the tool a job runs now. */
export function toolWords(tool: string, detail: string): string {
	const name = tool.trim().toLowerCase();
	if (Object.hasOwn(SHELL_TOOLS, name)) {
		return CHECKS.test(detail.toLowerCase()) ? "running tests and checks" : "running a command";
	}
	const words = Object.hasOwn(TOOL_WORDS, name) ? TOOL_WORDS[name] : undefined;
	return words ?? (name ? `using ${name}` : "using a tool");
}

export function namedWork(label: string, id: string): string[] {
	return [...new Set(`${label}\n${id}`.match(/\bF\d+\b/gi)?.map((feature) => feature.toLowerCase()))];
}

/** Reads every job folder below `jobsRoot`. Keeps what never changes between reads: owner checks, models, long-finished jobs. */
export function activityReader(jobsRoot: string): (now?: number) => Promise<LiveSnapshot> {
	const owners = new Map<string, boolean>();
	const models = new Map<string, string>();
	const settled = new Set<string>();
	return async (now = Date.now()) => {
		const ids = await readdir(jobsRoot, { withFileTypes: true }).then(
			(entries) =>
				entries.filter((entry) => entry.isDirectory() && !settled.has(entry.name)).map((entry) => entry.name),
			() => [],
		);
		const read = await Promise.all(
			ids.map(async (id) => {
				const files = await readJobFiles(join(jobsRoot, id), id, owners, models);
				const job = files && jobActivity(files, now);
				if (files && !job && isTerminal(files.state)) {
					settled.add(id);
				}
				return job;
			}),
		);
		const jobs = read.filter((job): job is LiveJob => job !== undefined);
		const runs = await groupRuns(join(dirname(jobsRoot), "groups"), jobs);
		return { at: new Date(now).toISOString(), jobs: linkJobs(jobs, runs).sort(byPage), groups: groupTrees(jobs, runs) };
	};
}

/** Each job's parent, kept only when it is on the page. An older group worker with no spawn link goes under its team's coordinator. */
function linkJobs(jobs: readonly LiveJob[], runs: readonly GroupRecord[]): LiveJob[] {
	const shown = new Set(jobs.map((job) => job.id));
	const coordinators = new Map<string, string>();
	for (const run of runs) {
		for (const member of run.members) {
			if (member.role === "coordinator" && shown.has(member.id)) {
				coordinators.set(`${run.id}/${member.team}`, member.id);
			}
		}
	}
	return jobs.map((job) => {
		const spawner = job.parent && job.parent !== job.id && shown.has(job.parent) ? job.parent : undefined;
		const team = job.role === "coordinator" ? undefined : coordinators.get(`${job.group}/${job.team}`);
		return { ...job, parent: spawner ?? team ?? null };
	});
}

/** One tree per group run with a member on the page, in roster order, with each team's and the group's states counted. */
function groupTrees(jobs: readonly LiveJob[], runs: readonly GroupRecord[]): LiveGroup[] {
	const byId = new Map(jobs.map((job) => [job.id, job]));
	return runs.flatMap((run) => {
		const teams = run.teams.map((name) => {
			const members = run.members.filter((member) => member.team === name && byId.has(member.id));
			members.sort((a, b) => Number(b.role === "coordinator") - Number(a.role === "coordinator"));
			const ids = members.map((member) => member.id);
			return { name, jobs: ids, count: countStates(ids.flatMap((id) => byId.get(id)?.state ?? [])) };
		});
		const shown = teams.flatMap((team) => team.jobs);
		if (!shown.length) {
			return [];
		}
		const feature = basename(run.feature);
		return [
			{
				id: run.id,
				work: namedWork(feature, ""),
				feature,
				lead: run.lead,
				teams,
				count: countStates(shown.flatMap((id) => byId.get(id)?.state ?? [])),
			},
		];
	});
}

function countStates(states: readonly LiveState[]): StateCount {
	const count: StateCount = {};
	for (const state of states) {
		count[state] = (count[state] ?? 0) + 1;
	}
	return count;
}

/** The run record of every group a shown job belongs to. A missing or unreadable record shows no tree. */
async function groupRuns(groupsRoot: string, jobs: readonly LiveJob[]): Promise<GroupRecord[]> {
	const ids = [...new Set(jobs.flatMap((job) => (job.group && /^[a-zA-Z0-9-]+$/.test(job.group) ? [job.group] : [])))];
	const runs = await Promise.all(
		ids.map((id) =>
			readFile(join(groupsRoot, id, "run.json"), "utf8").then(
				(text) => JSON.parse(text) as GroupRecord,
				() => undefined,
			),
		),
	);
	return runs.filter((run): run is GroupRecord => Array.isArray(run?.members) && Array.isArray(run.teams));
}

function byPage(a: LiveJob, b: LiveJob): number {
	const order = RANK[a.state] - RANK[b.state];
	const recent = Date.parse(b.finishedAt ?? b.lastEventAt) - Date.parse(a.finishedAt ?? a.lastEventAt);
	return order || recent || a.id.localeCompare(b.id);
}

async function readJobFiles(
	dir: string,
	id: string,
	owners: Map<string, boolean>,
	models: Map<string, string>,
): Promise<JobFiles> {
	const field = (name: string) => textFile(join(dir, name));
	const state = await field("state");
	const terminal = isTerminal(state);
	const [
		label = "",
		engine = "",
		activity = "",
		lastTool = "",
		toolDetail = "",
		tools = "",
		stopReason = "",
		started = "",
		finished = "",
		hosted = "",
		role = "",
		spawnedBy = "",
		group = "",
		team = "",
	] = await Promise.all(
		"label engine activity last-tool tool-detail tool-calls stop-reason started-at finished-at hosted role spawned-by group team"
			.split(" ")
			.map(field),
	);
	const session = await sessionFile(dir);
	const [eventAt, stateAt] = await Promise.all([
		newestChange([join(dir, "activity"), join(dir, "log"), ...(session ? [session] : [])]),
		newestChange([join(dir, "state")]),
	]);
	const finishedAt = Date.parse(finished);
	const finishedOrState = terminal ? stateAt : undefined;
	return {
		id,
		state,
		spawning: state === "" && (await startingJob(dir)),
		owner: state === "running" ? await ownerState(dir, id, owners) : "none",
		label,
		engine,
		model: await sessionModel(id, session, models),
		activity,
		lastTool,
		detail: terminal ? "" : await commandDetail(dir, lastTool, toolDetail),
		stopReason,
		tools: Number.parseInt(tools, 10) || 0,
		hosted: hosted !== "",
		role,
		spawnedBy,
		group,
		team,
		startedAt: Date.parse(started) || eventAt || stateAt,
		lastEventAt: eventAt || stateAt,
		finishedAt: Number.isFinite(finishedAt) ? finishedAt : finishedOrState,
	};
}

/** The birth-time check costs a process query, so it runs once per owner; later reads only ask whether the pid lives. */
async function ownerState(dir: string, id: string, owners: Map<string, boolean>): Promise<JobFiles["owner"]> {
	const pid = Number(await textFile(join(dir, "pid")));
	if (!Number.isSafeInteger(pid) || pid <= 0) {
		return "none";
	}
	const key = `${id}:${pid}:${await textFile(join(dir, "born"))}`;
	let verified = owners.get(key);
	if (verified === undefined) {
		verified = await ownerAlive(dir);
		owners.set(key, verified);
	}
	return verified && processAlive(pid) ? "alive" : "gone";
}

/** Hosted jobs record the command; detached jobs log it after the tool name. */
async function commandDetail(dir: string, lastTool: string, recorded: string): Promise<string> {
	if (recorded) {
		return recorded === lastTool ? "" : recorded;
	}
	if (!lastTool) {
		return "";
	}
	const lines = (await tail(join(dir, "log"), 4096)).split("\n");
	const line = lines.findLast((entry) => entry.startsWith(`${lastTool} `));
	return line ? line.slice(lastTool.length + 1).slice(0, 80) : "";
}

async function sessionFile(dir: string): Promise<string | undefined> {
	const names = await readdir(join(dir, "session")).catch(() => []);
	const newest = names
		.filter((name) => name.endsWith(".jsonl") && !name.startsWith("."))
		.sort()
		.at(-1);
	return newest ? join(dir, "session", newest) : undefined;
}

/**
 * Both engines write a `model_change` entry near the start of the session file once the first message lands:
 * OMP as `model: "provider/id"`, Pi as `provider` and `modelId`.
 */
async function sessionModel(id: string, session: string | undefined, models: Map<string, string>): Promise<string> {
	const known = models.get(id);
	if (known !== undefined || !session) {
		return known ?? "";
	}
	const head = await headText(session, 65_536);
	for (const line of head.split("\n")) {
		if (!line.includes('"model_change"')) {
			continue;
		}
		try {
			const entry = JSON.parse(line) as { type?: unknown; model?: unknown; provider?: unknown; modelId?: unknown };
			const pi = typeof entry.modelId === "string" && typeof entry.provider === "string";
			const model = typeof entry.model === "string" ? entry.model : pi ? `${entry.provider}/${entry.modelId}` : "";
			if (entry.type === "model_change" && model) {
				models.set(id, model);
				return model;
			}
		} catch {}
	}
	return "";
}

async function newestChange(paths: readonly string[]): Promise<number> {
	const times = await Promise.all(
		paths.map((path) =>
			stat(path).then(
				(info) => info.mtimeMs,
				() => 0,
			),
		),
	);
	return Math.max(0, ...times);
}

async function headText(path: string, bytes: number): Promise<string> {
	const handle = await open(path, "r").catch(() => undefined);
	if (!handle) {
		return "";
	}
	try {
		const buffer = Buffer.alloc(bytes);
		const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
		return buffer.subarray(0, bytesRead).toString("utf8");
	} finally {
		await handle.close();
	}
}

async function tail(path: string, bytes: number): Promise<string> {
	const handle = await open(path, "r").catch(() => undefined);
	if (!handle) {
		return "";
	}
	try {
		const { size } = await handle.stat();
		const length = Math.min(size, bytes);
		const buffer = Buffer.alloc(length);
		await handle.read(buffer, 0, length, size - length);
		return buffer.toString("utf8");
	} finally {
		await handle.close();
	}
}
