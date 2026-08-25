import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { liveJob } from "../src/reap.ts";
import { git, limen, onlyJobId, scratchRepo, waitForState, writeFakePi } from "./scratch.ts";

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
