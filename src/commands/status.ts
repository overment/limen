import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { herdrBinary } from "../integrations/herdr.ts";
import { type GroupIdentity, jobMembership } from "../job/group-cabinet.ts";
import { isTerminal } from "../job/job.ts";
import { noteKind } from "../job/view.ts";
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

export async function statusCommand(args: readonly string[], cwd: string): Promise<void> {
	const all = args[0] === "--all";
	if (args.length > (all ? 1 : 0)) {
		throw new Error("status accepts no arguments or --all");
	}
	const root = existsSync(`${resolve(cwd)}/.limen/jobs`) ? resolve(cwd) : limenRoot(cwd);
	const jobsRoot = `${root}/.limen/jobs`;
	await confirmDeadJobs(jobsRoot);
	const entries = await readdir(jobsRoot, { withFileTypes: true }).catch((error: unknown) => {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
			return [];
		}
		throw error;
	});
	const ids = entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
	const now = Date.now();
	const running: string[] = [];
	const runningBranches = new Set<string>();
	const uncertain: string[] = [];
	const workerPanes = new Set<string>();
	const worktrees = new Set<string>();
	const originTabs = new Set<string>();
	const finished = new Map<string, Finished>();
	const groups = new Map<string, { readonly feature: string; readonly branches: Set<string> }>();
	let older = 0;
	let lastOrigin = "";
	for (const id of ids) {
		const dir = `${jobsRoot}/${id}`;
		const [state = "", label = "", branch = "", repo = "", pane, tab, worktree, origin, started = "", ended = ""] =
			await Promise.all(
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
		if (pane) {
			workerPanes.add(pane);
		}
		if (tab) {
			workerPanes.add(tab);
		}
		if (worktree) {
			worktrees.add(worktree);
		}
		if (origin && state === "running") {
			originTabs.add(origin);
		}
		if (origin) {
			lastOrigin = origin;
		}
		if (state === "running") {
			if (branch) {
				runningBranches.add(`${repo}:${branch}`);
			}
			const { record } = await renderJobDirectory(root, jobsRoot, id, "row");
			const minutes = Date.parse(started) ? `${Math.max(0, Math.floor((now - Date.parse(started)) / 60_000))}m` : "";
			const note = record.advisory ?? "";
			const kind = note && noteKind(note);
			const attention = record.invalid
				? `invalid: ${record.invalid}`
				: [
						record.pulse === "dead" ? "dead" : (record.pulse ?? "unknown activity"),
						record.silentMs !== undefined && record.silentMs >= 90_000
							? `silent ${Math.floor(record.silentMs / 60_000)}m`
							: "",
						note.startsWith(kind) ? note : `${kind}: ${note}`,
					]
						.filter(Boolean)
						.join(" · ");
			running.push(
				[
					`  ${record.job?.label ?? (label || id)} (${id})`,
					tab,
					minutes,
					attention,
					record.lastTool ?? "",
					repo ? `repo ${repo}` : "",
				]
					.filter(Boolean)
					.join(" · "),
			);
			continue;
		}
		let group: GroupIdentity | undefined;
		if (isTerminal(state)) {
			try {
				group = await jobMembership(dir);
				if (
					group &&
					(group.run.root !== root ||
						typeof group.run.feature !== "string" ||
						!group.run.feature.trim() ||
						typeof group.run.closed !== "boolean")
				) {
					group = undefined;
				}
			} catch {
				// Unreadable membership must not hide a recoverable branch.
				group = undefined;
			}
			if (group?.run.closed) {
				continue;
			}
		}
		const finishedAt =
			Date.parse(ended) ||
			(await stat(state ? `${dir}/state` : dir).then(
				(value) => value.mtimeMs,
				() => 0,
			));
		if (!all && now - finishedAt > RECENT_MS) {
			older++;
			continue;
		}
		if (!isTerminal(state)) {
			uncertain.push(`  ${label || id} (${id}) · unknown state ${state || "missing"}`);
			continue;
		}
		if (group) {
			if (branch) {
				const candidate = groups.get(group.run.id) ?? { feature: group.run.feature, branches: new Set<string>() };
				candidate.branches.add(`${repo}:${branch}`);
				groups.set(group.run.id, candidate);
			}
			continue;
		}
		if (branch) {
			finished.set(`${repo}:${branch}`, { id, label: label || id, state, branch, repo });
		}
	}
	if (!originTabs.size && lastOrigin) {
		originTabs.add(lastOrigin);
	}
	const ready = [...groups].map(
		([id, group]) =>
			`  group ${group.feature}: ${group.branches.size} member branches; the lead decides (limen group status ${id})`,
	);
	const decide: string[] = [];
	const byRepo = Map.groupBy(
		[...finished].filter(([key]) => !runningBranches.has(key)).map(([, job]) => job),
		(job) => job.repo,
	);
	for (const [repo, jobs] of byRepo) {
		let unlanded: ReadonlySet<string>;
		try {
			unlanded = unlandedBranches(
				repo ? workspaceRepository(root, repo) : root,
				jobs.map((job) => job.branch),
			);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			uncertain.push(...jobs.map((job) => `  ${job.label} (${job.id}) · Git unknown: ${reason}`));
			continue;
		}
		for (const job of jobs) {
			if (!unlanded.has(job.branch)) {
				continue;
			}
			const line = `  ${job.label} (${job.id}) · ${job.state === "done" ? "" : `${job.state} · `}${job.branch}${repo ? ` · repo ${repo}` : ""}`;
			(job.state === "done" ? ready : decide).push(line);
		}
	}
	const coordinators = coordinatorLines(root, workspaceRoot(root) !== undefined, workerPanes, worktrees, originTabs);
	console.log(
		[
			`Plant ${root}`,
			`Running (${running.length}):`,
			...(running.length ? running : ["  none"]),
			`Candidates to inspect (${ready.length}):`,
			...(ready.length ? ready : ["  none"]),
			`Needs a decision (${decide.length}):`,
			...(decide.length ? decide : ["  none"]),
			...(uncertain.length ? ["Unconfirmed jobs:", ...uncertain] : []),
			...(all ? [] : [`Older: ${older} record${older === 1 ? "" : "s"} (limen status --all)`]),
			"Coordinator tabs:",
			...coordinators,
		].join("\n"),
	);
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
