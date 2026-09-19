import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { liveJob } from "../src/reap.ts";
import { git, limen, onlyJobId, scratchRepo, scratchWorkspace, waitForState, writeFakePi } from "./scratch.ts";

const completingPi = `#!/usr/bin/env node
console.log("done");
`;
const livePi = `#!/usr/bin/env node
setInterval(() => {}, 1000);
`;

test("prune and spawn keep a live reviewer's detached worktree", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const worker = onlyJobId(limen(scratch, "spawn", "make commit").stdout);
	await waitForState(scratch.root, worker, "done");
	const branch = `limen/${worker}`;
	await writeFakePi(scratch.fakeBin, livePi);
	let review = "";
	context.after(() => {
		if (review) limen(scratch, "stop", review);
	});
	const launched = limen(scratch, "spawn", "--review", "--branch", branch, "inspect candidate");
	assert.equal(launched.status, 0, launched.stderr);
	review = onlyJobId(launched.stdout);
	const reviewPath = (await readFile(join(scratch.root, ".limen/jobs", review, "worktree"), "utf8")).trim();
	await access(reviewPath);
	const pruned = limen(scratch, "prune");
	assert.equal(pruned.status, 0, pruned.stderr);
	await access(reviewPath);
	assert.match(git(scratch.root, "worktree", "list", "--porcelain"), new RegExp(review));
	await writeFakePi(scratch.fakeBin, completingPi);
	const other = limen(scratch, "spawn", "other work");
	assert.equal(other.status, 0, other.stderr);
	await waitForState(scratch.root, onlyJobId(other.stdout), "done");
	await access(reviewPath);
	assert.match(git(scratch.root, "worktree", "list", "--porcelain"), new RegExp(review));
	assert.equal(limen(scratch, "stop", review).status, 0);
	const reviewId = review;
	review = "";
	const after = limen(scratch, "prune");
	assert.equal(after.status, 0, after.stderr);
	await assert.rejects(access(reviewPath));
	assert.doesNotMatch(git(scratch.root, "worktree", "list", "--porcelain"), new RegExp(reviewId));
});

test("leftover sweep leaves a worktree git still has registered", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const id = onlyJobId(limen(scratch, "spawn", "make commit").stdout);
	await waitForState(scratch.root, id, "done");
	const worktree = (await readFile(join(scratch.root, ".limen/jobs", id, "worktree"), "utf8")).trim();
	git(scratch.root, "worktree", "lock", worktree);
	const pruned = limen(scratch, "prune");
	assert.equal(pruned.status, 0, pruned.stderr);
	await access(worktree);
	assert.match(git(scratch.root, "worktree", "list", "--porcelain"), new RegExp(id));
});

