import { readdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { limenRoot, listWorktrees, pruneWorktrees, removeWorktree, workspaceRepository } from "../git.ts";
import { processGroupAlive } from "../proc.ts";

export async function pruneCommand(args: readonly string[], cwd: string): Promise<void> {
	if (args.length) throw new Error("prune takes no arguments");
	const removed = await pruneFinishedWorktrees(limenRoot(cwd));
	console.log(removed === 0 ? "no finished worktrees" : `pruned ${removed} finished worktree${removed === 1 ? "" : "s"}`);
}

export async function pruneFinishedWorktrees(root: string, keep: readonly string[] = []): Promise<number> {
	const jobsRoot = `${root}/.limen/jobs`;
	const keepPaths = new Set(keep.map((path) => resolve(path)));
	const repositories = new Set<string>();
	const entries = await readdir(jobsRoot, { withFileTypes: true }).catch((error: unknown) => {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return [];
		throw error;
	});
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const jobDir = `${jobsRoot}/${entry.name}`;
		const repo = (await text(`${jobDir}/repo`)) || undefined;
		const repository = repo ? workspaceRepository(root, repo) : root;
		repositories.add(repository);
		if (await liveJob(jobDir)) {
			const branch = await text(`${jobDir}/branch`);
			const live = listWorktrees(repository).find((worktree) => worktree.branch === branch);
			if (live) keepPaths.add(resolve(live.path));
		}
	}
	if (repositories.size === 0) repositories.add(root);
	let removed = 0;
	for (const repository of repositories) {
		const worktreeRoot = resolve(`${dirname(repository)}/.${basename(repository)}-limen-worktrees`);
		for (const worktree of listWorktrees(repository)) {
			const path = resolve(worktree.path);
			if (path === resolve(repository) || !path.startsWith(`${worktreeRoot}/`) || keepPaths.has(path)) continue;
			try {
				removeWorktree(repository, path);
				removed += 1;
			} catch {
				// A locked checkout stays until the next prune.
			}
		}
		pruneWorktrees(repository);
		const leftovers = await readdir(worktreeRoot, { withFileTypes: true }).catch(() => []);
		for (const leftover of leftovers) {
			const path = resolve(worktreeRoot, leftover.name);
			if (keepPaths.has(path)) continue;
			await rm(path, { recursive: true, force: true });
		}
	}
	return removed;
}

async function liveJob(jobDir: string): Promise<boolean> {
	if ((await text(`${jobDir}/state`)) !== "running") return false;
	const pid = Number(await text(`${jobDir}/pid`));
	return Number.isSafeInteger(pid) && pid > 0 && processGroupAlive(pid);
}

function text(path: string): Promise<string> {
	return readFile(path, "utf8").then(
		(value) => value.trim(),
		() => "",
	);
}
