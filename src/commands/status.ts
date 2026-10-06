import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { herdrBinary } from "../integrations/herdr.ts";
import { type GroupIdentity, jobMembership } from "../job/group-cabinet.ts";
import { isTerminal } from "../job/job.ts";
import { type JobRecord, noteKind } from "../job/view.ts";
import { limenRoot, unlandedBranches, workspaceRepository, workspaceRoot } from "../project/git.ts";
import { confirmDeadJobs } from "../runtime/reap.ts";
import { RECENT_MS, renderJobDirectory, shownState } from "./jobs.ts";

const text = (path: string) =>
	readFile(path, "utf8").then(
		(value) => value.trim(),
		() => "",
	);

type Agent = {
	pane_id?: string;
	tab_id?: string;
	cwd?: string;
	agent_status?: string;
	interactive_ready?: boolean;
	name?: string;
};
type Tab = { tab_id?: string; label?: string; number?: number; agent_status?: string };

type Finished = {
	readonly id: string;
	readonly label: string;
	readonly state: string;
	readonly branch: string;
	readonly repo: string;
};

type JobFiles = {
	readonly state: string;
	readonly label: string;
	readonly branch: string;
	readonly repo: string;
	readonly pane: string;
	readonly tab: string;
	readonly worktree: string;
	readonly origin: string;
	readonly started: string;
	readonly ended: string;
};

/** What one pass over the job directories found, before Git says which branches are unlanded. */
type Scan = {
	readonly root: string;
	readonly jobsRoot: string;
	readonly all: boolean;
	readonly now: number;
	readonly running: string[];
	readonly runningBranches: Set<string>;
	readonly uncertain: string[];
	readonly workerPanes: Set<string>;
	readonly worktrees: Set<string>;
	readonly originTabs: Set<string>;
	readonly finished: Map<string, Finished>;
	readonly groups: Map<string, { readonly feature: string; readonly branches: Set<string> }>;
	older: number;
	lastOrigin: string;
};

export async function statusCommand(args: readonly string[], cwd: string): Promise<void> {
	const all = parseStatusArgs(args);
	const root = existsSync(`${resolve(cwd)}/.limen/jobs`) ? resolve(cwd) : limenRoot(cwd);
	const jobsRoot = `${root}/.limen/jobs`;
	await confirmDeadJobs(jobsRoot);
	const ids = await jobIds(jobsRoot);
	const scan: Scan = {
		root,
		jobsRoot,
		all,
		now: Date.now(),
		running: [],
		runningBranches: new Set(),
		uncertain: [],
		workerPanes: new Set(),
		worktrees: new Set(),
		originTabs: new Set(),
		finished: new Map(),
		groups: new Map(),
		older: 0,
		lastOrigin: "",
	};
	for (const id of ids) {
		await scanJob(scan, id);
	}
	if (!scan.originTabs.size && scan.lastOrigin) {
		scan.originTabs.add(scan.lastOrigin);
	}
	const ready = [...scan.groups].map(
		([id, group]) =>
			`  group ${group.feature}: ${group.branches.size} member branches; the lead decides (limen group status ${id})`,
	);
	const decide: string[] = [];
	sortUnlandedBranches(scan, ready, decide);
	const coordinators = coordinatorLines(
		root,
		workspaceRoot(root) !== undefined,
		scan.workerPanes,
		scan.worktrees,
		scan.originTabs,
	);
	console.log(
		[
			`Plant ${root}`,
			`Running (${scan.running.length}):`,
			...(scan.running.length ? scan.running : ["  none"]),
			`Candidates to inspect (${ready.length}):`,
			...(ready.length ? ready : ["  none"]),
			`Needs a decision (${decide.length}):`,
			...(decide.length ? decide : ["  none"]),
			...(scan.uncertain.length ? ["Unconfirmed jobs:", ...scan.uncertain] : []),
			...(all ? [] : [`Older: ${scan.older} record${scan.older === 1 ? "" : "s"} (limen status --all)`]),
			"Coordinator tabs:",
			...coordinators,
		].join("\n"),
	);
}

/** True for `--all`. Status takes no other argument. */
function parseStatusArgs(args: readonly string[]): boolean {
	const all = args[0] === "--all";
	if (args.length > (all ? 1 : 0)) {
		throw new Error("status accepts no arguments or --all");
	}
	return all;
}

async function jobIds(jobsRoot: string): Promise<string[]> {
	const entries = await readdir(jobsRoot, { withFileTypes: true }).catch((error: unknown) => {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
			return [];
		}
		throw error;
	});
	return entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
}

