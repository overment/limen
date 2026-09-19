import { readdir, readFile, realpath, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { limenRoot, listWorktrees, pruneWorktrees, removeWorktree, workspaceRepository } from "../git.ts";
import { liveJob, STARTUP_GRACE_MS } from "../reap.ts";

export async function pruneCommand(args: readonly string[], cwd: string): Promise<void> {
	if (args.length) throw new Error("prune takes no arguments");
	const removed = await pruneFinishedWorktrees(limenRoot(cwd));
	console.log(removed === 0 ? "no finished worktrees" : `pruned ${removed} finished worktree${removed === 1 ? "" : "s"}`);
}

export async function pruneFinishedWorktrees(root: string, keep: readonly string[] = []): Promise<number> {
	const jobsRoot = `${root}/.limen/jobs`;
	const keepPaths = new Set<string>();
	for (const path of keep) keepPaths.add(await resolved(path));
	const repositories = new Set<string>();
	let removed = 0;
	const entries = await readdir(jobsRoot, { withFileTypes: true }).catch((error: unknown) => {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return [];
		throw error;
	});
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const jobDir = `${jobsRoot}/${entry.name}`;
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
	for (const entry of await readdir(jobsRoot, { withFileTypes: true }).catch(() => [] as const)) {
		if (!entry.isDirectory()) continue;
		const jobDir = `${jobsRoot}/${entry.name}`;
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