for (const command of ["prune", "spawn"] as const) {
	test(`${command} keeps nested running jobs owned by another checkout`, async (context) => {
		const scratch = await scratchRepo();
		context.after(scratch.cleanup);
		assert.equal(limen(scratch, "init").status, 0);
		const worktreeRoot = join(dirname(scratch.root), `.${basename(scratch.root)}-limen-worktrees`);
		const outer = join(worktreeRoot, "outer");
		const nestedRoot = join(worktreeRoot, ".outer-limen-worktrees");
		const child = join(nestedRoot, "child");
		git(scratch.root, "worktree", "add", "--detach", outer, "HEAD");
		git(outer, "worktree", "add", "--detach", child, "HEAD");
		for (const [owner, id, worktree] of [
			[scratch.root, "outer", outer],
			[outer, "child", child],
		] as const) {
			const job = join(owner, ".limen/jobs", id);
			await mkdir(job, { recursive: true });
			await writeFile(join(job, "state"), "running\n");
			await writeFile(join(job, "worktree"), `${worktree}\n`);
			await writeFile(join(job, "started-at"), `${new Date().toISOString()}\n`);
			assert.equal(await liveJob(job), true);
		}
		await writeFile(join(child, "in-progress.txt"), "nested work must survive\n");
		const finished = join(worktreeRoot, "finished");
		git(scratch.root, "worktree", "add", "--detach", finished, "HEAD");
		const leftover = join(worktreeRoot, "ordinary-leftover");
		await mkdir(leftover);
		await writeFile(join(leftover, "stale.txt"), "remove me\n");

		const result = command === "prune" ? limen(scratch, "prune") : limen(scratch, "spawn", "plant sibling");
		assert.equal(result.status, 0, result.stderr);
		if (command === "spawn") await waitForState(scratch.root, onlyJobId(result.stdout), "done");
		assert.equal(await readFile(join(child, "in-progress.txt"), "utf8"), "nested work must survive\n");
		assert.ok(git(scratch.root, "worktree", "list", "--porcelain").includes(`worktree ${child}\n`));
		assert.equal(await liveJob(join(outer, ".limen/jobs/child")), true);
		await assert.rejects(access(finished));
		await assert.rejects(access(leftover));

		const owner = { ...scratch, root: outer };
		const livePrune = limen(owner, "prune");
		assert.equal(livePrune.status, 0, livePrune.stderr);
		await access(join(child, "in-progress.txt"));
		await writeFile(join(outer, ".limen/jobs/child/state"), "done\n");
		const finishedPrune = limen(owner, "prune");
		assert.equal(finishedPrune.status, 0, finishedPrune.stderr);
		await assert.rejects(access(child));
		assert.ok(!git(scratch.root, "worktree", "list", "--porcelain").includes(`worktree ${child}\n`));
	});
}

test("leftover sweep keeps a nested container with a locked registered child", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const worktreeRoot = join(dirname(scratch.root), `.${basename(scratch.root)}-limen-worktrees`);
	const child = join(worktreeRoot, ".outer-limen-worktrees", "child");
	git(scratch.root, "worktree", "add", "--detach", child, "HEAD");
	git(scratch.root, "worktree", "lock", child);
	await writeFile(join(child, "in-progress.txt"), "registered nested work\n");
	const result = limen(scratch, "prune");
	assert.equal(result.status, 0, result.stderr);
	assert.equal(await readFile(join(child, "in-progress.txt"), "utf8"), "registered nested work\n");
	assert.ok(git(scratch.root, "worktree", "list", "--porcelain").includes(`worktree ${child}\n`));
});

test("startup window is live; expired running-without-pid is not", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const id = "2026-08-19-grace-young-aaaaaaaa";
	const worktreeRoot = join(dirname(scratch.root), `.${basename(scratch.root)}-limen-worktrees`);
	await mkdir(worktreeRoot, { recursive: true });
	const worktree = join(worktreeRoot, id);
	git(scratch.root, "branch", "limen/occupied");
	git(scratch.root, "worktree", "add", "--detach", worktree, "limen/occupied");
	const job = join(scratch.root, ".limen/jobs", id);
	await mkdir(job, { recursive: true });
	await writeFile(join(job, "state"), "running\n");
	await writeFile(join(job, "label"), "grace young\n");
	await writeFile(join(job, "branch"), "limen/occupied\n");
	await writeFile(join(job, "worktree"), `${worktree}\n`);
	await writeFile(join(job, "started-at"), `${new Date(Date.now() - 60_000).toISOString()}\n`);
	await writeFile(join(job, "task.md"), "soon\n");
	await writeFile(join(job, "log"), "");
	assert.equal(await liveJob(job), true);
	assert.equal(limen(scratch, "prune").status, 0);
	await access(worktree);
	const refused = limen(scratch, "spawn", "--branch", "limen/occupied", "continue");
	assert.equal(refused.status, 1, refused.stdout);
	assert.match(refused.stderr, /already has a live job/);
	await writeFile(join(job, "started-at"), `${new Date(Date.now() - 60 * 60_000).toISOString()}\n`);
	assert.equal(await liveJob(job), false);
	assert.equal(limen(scratch, "prune").status, 0);
	await assert.rejects(access(worktree));
	const allowed = limen(scratch, "spawn", "--branch", "limen/occupied", "continue");
	assert.equal(allowed.status, 0, allowed.stderr);
	await waitForState(scratch.root, onlyJobId(allowed.stdout), "done");
});