async function readJobFiles(dir: string): Promise<JobFiles> {
	const [
		state = "",
		label = "",
		branch = "",
		repo = "",
		pane = "",
		tab = "",
		worktree = "",
		origin = "",
		started = "",
		ended = "",
	] = await Promise.all(
		[
			"state",
			"label",
			"branch",
			"repo",
			"herdr/agent",
			"herdr/tab",
			"worktree",
			"origin-tab",
			"started-at",
			"finished-at",
		].map((name) => (name === "state" ? shownState(dir) : text(`${dir}/${name}`))),
	);
	return { state, label, branch, repo, pane, tab, worktree, origin, started, ended };
}

/** Sorts one job into running, older, unconfirmed, a group's branches, or a finished branch. */
async function scanJob(scan: Scan, id: string): Promise<void> {
	const dir = `${scan.jobsRoot}/${id}`;
	const job = await readJobFiles(dir);
	noteJobPanes(scan, job);
	if (job.state === "running") {
		if (job.branch) {
			scan.runningBranches.add(`${job.repo}:${job.branch}`);
		}
		scan.running.push(await runningJobLine(scan, id, job));
		return;
	}
	const group = isTerminal(job.state) ? await openGroupMembership(dir, scan.root) : undefined;
	if (group?.run.closed) {
		return;
	}
	const finishedAt =
		Date.parse(job.ended) ||
		(await stat(job.state ? `${dir}/state` : dir).then(
			(value) => value.mtimeMs,
			() => 0,
		));
	if (!scan.all && scan.now - finishedAt > RECENT_MS) {
		scan.older += 1;
		return;
	}
	if (!isTerminal(job.state)) {
		scan.uncertain.push(`  ${job.label || id} (${id}) · unknown state ${job.state || "missing"}`);
		return;
	}
	if (group) {
		if (job.branch) {
			const candidate = scan.groups.get(group.run.id) ?? { feature: group.run.feature, branches: new Set<string>() };
			candidate.branches.add(`${job.repo}:${job.branch}`);
			scan.groups.set(group.run.id, candidate);
		}
		return;
	}
	if (job.branch) {
		scan.finished.set(`${job.repo}:${job.branch}`, {
			id,
			label: job.label || id,
			state: job.state,
			branch: job.branch,
			repo: job.repo,
		});
	}
}

/** Panes, tabs and worktrees that belong to workers, so the coordinator list can leave them out. */
function noteJobPanes(scan: Scan, job: JobFiles): void {
	if (job.pane) {
		scan.workerPanes.add(job.pane);
	}
	if (job.tab) {
		scan.workerPanes.add(job.tab);
	}
	if (job.worktree) {
		scan.worktrees.add(job.worktree);
	}
	if (job.origin && job.state === "running") {
		scan.originTabs.add(job.origin);
	}
	if (job.origin) {
		scan.lastOrigin = job.origin;
	}
}

async function runningJobLine(scan: Scan, id: string, job: JobFiles): Promise<string> {
	const { record } = await renderJobDirectory(scan.root, scan.jobsRoot, id, "row");
	const started = Date.parse(job.started);
	const minutes = started ? `${Math.max(0, Math.floor((scan.now - started) / 60_000))}m` : "";
	return [
		`  ${record.job?.label ?? (job.label || id)} (${id})`,
		job.tab,
		minutes,
		runningAttention(record),
		record.lastTool ?? "",
		job.repo ? `repo ${job.repo}` : "",
	]
		.filter(Boolean)
		.join(" · ");
}

/** Pulse, silence and advisory of a running job, or why its record is invalid. */
function runningAttention(record: JobRecord): string {
	if (record.invalid) {
		return `invalid: ${record.invalid}`;
	}
	const note = record.advisory ?? "";
	const kind = note && noteKind(note);
	const silent =
		record.silentMs !== undefined && record.silentMs >= 90_000 ? `silent ${Math.floor(record.silentMs / 60_000)}m` : "";
	return [
		record.pulse === "dead" ? "dead" : (record.pulse ?? "unknown activity"),
		silent,
		note.startsWith(kind) ? note : `${kind}: ${note}`,
	]
		.filter(Boolean)
		.join(" · ");
}

/** The group a finished job belongs to, if its run is readable and in this plant. */
async function openGroupMembership(dir: string, root: string): Promise<GroupIdentity | undefined> {
	try {
		const group = await jobMembership(dir);
		if (
			group &&
			(group.run.root !== root ||
				typeof group.run.feature !== "string" ||
				!group.run.feature.trim() ||
				typeof group.run.closed !== "boolean")
		) {
			return undefined;
		}
		return group;
	} catch {
		// Unreadable membership must not hide a recoverable branch.
		return undefined;
	}
}

