import { readdir, readFile, realpath, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { branchExists, branchMerged, limenRoot, listWorktrees, pruneWorktrees, removeWorktree, workspaceRepository } from "../git.ts";
import { liveJob, STARTUP_GRACE_MS } from "../reap.ts";

export async function pruneCommand(args: readonly string[], cwd: string): Promise<void> {
	const retire = args.includes("--retire"),
		dryRun = args.includes("--dry-run");
	if (args.some((value) => value !== "--retire" && value !== "--dry-run")) throw new Error("prune accepts no arguments, --retire, or --retire --dry-run");
	if (dryRun && !retire) throw new Error("prune --dry-run requires --retire");
	if (!retire) {
		const removed = await pruneFinishedWorktrees(limenRoot(cwd));
		console.log(removed === 0 ? "no finished worktrees" : `pruned ${removed} finished worktree${removed === 1 ? "" : "s"}`);
		return;
	}
	const ids = await retireFinishedJobs(limenRoot(cwd), dryRun);
	if (dryRun && ids.length) console.log(ids.map((id) => `would retire ${id}`).join("\n"));
	else console.log(ids.length === 0 ? "no finished jobs to retire" : `retired ${ids.length} job${ids.length === 1 ? "" : "s"}`);
}

async function retireFinishedJobs(root: string, dryRun: boolean): Promise<readonly string[]> {
	const jobsRoot = `${root}/.limen/jobs`,
		retired: string[] = [];
	for (const id of (await jobIds(jobsRoot)).sort()) {
		const jobDir = `${jobsRoot}/${id}`;
		const state = await text(`${jobDir}/state`);
		if (state !== "done" && state !== "failed" && state !== "stopped") continue;
		try {
			const branch = await text(`${jobDir}/branch`);
			const repo = branch ? await text(`${jobDir}/repo`) : "";
			const repository = repo ? workspaceRepository(root, repo) : root;
			if (branch && branchExists(repository, branch) && !branchMerged(repository, branch)) continue;
		} catch {
			continue;
		}
		if (!dryRun) await rm(jobDir, { recursive: true, force: true });
		retired.push(id);
	}
	return retired;
}

export async function pruneFinishedWorktrees(root: string, keep: readonly string[] = []): Promise<number> {
	const jobsRoot = `${root}/.limen/jobs`;
	const keepPaths = new Set<string>();
	for (const path of keep) keepPaths.add(await resolved(path));
	const repositories = new Set<string>();
	let removed = 0;
	for (const id of await jobIds(jobsRoot)) {
		const jobDir = `${jobsRoot}/${id}`;
		if (!(await text(`${jobDir}/state`))) {
			const startedAt = Date.parse(await text(`${jobDir}/started-at`));
			if (Number.isFinite(startedAt) && Date.now() - startedAt < STARTUP_GRACE_MS) continue;
			await rm(jobDir, { recursive: true, force: true });
			removed += 1;
			continue;
		}
		const repo = (await text(`${jobDir}/repo`)) || undefined;
		const repository = repo ? workspaceRepository(root, repo) : root;
		repositories.add(repository);
	}
	if (repositories.size === 0) repositories.add(root);
	for (const id of await jobIds(jobsRoot)) {
		const jobDir = `${jobsRoot}/${id}`;
		const recorded = await text(`${jobDir}/worktree`);
		if (!recorded) continue;
		const state = await text(`${jobDir}/state`);
		const startedAt = Date.parse(await text(`${jobDir}/started-at`));
		if (state ? await liveJob(jobDir) : Number.isFinite(startedAt) && Date.now() - startedAt < STARTUP_GRACE_MS) keepPaths.add(await resolved(recorded));
	}
	for (const repository of repositories) {
		const worktreeRoot = await resolved(`${dirname(repository)}/.${basename(repository)}-limen-worktrees`);
		const primary = await resolved(repository);
		for (const worktree of listWorktrees(repository)) {
			const path = await resolved(worktree.path);
			if (path === primary || !path.startsWith(`${worktreeRoot}/`) || keepPaths.has(path)) continue;
			// Nested roots belong to another checkout, whose jobs this prune cannot see.
			if (/^\.[^/]*-limen-worktrees(?:\/|$)/.test(path.slice(worktreeRoot.length + 1))) continue;
			try {
				removeWorktree(repository, path);
				removed += 1;
			} catch {
				// A locked checkout stays until the next prune.
			}
		}
		pruneWorktrees(repository);
		const registered = new Set(await Promise.all(listWorktrees(repository).map((worktree) => resolved(worktree.path))));
		const leftovers = await readdir(worktreeRoot, { withFileTypes: true }).catch(() => []);
		for (const leftover of leftovers) {
			if (/^\..*-limen-worktrees$/.test(leftover.name)) continue;
			const path = await resolved(resolve(worktreeRoot, leftover.name));
			if (keepPaths.has(path) || registered.has(path)) continue;
			await rm(path, { recursive: true, force: true });
		}
	}
	return removed;
}

async function jobIds(jobsRoot: string): Promise<string[]> {
	const entries = await readdir(jobsRoot, { withFileTypes: true }).catch((error: unknown) => {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return [];
		throw error;
	});
	return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}
function resolved(path: string): Promise<string> {
	return realpath(path).then(
		(value) => value,
		() => resolve(path),
	);
}
function text(path: string): Promise<string> {
	return readFile(path, "utf8").then(
		(value) => value.trim(),
		() => "",
	);
}