test("prune deletes a job directory with no state", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const job = join(scratch.root, ".limen/jobs/half-written");
	await mkdir(job);
	await writeFile(join(job, "task.md"), "half\n");
	const pruned = limen(scratch, "prune");
	assert.equal(pruned.status, 0, pruned.stderr);
	assert.match(pruned.stdout, /pruned /);
	await assert.rejects(access(job));
});

test("prune --retire removes merged and dropped finished jobs, keeps running and unmerged", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	git(scratch.root, "add", ".");
	git(scratch.root, "commit", "-m", "init");
	git(scratch.root, "checkout", "-b", "limen/bbbb-unmerged");
	await writeFile(join(scratch.root, "unmerged.txt"), "keep\n");
	git(scratch.root, "add", "unmerged.txt");
	git(scratch.root, "commit", "-m", "unmerged");
	git(scratch.root, "checkout", "main");
	git(scratch.root, "checkout", "-b", "limen/cccc-merged");
	await writeFile(join(scratch.root, "merged.txt"), "landed\n");
	git(scratch.root, "add", "merged.txt");
	git(scratch.root, "commit", "-m", "merged");
	git(scratch.root, "checkout", "main");
	git(scratch.root, "merge", "--no-edit", "limen/cccc-merged");
	const jobs = join(scratch.root, ".limen/jobs");
	await recordJob(jobs, "aaaa-running", { state: "running", label: "running", branch: "limen/gone", "started-at": new Date().toISOString() });
	await recordJob(jobs, "bbbb-unmerged", { state: "done", label: "unmerged", branch: "limen/bbbb-unmerged" });
	await recordJob(jobs, "cccc-merged", { state: "done", label: "merged", branch: "limen/cccc-merged" });
	await recordJob(jobs, "dddd-dropped", { state: "failed", label: "dropped", branch: "limen/dddd-dropped" });
	await recordJob(jobs, "eeee-stopped", { state: "stopped", label: "stopped", branch: "limen/eeee-stopped" });
	const dry = limen(scratch, "prune", "--retire", "--dry-run");
	assert.equal(dry.status, 0, dry.stderr);
	assert.equal(dry.stdout.trim(), "would retire cccc-merged\nwould retire dddd-dropped\nwould retire eeee-stopped");
	await access(join(jobs, "cccc-merged"));
	await access(join(jobs, "dddd-dropped"));
	await access(join(jobs, "eeee-stopped"));
	const retired = limen(scratch, "prune", "--retire");
	assert.equal(retired.status, 0, retired.stderr);
	assert.equal(retired.stdout.trim(), "retired 3 jobs");
	await access(join(jobs, "aaaa-running"));
	await access(join(jobs, "bbbb-unmerged"));
	await assert.rejects(access(join(jobs, "cccc-merged")));
	await assert.rejects(access(join(jobs, "dddd-dropped")));
	await assert.rejects(access(join(jobs, "eeee-stopped")));
	const listed = limen(scratch, "jobs", "--all");
	assert.equal(listed.status, 0, listed.stderr);
	assert.match(listed.stdout, /RUNNING running/);
	assert.match(listed.stdout, /DONE unmerged/);
	assert.doesNotMatch(listed.stdout, /cccc-merged|dddd-dropped|eeee-stopped/);
	assert.equal(limen(scratch, "jobs", "bbbb-unmerged").status, 0);
	assert.equal(limen(scratch, "jobs", "aaaa-running").status, 0);
});

