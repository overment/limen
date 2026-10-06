import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
export type GitWorktree = { readonly path: string; readonly branch?: string; readonly detached: boolean };
type GitResult = { readonly stdout: string; readonly stderr: string; readonly status: number };
export function repoRoot(cwd: string): string {
	const result = git(cwd, ["rev-parse", "--show-toplevel"]);
	if (result.status !== 0) {
		if (result.stderr.includes("not a git repository")) {
			throw new Error(
				`not inside a Limen project: ${cwd}; run this command from your project repository or Limen workspace.`,
			);
		}
		throw new Error(result.stderr.trim() || result.stdout.trim() || "git rev-parse failed");
	}
	return result.stdout.trim();
}
export function workspaceRoot(cwd: string): string | undefined {
	const root = resolve(cwd);
	return existsSync(`${root}/.agents/limen`) && !isGitRepository(root) ? root : undefined;
}
export function limenRoot(cwd: string): string {
	if (process.env.LIMEN_GROUP_ID) {
		const root = process.env.LIMEN_CONTEXT_ROOT;
		const id = process.env.LIMEN_GROUP_ID;
		if (!root || !/^[A-Za-z0-9-]+$/.test(id)) {
			throw new Error("group routing context is incomplete");
		}
		const run = JSON.parse(readFileSync(`${root}/.limen/groups/${id}/run.json`, "utf8")) as {
			root: string;
			members: { id: string; team: string }[];
		};
		if (
			run.root !== root ||
			!run.members.some((member) => member.id === process.env.LIMEN_JOB_ID && member.team === process.env.LIMEN_TEAM_ID)
		) {
			throw new Error("group identity does not match the canonical cabinet");
		}
		return root;
	}
	return workspaceRoot(cwd) ?? repoRoot(cwd);
}
export function isGitRepository(cwd: string): boolean {
	return git(cwd, ["rev-parse", "--show-toplevel"]).status === 0;
}
export function workspaceRepository(workspace: string, name: string): string {
	if (!name || basename(name) !== name || name === "." || name === "..") {
		throw new Error("--repo must name one immediate child repository");
	}
	const repository = resolve(workspace, name);
	if (repoRoot(repository) !== repository) {
		throw new Error(`--repo ${JSON.stringify(name)} must be a Git repository directly below the workspace`);
	}
	return repository;
}
export function branchExists(cwd: string, branch: string): boolean {
	requireGit(cwd, ["check-ref-format", "--branch", branch]);
	return git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).status === 0;
}
/**
 * Branches with commits not in HEAD by ancestry or patch-id (`git cherry` semantics), in four Git
 * processes per repository however many branches. Missing branches are absent: nothing to land.
 * Upstream patches are read from HEAD since the oldest unlanded commit; a cherry-pick is committed later.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: split pending: unlanded branch check
export function unlandedBranches(cwd: string, branches: Iterable<string>): ReadonlySet<string> {
	const wanted = new Set(branches);
	const tips = new Map<string, string[]>();
	for (const line of requireGit(cwd, ["for-each-ref", "--format=%(objectname) %(refname)", "refs/heads"]).stdout.split(
		"\n",
	)) {
		const [oid, ref] = [line.slice(0, line.indexOf(" ")), line.slice(line.indexOf(" ") + " refs/heads/".length)];
		if (wanted.has(ref)) {
			tips.set(oid, [...(tips.get(oid) ?? []), ref]);
		}
	}
	if (!tips.size) {
		return new Set();
	}
	const input = `${[...tips.keys()].join("\n")}\n`;
	const graph = new Map<string, { readonly parents: readonly string[]; readonly merge: boolean }>();
	let oldest = Number.POSITIVE_INFINITY;
	for (const line of requireGit(cwd, ["log", "--format=%H %ct %P", "--stdin"], `${input}^HEAD\n`).stdout.split("\n")) {
		const [oid, time, ...parents] = line.split(" ");
		if (!oid || !time) {
			continue;
		}
		graph.set(oid, { parents, merge: parents.length > 1 });
		oldest = Math.min(oldest, Number(time));
	}
	if (!graph.size) {
		return new Set();
	}
	const oneDay = 86_400; // seconds of slack before the oldest unlanded commit
	const patches = requireGit(
		cwd,
		[
			"log",
			"-p",
			"--no-merges",
			"--no-color",
			"--no-ext-diff",
			"--format=commit %H",
			`--since=${oldest - oneDay}`,
			"--stdin",
		],
		`${input}HEAD\n`,
	).stdout;
	const seen = new Set(patches.match(/^commit [0-9a-f]+$/gm)?.map((line) => line.slice("commit ".length)));
	const patchIds = new Map<string, string>();
	for (const line of requireGit(cwd, ["patch-id", "--stable"], patches).stdout.split("\n")) {
		const [patch, oid] = line.split(" ");
		if (patch && oid) {
			patchIds.set(oid, patch);
		}
	}
	const upstream = new Set([...patchIds].filter(([oid]) => !graph.has(oid)).map(([, patch]) => patch));
	const unlanded = new Set<string>();
	for (const [tip, refs] of tips) {
		const stack = [tip];
		const visited = new Set<string>();
		let landed = true;
		while (landed && stack.length) {
			const oid = stack.pop() as string;
			const commit = graph.get(oid);
			if (!commit || visited.has(oid)) {
				continue;
			}
			visited.add(oid);
			stack.push(...commit.parents);
			if (commit.merge) {
				continue;
			}
			// Unseen means the dated walk missed it: stay unlanded. Seen without a patch id is an empty commit.
			const patch = patchIds.get(oid);
			if (!seen.has(oid) || (patch !== undefined && !upstream.has(patch))) {
				landed = false;
			}
		}
		if (!landed) {
			for (const ref of refs) {
				unlanded.add(ref);
			}
		}
	}
	return unlanded;
}
export function branchCommit(cwd: string, branch: string): string {
	return requireGit(cwd, ["rev-parse", `refs/heads/${branch}`]).stdout.trim();
}
export function commitHasFile(cwd: string, commit: string, path: string): boolean {
	return git(cwd, ["cat-file", "-t", `${commit}:${path}`]).stdout.trim() === "blob";
}
export function listWorktrees(cwd: string): readonly GitWorktree[] {
	const fields = requireGit(cwd, ["worktree", "list", "--porcelain", "-z"]).stdout.split("\0");
	const worktrees: GitWorktree[] = [];
	let path: string | undefined;
	let branch: string | undefined;
	let detached = false;
	const finish = () => {
		if (path) {
			worktrees.push({ path, detached, ...(branch ? { branch } : {}) });
		}
		path = undefined;
		branch = undefined;
		detached = false;
	};
	for (const field of fields) {
		if (field.startsWith("worktree ")) {
			finish();
			path = field.slice("worktree ".length);
		} else if (field.startsWith("branch refs/heads/")) {
			branch = field.slice("branch refs/heads/".length);
		} else if (field === "detached") {
			detached = true;
		}
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
export function removeWorktree(cwd: string, path: string): void {
	requireGit(cwd, ["worktree", "remove", "--force", path]);
}
export function pruneWorktrees(cwd: string): void {
	requireGit(cwd, ["worktree", "prune"]);
}
export function headCommit(cwd: string): string {
	return requireGit(cwd, ["rev-parse", "HEAD"]).stdout.trim();
}
/** A full commit SHA for `ref`: a full SHA as given, or a short SHA, branch, tag or other revision that Git resolves. */
export function resolveCommit(cwd: string, ref: string, option: string): string {
	if (/^[0-9a-f]{40}$/.test(ref)) {
		return ref;
	}
	const result = ref.startsWith("-") ? undefined : git(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
	if (result?.status !== 0) {
		throw new Error(`${option} ${JSON.stringify(ref)} names no commit in ${cwd}`);
	}
	return result.stdout.trim();
}
export const NO_COMMIT = "this repository has no commit yet; commit once, then spawn.";
export function hasCommit(cwd: string): boolean {
	return git(cwd, ["rev-parse", "--verify", "HEAD"]).status === 0;
}
export function spawnBaseCommit(cwd: string): string {
	const result = git(cwd, ["rev-parse", "--verify", "HEAD"]);
	if (result.status === 0) {
		return result.stdout.trim();
	}
	const branch = git(cwd, ["symbolic-ref", "--quiet", "HEAD"]);
	if (branch.status === 0 && git(cwd, ["show-ref", "--verify", "--quiet", branch.stdout.trim()]).status === 1) {
		throw new Error(NO_COMMIT);
	}
	throw new Error(result.stderr.trim() || result.stdout.trim() || "git rev-parse failed");
}
export function currentBranch(cwd: string): string {
	return requireGit(cwd, ["symbolic-ref", "--short", "HEAD"]).stdout.trim();
}
export function mergeBranch(cwd: string, branch: string): string {
	requireGit(cwd, ["check-ref-format", "--branch", branch]);
	return requireGit(cwd, ["merge", "--no-edit", branch]).stdout.trimEnd();
}
/** Abort a merge that stopped half way; with no merge in progress it does nothing. */
export function abortMerge(cwd: string): void {
	git(cwd, ["merge", "--abort"]);
}
/** Uncommitted paths, untracked files included; `staged` lists the paths whose change is already in the index. */
export function dirtyPaths(cwd: string): { readonly paths: readonly string[]; readonly staged: readonly string[] } {
	const fields = requireGit(cwd, [
		"--no-optional-locks",
		"status",
		"--porcelain",
		"-z",
		"--untracked-files=all",
	]).stdout.split("\0");
	const paths: string[] = [];
	const staged: string[] = [];
	for (let index = 0; index < fields.length; index++) {
		const field = fields[index] ?? "";
		if (field.length < 4) {
			continue;
		}
		paths.push(field.slice(3));
		if (field[0] !== " " && field[0] !== "?") {
			staged.push(field.slice(3));
		}
		// A rename or copy names its source path in the next field.
		if ((field[0] === "R" || field[0] === "C") && fields[index + 1]) {
			paths.push(fields[++index] ?? "");
		}
	}
	return { paths, staged };
}
/** Paths that merging `branch` into HEAD changes: every path the branch changed since their merge base. */
export function mergePaths(cwd: string, branch: string): ReadonlySet<string> {
	return new Set(
		requireGit(cwd, ["diff", "--name-only", "-z", "--no-renames", `HEAD...${branch}`])
			.stdout.split("\0")
			.filter(Boolean),
	);
}
export function commitList(cwd: string, base: string, branch: string): string | undefined {
	const result = git(cwd, ["log", "--oneline", `${base}..${branch}`]);
	return result.status === 0 ? result.stdout.trimEnd() : undefined;
}
export function cleanWorktree(cwd: string): boolean {
	if (!existsSync(cwd)) {
		return false;
	}
	const result = git(cwd, ["--no-optional-locks", "status", "--porcelain"]);
	return result.status === 0 && result.stdout.trim() === "";
}
export function liveDiffstat(cwd: string, branch: string): string {
	const result = git(cwd, ["diff", "--stat", `HEAD...${branch}`]);
	return result.status === 0 ? result.stdout.trim() : `(unavailable: ${result.stderr.trim() || "git diff failed"})`;
}
export function ticketAuthor(
	cwd: string,
	ticket: string,
): { path: string; commit: string; name: string; email: string } {
	const root = repoRoot(cwd);
	const absolute = resolve(realpathSync(cwd), ticket);
	// Git reports the physical root (e.g. /private/var on macOS). Resolve directory
	// aliases too, but leave the filename literal so tracked symlinks keep their identity.
	const parent = dirname(absolute);
	const path = relative(root, resolve(existsSync(parent) ? realpathSync(parent) : parent, basename(absolute)));
	if (!path || path === ".." || path.startsWith("../")) {
		throw new Error("ticket path must be a file inside this repository");
	}
	if (git(root, ["cat-file", "-t", `HEAD:${path}`]).stdout.trim() !== "blob") {
		throw new Error(`ticket author unavailable: ${path} is not a committed file at HEAD`);
	}
	if (requireGit(root, ["rev-parse", "--is-shallow-repository"]).stdout.trim() === "true") {
		throw new Error("ticket author unavailable: shallow history; fetch complete history first");
	}
	// A copy files a new ticket; follow renames, but stop at copies.
	const [commit, name, email] = requireGit(root, [
		"log",
		"--follow",
		"--diff-filter=AC",
		"-1",
		"--format=%H%x00%an%x00%ae",
		"HEAD",
		"--",
		`:(literal)${path}`,
	])
		.stdout.trimEnd()
		.split("\0");
	if (!commit || !name || !email) {
		throw new Error(`ticket author unavailable: no creation author found for ${path}`);
	}
	return { path, commit, name, email };
}
function requireGit(cwd: string, args: readonly string[], input?: string): GitResult {
	const result = git(cwd, args, input);
	if (result.status !== 0) {
		throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args[0]} failed`);
	}
	return result;
}
let gitBin = "";
function git(cwd: string, args: readonly string[], input?: string): GitResult {
	const run = (bin: string) =>
		spawnSync(bin, args, {
			cwd: resolve(cwd),
			encoding: "utf8",
			maxBuffer: Number.POSITIVE_INFINITY,
			...(input === undefined ? {} : { input }),
		});
	const miss = (error: Error | undefined) => !!error && "code" in error && error.code === "ENOENT";
	let result = run(gitBin || "git");
	// ENOENT: try the same binary once more before the absolute-path fallback below.
	if (miss(result.error)) {
		result = run(gitBin || "git");
	}
	if (miss(result.error) && !gitBin) {
		const fallback = ["/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"].find((path) => existsSync(path));
		if (fallback) {
			gitBin = fallback;
			result = run(fallback);
		}
	} else if (!gitBin && !result.error) {
		gitBin = "git";
	}
	if (result.error) {
		throw miss(result.error) ? new Error("git is not on PATH") : result.error;
	}
	return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status ?? 1 };
}
