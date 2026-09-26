import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { branchExists, branchMerged, commitList, headCommit, limenRoot, workspaceRepository, workspaceRoot } from "../git.ts";
import { confirmDeadJobs } from "../reap.ts";
import { renderJobDirectory } from "./jobs.ts";

const text = (path: string) =>
	readFile(path, "utf8").then(
		(value) => value.trim(),
		() => "",
	);

type Agent = { pane_id?: string; tab_id?: string; cwd?: string; agent_status?: string; interactive_ready?: boolean };

export async function statusCommand(args: readonly string[], cwd: string): Promise<void> {
	if (args.length) throw new Error("status accepts no arguments");
	const root = existsSync(`${resolve(cwd)}/.limen/jobs`) ? resolve(cwd) : limenRoot(cwd);
	const jobsRoot = `${root}/.limen/jobs`;
	await confirmDeadJobs(jobsRoot);
	const entries = await readdir(jobsRoot, { withFileTypes: true }).catch((error: unknown) => {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return [];
		throw error;
	});
	const ids = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	const running: string[] = [];
	const waiting = new Map<string, string>();
	const runningBranches = new Set<string>();
	const uncertain: string[] = [];
	const workerPanes = new Set<string>();
	const worktrees = new Set<string>();
	for (const id of ids) {
		const dir = `${jobsRoot}/${id}`;
		const [state, branch, repo, pane, tab, worktree, base] = await Promise.all(
			["state", "branch", "repo", "herdr/agent", "herdr/tab", "worktree", "base"].map((name) => text(`${dir}/${name}`)),
		);
		if (pane) workerPanes.add(pane);
		if (tab) workerPanes.add(tab);
		if (worktree) worktrees.add(worktree);
		const { record } = await renderJobDirectory(root, jobsRoot, id, false);
		const label = record.job?.label ?? id;
		if (state === "running") {
			if (branch) runningBranches.add(`${repo}:${branch}`);
			const attention = record.invalid
				? `invalid: ${record.invalid}`
				: [
						record.pulse === "dead" ? "dead" : (record.pulse ?? "unknown activity"),
						record.silentMs !== undefined && record.silentMs >= 90_000 ? `silent ${Math.floor(record.silentMs / 60_000)}m` : "",
						record.advisory ? `advisory ${record.advisory}` : "",
					]
						.filter(Boolean)
						.join(" · ");
			running.push(`  ${label} (${id}) · ${attention}${record.lastTool ? ` · ${record.lastTool}` : ""}${repo ? ` · repo ${repo}` : ""}`);
			continue;
		}
		if ((state !== "done" && state !== "failed" && state !== "stopped") || record.invalid) {
			uncertain.push(`  ${label} (${id}) · ${record.invalid ?? `unknown state ${state || "missing"}`}`);
			continue;
		}
		if (!branch) continue;
		try {
			const repository = repo ? workspaceRepository(root, repo) : root;
			headCommit(repository); // A missing repository is unknown, not a missing branch.
			if (branchExists(repository, branch) && !branchMerged(repository, branch)) {
				const commits = base ? commitList(repository, base, branch) : undefined;
				if (base && commits === undefined) throw new Error(`cannot compare base ${base} with ${branch}`);
				if (!base || commits)
					waiting.set(`${repo}:${branch}`, `  ${label} (${id}) · ${state} · ${branch}${repo ? ` · repo ${repo}` : ""} · waiting on owner${base ? "" : " (base unknown)"}`);
			}
		} catch (error) {
			uncertain.push(`  ${label} (${id}) · Git unknown: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	const pending = [...waiting].filter(([key]) => !runningBranches.has(key)).map(([, value]) => value);
	const coordinators = coordinatorLines(root, workspaceRoot(root) !== undefined, workerPanes, worktrees);
	console.log(
		[
			`Plant ${root}`,
			`Running (${running.length}):`,
			...(running.length ? running : ["  none"]),
			`Waiting on owner (${pending.length}):`,
			...(pending.length ? pending : ["  none confirmed"]),
			...(uncertain.length ? ["Unconfirmed jobs:", ...uncertain] : []),
			"Coordinator tabs:",
			...coordinators,
		].join("\n"),
	);
}

function coordinatorLines(root: string, workspace: boolean, workers: ReadonlySet<string>, worktrees: ReadonlySet<string>): string[] {
	const bin = process.env.LIMEN_HERDR?.trim() || "herdr";
	if (bin === "0") return ["  unknown (Herdr unavailable)"];
	const result = spawnSync(bin, ["agent", "list"], { encoding: "utf8", timeout: 5_000 });
	if (result.error || result.status !== 0) return ["  unknown (Herdr unavailable)"];
	try {
		const payload = JSON.parse(result.stdout) as { result?: { agents?: Agent[] }; agents?: Agent[] };
		const agents = payload.result?.agents ?? payload.agents;
		if (!Array.isArray(agents)) return ["  unknown (Herdr agent list unavailable)"];
		const plant = realpathSync(root);
		const relevant = agents.filter((agent) => {
			if (!agent.cwd || !agent.tab_id || workers.has(agent.pane_id ?? "") || workers.has(agent.tab_id) || worktrees.has(agent.cwd)) return false;
			let path: string;
			try {
				path = relative(plant, realpathSync(agent.cwd));
			} catch {
				return false;
			}
			return path === "" || (workspace && path !== ".." && !path.startsWith("../") && !path.startsWith(".limen"));
		});
		return relevant.length
			? relevant.map(
					(agent) =>
						`  ${agent.tab_id} · ${agent.agent_status ?? "unknown"}${agent.interactive_ready === false ? " (not interactive)" : ""}${agent.cwd && realpathSync(agent.cwd) !== plant ? ` · ${agent.cwd}` : ""}`,
				)
			: ["  none found (not proof of an idle plant)"];
	} catch {
		return ["  unknown (invalid Herdr response)"];
	}
}