test("prune --retire never retires a running job whose branch is gone", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const jobs = join(scratch.root, ".limen/jobs");
	await recordJob(jobs, "stale-running", {
		state: "running",
		label: "stale",
		branch: "limen/missing",
		"started-at": new Date(Date.now() - 60 * 60_000).toISOString(),
	});
	const retired = limen(scratch, "prune", "--retire");
	assert.equal(retired.status, 0, retired.stderr);
	assert.match(retired.stdout, /no finished jobs to retire/);
	await access(join(jobs, "stale-running"));
});

test("prune and spawn leave finished records whose branches are merged", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	git(scratch.root, "add", ".");
	git(scratch.root, "commit", "-m", "init");
	git(scratch.root, "checkout", "-b", "limen/keep-record");
	await writeFile(join(scratch.root, "landed.txt"), "x\n");
	git(scratch.root, "add", "landed.txt");
	git(scratch.root, "commit", "-m", "landed");
	git(scratch.root, "checkout", "main");
	git(scratch.root, "merge", "--no-edit", "limen/keep-record");
	const jobs = join(scratch.root, ".limen/jobs");
	await recordJob(jobs, "keep-record", { state: "done", label: "keep", branch: "limen/keep-record" });
	assert.equal(limen(scratch, "prune").status, 0);
	await access(join(jobs, "keep-record"));
	const spawned = limen(scratch, "spawn", "hello");
	assert.equal(spawned.status, 0, spawned.stderr);
	await waitForState(scratch.root, onlyJobId(spawned.stdout), "done");
	await access(join(jobs, "keep-record"));
});

test("prune --retire uses the job's recorded repository for merge checks", async (context) => {
	const workspace = await scratchWorkspace();
	context.after(workspace.cleanup);
	assert.equal(limen(workspace, "workspace", "init").status, 0);
	const api = workspace.repositories.api;
	git(api, "checkout", "-b", "limen/ws-merged");
	await writeFile(join(api, "landed.txt"), "x\n");
	git(api, "add", "landed.txt");
	git(api, "commit", "-m", "landed");
	git(api, "checkout", "main");
	git(api, "merge", "--no-edit", "limen/ws-merged");
	git(api, "checkout", "-b", "limen/ws-unmerged");
	await writeFile(join(api, "open.txt"), "x\n");
	git(api, "add", "open.txt");
	git(api, "commit", "-m", "open");
	git(api, "checkout", "main");
	const jobs = join(workspace.root, ".limen/jobs");
	await recordJob(jobs, "ws-merged", { state: "done", label: "merged", branch: "limen/ws-merged", repo: "api" });
	await recordJob(jobs, "ws-unmerged", { state: "done", label: "unmerged", branch: "limen/ws-unmerged", repo: "api" });
	const retired = limen(workspace, "prune", "--retire");
	assert.equal(retired.status, 0, retired.stderr);
	assert.equal(retired.stdout.trim(), "retired 1 job");
	await assert.rejects(access(join(jobs, "ws-merged")));
	await access(join(jobs, "ws-unmerged"));
});

test("prune --retire rejects unknown arguments and dry-run without --retire", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const unknown = limen(scratch, "prune", "--nope");
	assert.equal(unknown.status, 1);
	assert.match(unknown.stderr, /prune accepts no arguments, --retire, or --retire --dry-run/);
	const dry = limen(scratch, "prune", "--dry-run");
	assert.equal(dry.status, 1);
	assert.match(dry.stderr, /prune --dry-run requires --retire/);
});

async function recordJob(jobsRoot: string, id: string, fields: Record<string, string>): Promise<void> {
	const job = join(jobsRoot, id);
	await mkdir(job, { recursive: true });
	await writeFile(join(job, "task.md"), "task\n");
	await writeFile(join(job, "log"), "log\n");
	for (const [name, value] of Object.entries(fields)) await writeFile(join(job, name), `${value}\n`);
}