/** Asks Git which finished branches are unlanded: a done job is a candidate, any other state needs a decision. */
function sortUnlandedBranches(scan: Scan, ready: string[], decide: string[]): void {
	const byRepo = Map.groupBy(
		[...scan.finished].filter(([key]) => !scan.runningBranches.has(key)).map(([, job]) => job),
		(job) => job.repo,
	);
	for (const [repo, jobs] of byRepo) {
		let unlanded: ReadonlySet<string>;
		try {
			unlanded = unlandedBranches(
				repo ? workspaceRepository(scan.root, repo) : scan.root,
				jobs.map((job) => job.branch),
			);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			scan.uncertain.push(...jobs.map((job) => `  ${job.label} (${job.id}) · Git unknown: ${reason}`));
			continue;
		}
		for (const job of jobs.filter((each) => unlanded.has(each.branch))) {
			const line = `  ${job.label} (${job.id}) · ${job.state === "done" ? "" : `${job.state} · `}${job.branch}${repo ? ` · repo ${repo}` : ""}`;
			(job.state === "done" ? ready : decide).push(line);
		}
	}
}

function coordinatorLines(
	root: string,
	workspace: boolean,
	workers: ReadonlySet<string>,
	worktrees: ReadonlySet<string>,
	origins: ReadonlySet<string>,
): string[] {
	const bin = herdrBinary();
	if (!bin) {
		return ["  unknown (Herdr unavailable)"];
	}
	const result = spawnSync(bin, ["agent", "list"], { encoding: "utf8", timeout: 5_000 });
	if (result.error || result.status !== 0) {
		return recordedOriginLines(bin, origins, workers);
	}
	try {
		const payload = JSON.parse(result.stdout) as { result?: { agents?: Agent[] }; agents?: Agent[] };
		const agents = payload.result?.agents ?? payload.agents;
		if (!Array.isArray(agents)) {
			return recordedOriginLines(bin, origins, workers);
		}
		const plant = realpathSync(root);
		const relevant = agents.filter((agent) => {
			if (
				!agent.cwd ||
				!agent.tab_id ||
				workers.has(agent.pane_id ?? "") ||
				workers.has(agent.tab_id) ||
				worktrees.has(agent.cwd)
			) {
				return false;
			}
			let path: string;
			try {
				path = relative(plant, realpathSync(agent.cwd));
			} catch {
				return false;
			}
			return path === "" || (workspace && path !== ".." && !path.startsWith("../") && !path.startsWith(".limen"));
		});
		if (!relevant.length) {
			return ["  none found (not proof of an idle plant)"];
		}
		const tabs = listTabs(bin, []);
		return relevant.map((agent) => {
			const tab = tabs?.find((candidate) => candidate.tab_id === agent.tab_id);
			const subject = tabs ? ((tab && tabLabel(tab)) ?? "unlabeled tab") : "tab label unknown";
			const handle = agent.name ? `handle ${agent.name}` : "no handle";
			const ready = agent.interactive_ready === false ? " (not interactive)" : "";
			const where = agent.cwd && realpathSync(agent.cwd) !== plant ? ` · ${agent.cwd}` : "";
			return `  ${subject} · ${handle} · ${agent.agent_status ?? "unknown"}${ready} · ${agent.tab_id}${agent.pane_id ? ` ${agent.pane_id}` : ""}${where}`;
		});
	} catch {
		return recordedOriginLines(bin, origins, workers);
	}
}

/** Agent enumeration can stall while workspace tab listing still works. Origin tabs are partial evidence, not a coordinator registry. */
function recordedOriginLines(bin: string, origins: ReadonlySet<string>, workers: ReadonlySet<string>): string[] {
	const lines: string[] = [];
	const spaces = new Set([...origins].map((tab) => tab.split(":")[0]).filter((space): space is string => !!space));
	for (const workspace of spaces) {
		for (const tab of listTabs(bin, ["--workspace", workspace]) ?? []) {
			if (tab.tab_id && origins.has(tab.tab_id) && !workers.has(tab.tab_id)) {
				lines.push(`  ${tabLabel(tab) ?? "unlabeled tab"} · ${tab.agent_status ?? "unknown"} · ${tab.tab_id}`);
			}
		}
	}
	return lines.length
		? ["  Agent list unavailable; recorded origin tabs only (coordinator role unconfirmed):", ...lines]
		: ["  unknown (Herdr agent list unavailable; recorded origins unconfirmed)"];
}

/** Herdr's default tab label is the tab number, which names nothing. */
function tabLabel(tab: Tab): string | undefined {
	const label = tab.label?.trim();
	return label && label !== String(tab.number) ? label : undefined;
}

function listTabs(bin: string, args: readonly string[]): readonly Tab[] | undefined {
	const result = spawnSync(bin, ["tab", "list", ...args], { encoding: "utf8", timeout: 2_000 });
	if (result.error || result.status !== 0) {
		return undefined;
	}
	try {
		const tabs = (JSON.parse(result.stdout) as { result?: { tabs?: Tab[] } }).result?.tabs;
		return Array.isArray(tabs) ? tabs : undefined;
	} catch {
		return undefined;
	}
}
