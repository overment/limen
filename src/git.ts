import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
export type GitWorktree = { readonly path: string; readonly branch?: string; readonly detached: boolean };
type GitResult = { readonly stdout: string; readonly stderr: string; readonly status: number };
export function repoRoot(cwd: string): string {
	return requireGit(cwd, ["rev-parse", "--show-toplevel"]).stdout.trim();
}
export function branchExists(cwd: string, branch: string): boolean {
	requireGit(cwd, ["check-ref-format", "--branch", branch]);
	return git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).status === 0;
}
export function listWorktrees(cwd: string): readonly GitWorktree[] {
	const fields = requireGit(cwd, ["worktree", "list", "--porcelain", "-z"]).stdout.split("\0");
	const worktrees: GitWorktree[] = [];
	let path: string | undefined;
	let branch: string | undefined;
	let detached = false;
	const finish = () => {
		if (path) worktrees.push({ path, detached, ...(branch ? { branch } : {}) });
		path = undefined;
		branch = undefined;
		detached = false;
	};
	for (const field of fields) {
		if (field.startsWith("worktree ")) {
			finish();
			path = field.slice(9);
		} else if (field.startsWith("branch refs/heads/")) branch = field.slice(18);
		else if (field === "detached") detached = true;
	}
	finish();
	return worktrees;
}
export function worktreeForBranch(cwd: string, branch: string): GitWorktree | undefined {
	return listWorktrees(cwd).find((worktree) => worktree.branch === branch);
}
export function addNewWorktree(cwd: string, path: string, branch: string): void {
	requireGit(cwd, ["worktree", "add", "-b", branch, path, "HEAD"]);
}
export function addBranchWorktree(cwd: string, path: string, branch: string): void {
	requireGit(cwd, ["worktree", "add", path, branch]);
}
export function addDetachedWorktree(cwd: string, path: string, ref: string): void {
	requireGit(cwd, ["worktree", "add", "--detach", path, ref]);
}
export function liveDiffstat(cwd: string, branch: string): string {
	const result = git(cwd, ["diff", "--stat", `HEAD...${branch}`]);
	return result.status === 0 ? result.stdout.trim() : `(unavailable: ${result.stderr.trim() || "git diff failed"})`;
}
function requireGit(cwd: string, args: readonly string[]): GitResult {
	const result = git(cwd, args);
	if (result.status !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args[0]} failed`);
	return result;
}
function git(cwd: string, args: readonly string[]): GitResult {
	const result = spawnSync("git", args, { cwd: resolve(cwd), encoding: "utf8" });
	if (result.error) throw result.error;
	return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status ?? 1 };
}
