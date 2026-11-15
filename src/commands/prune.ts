import { randomUUID } from "node:crypto";
import { readdir, readFile, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { retainedGroupJob } from "../job/group-cabinet.ts";
import { isTerminal } from "../job/job.ts";
import { worktreeLock } from "../job/publication.ts";
import { appendLimenLog } from "../job/record.ts";
import {
	branchExists,
	deleteBranch,
	type GitWorktree,
	limenRoot,
	listWorktrees,
	pruneWorktrees,
	unlandedBranches,
	workspaceRepository,
	worktreeState,
} from "../project/git.ts";
import { STARTUP_GRACE_MS, startingJob } from "../runtime/reap.ts";

export async function pruneCommand(args: readonly string[], cwd: string): Promise<void> {
	const retire = args.includes("--retire"),
		dryRun = args.includes("--dry-run");
	if (args.some((value) => value !== "--retire" && value !== "--dry-run")) {
		throw new Error("prune accepts no arguments, --retire, or --retire --dry-run");
	}
	if (dryRun && !retire) {
		throw new Error("prune --dry-run requires --retire");
	}
	if (!retire) {
		const { removals, kept } = await pruneFinishedWorktrees(limenRoot(cwd));
		for (const removal of removals) {
			console.log(pruneLine(removal));
		}
		for (const keep of kept) {
			console.log(keptLine(keep));
		}
		console.log(
			removals.length === 0
				? "no finished worktrees"
				: `pruned ${removals.length} finished worktree${removals.length === 1 ? "" : "s"}`,
		);
		return;
	}
	const { ids, branches } = await retireFinishedJobs(limenRoot(cwd), dryRun);
	if (dryRun && ids.length) {
		console.log(ids.map((id) => `would retire ${id}`).join("\n"));
	} else {
		console.log(
			ids.length === 0 ? "no finished jobs to retire" : `retired ${ids.length} job${ids.length === 1 ? "" : "s"}`,
		);
	}
	if (branches) {
		console.log(`deleted ${branches} landed branch${branches === 1 ? "" : "es"}`);
	}
}

async function retireFinishedJobs(
	root: string,
	dryRun: boolean,
): Promise<{ readonly ids: readonly string[]; readonly branches: number }> {
	const jobsRoot = `${root}/.limen/jobs`,
		retired: { id: string; repository: string; branch: string }[] = [],
		finished: { id: string; repository: string; branch: string }[] = [],
		repositories = new Map<string, string>();
	for (const id of (await jobIds(jobsRoot)).sort()) {
		const jobDir = `${jobsRoot}/${id}`;
		if (await retainedGroupJob(jobDir)) {
			continue;
		}
		const [state, branch, repo] = await Promise.all([
			text(`${jobDir}/state`),
			text(`${jobDir}/branch`),
			text(`${jobDir}/repo`),
		]);
		if (!isTerminal(state)) {
			continue;
		}
		try {
			const repository = !branch ? root : (repositories.get(repo) ?? (repo ? workspaceRepository(root, repo) : root));
			if (branch) {
				repositories.set(repo, repository);
			}
			finished.push({ id, repository, branch });
		} catch {}
	}
	const unlanded = new Map<string, ReadonlySet<string> | undefined>();
	for (const repository of new Set(finished.map((job) => job.repository))) {
		try {
			unlanded.set(
				repository,
				unlandedBranches(
					repository,
					finished.filter((job) => job.repository === repository && job.branch).map((job) => job.branch),
				),
			);
		} catch {
			unlanded.set(repository, undefined);
		}
	}
	for (const job of finished) {
		const pending = unlanded.get(job.repository);
		if (pending && !pending.has(job.branch)) {
			retired.push(job);
		}
	}
	if (dryRun) {
		return { ids: retired.map((job) => job.id), branches: 0 };
	}
	// Branches go before records: a record names the finished worktree that may still hold its branch.
	const landed = new Map(retired.filter((job) => job.branch).map((job) => [`${job.repository}\0${job.branch}`, job]));
	const deleted = (await deleteLandedBranches(root, [...landed.values()])).filter((result) => !result.kept).length;
	for (const { id } of retired) {
		await rm(`${jobsRoot}/${id}`, { recursive: true, force: true });
	}
	return { ids: retired.map((job) => job.id), branches: deleted };
}

/** One path that prune removed or kept: the job that recorded it, when one did, and why. */
export type PruneRemoval = { readonly path: string; readonly jobDir: string | undefined; readonly reason: string };
/** Why prune removes a worktree some job recorded; a job that keeps it never gets here. */
type PruneOwners = Map<string, { readonly jobDir: string; readonly reason: string }>;
type PruneResult = { readonly removals: PruneRemoval[]; readonly kept: PruneRemoval[] };
export function pruneLine(removal: PruneRemoval): string {
	return `pruned ${removal.path} (job ${removal.jobDir ? basename(removal.jobDir) : "none"}): ${removal.reason}`;
}
function keptLine(keep: PruneRemoval): string {
	return `kept ${keep.path} (job ${keep.jobDir ? basename(keep.jobDir) : "none"}): ${keep.reason}`;
}
/** Prunes, writes each line to this job's log and to the log of the job whose worktree went or stayed; returns the count removed. */
export async function pruneForJob(jobDir: string, root: string, keep: readonly string[]): Promise<number> {
	const { removals, kept } = await pruneFinishedWorktrees(root, keep);
	for (const [entry, line] of [
		...removals.map((removal) => [removal, pruneLine(removal)] as const),
		...kept.map((entry) => [entry, keptLine(entry)] as const),
	]) {
		await appendLimenLog(jobDir, line);
		if (entry.jobDir && entry.jobDir !== jobDir) {
			await appendLimenLog(entry.jobDir, line).catch(() => {});
		}
	}
	return removals.length;
}
export async function pruneFinishedWorktrees(root: string, keep: readonly string[] = []): Promise<PruneResult> {
	const jobsRoot = `${root}/.limen/jobs`;
	const keepPaths = new Set<string>();
	for (const path of keep) {
		keepPaths.add(await resolved(path));
	}
	const { repositories, removals, owners } = await removeUnstartedRecords(root, jobsRoot);
	const kept: PruneRemoval[] = [];
	for (const repository of repositories) {
		const result = await pruneRepositoryWorktrees(repository, jobsRoot, keepPaths, owners);
		removals.push(...result.removals);
		kept.push(...result.kept);
	}
	return { removals, kept };
}
/**
 * The one rule every removal obeys: a job keeps its record and its worktree while it is starting, running, or in an
 * open group. Starting is a record with no state whose spawner lives or whose startup grace runs. Prune does not ask
 * whether a running job's process lives; the sweep finalizes a dead job first.
 */
async function jobKeeps(jobDir: string, state: string): Promise<boolean> {
	if (state) {
		return !isTerminal(state) || retainedGroupJob(jobDir);
	}
	const startedAt = Date.parse(await text(`${jobDir}/started-at`));
	if ((Number.isFinite(startedAt) && Date.now() - startedAt < STARTUP_GRACE_MS) || (await startingJob(jobDir))) {
		return true;
	}
	return retainedGroupJob(jobDir);
}
type LandedBranch = { readonly repository: string; readonly branch: string };
type BranchUse = { busy?: string; worktrees: Set<string> };
/**
 * Deletes each landed `limen/*` branch and the finished worktree that holds it, since Git keeps a checked-out branch.
 * The caller has proven every branch landed. A branch stays while a job that names it keeps it, or while a checkout no
 * job recorded holds it. Decides under the worktree lock, as prune does. Returns why each kept branch stays.
 */
export async function deleteLandedBranches(
	root: string,
	landed: readonly LandedBranch[],
): Promise<{ readonly branch: string; readonly kept?: string }[]> {
	const jobsRoot = `${root}/.limen/jobs`;
	const trashRoots = new Set<string>();
	const results = await worktreeLock(jobsRoot, async () => {
		const uses = await branchUses(jobsRoot);
		const checkouts = new Map<string, readonly GitWorktree[]>();
		const decided: { branch: string; kept?: string }[] = [];
		for (const target of landed) {
			decided.push(await deleteLandedBranch(target, uses.get(target.branch), checkouts, trashRoots));
		}
		return decided;
	});
	for (const trashRoot of trashRoots) {
		await emptyTrash(trashRoot);
	}
	return results;
}
/** Deletes one landed branch and moves the finished worktree that holds it out of reach, or says why it stays. */
async function deleteLandedBranch(
	{ repository, branch }: LandedBranch,
	use: BranchUse | undefined,
	checkouts: Map<string, readonly GitWorktree[]>,
	trashRoots: Set<string>,
): Promise<{ branch: string; kept?: string }> {
	if (!branch.startsWith("limen/") || use?.busy || !branchExists(repository, branch)) {
		return { branch, kept: use?.busy ? `job ${use.busy} still uses it` : "not a present limen/ branch" };
	}
	if (!checkouts.has(repository)) {
		pruneWorktrees(repository);
		checkouts.set(repository, listWorktrees(repository));
	}
	const holder = checkouts.get(repository)?.find((worktree) => worktree.branch === branch);
	const path = holder ? await resolved(holder.path) : undefined;
	if (holder?.locked || (path && !use?.worktrees.has(path))) {
		return { branch, kept: `it is checked out at ${path}${holder?.locked ? ", which is locked" : ""}` };
	}
	if (path && worktreeState(path) === "dirty") {
		return { branch, kept: `its worktree ${path} has uncommitted changes` };
	}
	try {
		if (path) {
			trashRoots.add(dirname(path));
			await detach(path);
			pruneWorktrees(repository);
		}
		deleteBranch(repository, branch);
		return { branch };
	} catch (error) {
		return { branch, kept: error instanceof Error ? error.message.trim() : String(error) };
	}
}
/** For each recorded branch: a job that keeps it, and the worktrees its other jobs left. */
async function branchUses(jobsRoot: string): Promise<Map<string, BranchUse>> {
	const uses = new Map<string, BranchUse>();
	for (const id of await jobIds(jobsRoot)) {
		const jobDir = `${jobsRoot}/${id}`;
		const [branch, state, worktree] = await Promise.all([
			text(`${jobDir}/branch`),
			text(`${jobDir}/state`),
			text(`${jobDir}/worktree`),
		]);
		if (!branch) {
			continue;
		}
		const use = uses.get(branch) ?? { worktrees: new Set<string>() };
		uses.set(branch, use);
		if (await jobKeeps(jobDir, state)) {
			use.busy ??= id;
		} else if (worktree) {
			use.worktrees.add(await resolved(worktree));
		}
	}
	return uses;
}
/**
 * Removes each record that never got a state and no longer starts, and says why the worktree it named goes. Names the
 * repositories whose worktrees the prune visits: those of jobs with a state, else the root.
 */
async function removeUnstartedRecords(
	root: string,
	jobsRoot: string,
): Promise<{ repositories: Set<string>; removals: PruneRemoval[]; owners: PruneOwners }> {
	const repositories = new Set<string>();
	const removals: PruneRemoval[] = [];
	const owners: PruneOwners = new Map();
	for (const id of await jobIds(jobsRoot)) {
		const jobDir = `${jobsRoot}/${id}`;
		const state = await text(`${jobDir}/state`);
		if (state) {
			const repo = await text(`${jobDir}/repo`);
			repositories.add(repo ? workspaceRepository(root, repo) : root);
			continue;
		}
		if (await jobKeeps(jobDir, state)) {
			continue;
		}
		const tree = await text(`${jobDir}/worktree`);
		if (tree) {
			owners.set(await resolved(tree), { jobDir, reason: "its record never got a state and was removed" });
		}
		await rm(jobDir, { recursive: true, force: true });
		removals.push({ path: jobDir, jobDir, reason: "record never got a state and its spawner is gone" });
	}
	if (repositories.size === 0) {
		repositories.add(root);
	}
	return { repositories, removals, owners };
}
/**
 * Removes the worktrees and leftover folders in the repository's Limen worktree root that no job keeps. It lists them
 * first and reads the job records second, under the worktree lock: a job publishes its record before Git makes its
 * worktree, and a job that reuses a worktree publishes under the same lock. A removal is one rename out of reach there;
 * the slow delete runs after the lock.
 */
async function pruneRepositoryWorktrees(
	repository: string,
	jobsRoot: string,
	keepPaths: ReadonlySet<string>,
	removedOwners: PruneOwners,
): Promise<PruneResult> {
	const worktreeRoot = await resolved(`${dirname(repository)}/.${basename(repository)}-limen-worktrees`);
	const candidates = await removalCandidates(repository, worktreeRoot);
	const result = await worktreeLock(jobsRoot, async () => {
		const { kept, owners } = await worktreeClaims(jobsRoot, keepPaths);
		const detached: PruneRemoval[] = [];
		const dirty: PruneRemoval[] = [];
		for (const [path, registered] of candidates) {
			// A worktree a kept job made inside its own worktree stays with it.
			if ([...kept].some((keptPath) => path === keptPath || path.startsWith(`${keptPath}/`))) {
				continue;
			}
			const owner = owners.get(path) ?? removedOwners.get(path);
			// Uncommitted work outlives its job: a person or the next job may still recover it.
			if (registered && worktreeState(path) === "dirty") {
				kept.add(path);
				dirty.push({ path, jobDir: owner?.jobDir, reason: "it has uncommitted changes; commit or discard them" });
				continue;
			}
			if (!(await detach(path))) {
				continue;
			}
			const reason = registered ? "no job records this worktree" : "directory is not a registered Git worktree";
			detached.push({ path, jobDir: owner?.jobDir, reason: owner?.reason ?? reason });
		}
		// Git forgets the moved worktrees before a job can claim their paths again.
		pruneWorktrees(repository);
		return { removals: detached, kept: dirty };
	});
	await emptyTrash(worktreeRoot);
	return result;
}
/**
 * Every path prune may remove, parents first, and whether Git registers it: unlocked worktrees under the root, then the
 * root's other folders. Dot entries belong to Limen: nested worktree roots of other checkouts, and removals in progress.
 */
async function removalCandidates(repository: string, worktreeRoot: string): Promise<Map<string, boolean>> {
	const candidates = new Map<string, boolean>();
	const registered = new Set<string>();
	const primary = await resolved(repository);
	for (const worktree of listWorktrees(repository)) {
		const path = await resolved(worktree.path);
		registered.add(path);
		const inRoot = path.startsWith(`${worktreeRoot}/`) && !path.slice(worktreeRoot.length + 1).startsWith(".");
		if (path !== primary && inRoot && !worktree.locked) {
			candidates.set(path, true);
		}
	}
	for (const name of await readdir(worktreeRoot).catch(() => [])) {
		const path = await resolved(resolve(worktreeRoot, name));
		if (!(name.startsWith(".") || registered.has(path))) {
			candidates.set(path, false);
		}
	}
	return new Map([...candidates].sort(([left], [right]) => left.length - right.length));
}
/** The worktrees jobs keep, with `keepPaths`; for each other recorded worktree, the latest record and why it goes. */
async function worktreeClaims(
	jobsRoot: string,
	keepPaths: ReadonlySet<string>,
): Promise<{ kept: Set<string>; owners: PruneOwners }> {
	const kept = new Set(keepPaths);
	const owners: PruneOwners = new Map();
	for (const id of (await jobIds(jobsRoot)).sort()) {
		const jobDir = `${jobsRoot}/${id}`;
		const recorded = await text(`${jobDir}/worktree`);
		if (!recorded) {
			continue;
		}
		const path = await resolved(recorded);
		const state = await text(`${jobDir}/state`);
		if (await jobKeeps(jobDir, state)) {
			kept.add(path);
		} else {
			owners.set(path, { jobDir, reason: `job ${state || "has no state"}` });
		}
	}
	return { kept, owners };
}
/** Moves a worktree out of every job's reach in one rename beside it; false when it is gone already. */
function detach(path: string): Promise<boolean> {
	return rename(path, `${dirname(path)}/.pruned-${randomUUID()}`).then(
		() => true,
		() => false,
	);
}
/** Deletes every moved worktree in the folder: this prune's, and any an earlier prune could not finish. */
async function emptyTrash(folder: string): Promise<void> {
	for (const name of await readdir(folder).catch(() => [])) {
		if (name.startsWith(".pruned-")) {
			// A process that still writes there can fail the delete; the next prune tries again.
			await rm(`${folder}/${name}`, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
		}
	}
}

async function jobIds(jobsRoot: string): Promise<string[]> {
	const entries = await readdir(jobsRoot, { withFileTypes: true }).catch((error: unknown) => {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
			return [];
		}
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
