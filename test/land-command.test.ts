import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { git, limen, onlyJobId, scratchRepo, waitForState } from "./scratch.ts";

function commitProject(root: string): void {
	git(root, "add", ".");
	git(root, "commit", "-m", "init");
}

test("land --yes fast-forwards a done job onto the current branch", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	commitProject(scratch.root);
	const before = git(scratch.root, "rev-parse", "HEAD");
	const id = onlyJobId(limen(scratch, "spawn", "--label", "F717 land", "make commit").stdout);
	await waitForState(scratch.root, id, "done");
	const job = join(scratch.root, ".limen/jobs", id);
	const branch = (await readFile(join(job, "branch"), "utf8")).trim();
	const tip = git(scratch.root, "rev-parse", branch);
	const files = (await readdir(job)).sort();
	const state = await readFile(join(job, "state"), "utf8");
	assert.notEqual(tip, before);

	const landed = limen(scratch, "land", id, "--yes");
	assert.equal(landed.status, 0, landed.stderr);
	assert.match(landed.stdout, new RegExp(`landed ${id} onto main`));
	assert.equal(git(scratch.root, "rev-parse", "HEAD"), tip);
	assert.equal(await readFile(join(scratch.root, "candidate.txt"), "utf8"), "candidate\n");
	assert.equal(await readFile(join(job, "state"), "utf8"), state);
	assert.deepEqual((await readdir(job)).sort(), files);
});

test("land --yes merges when the target has moved", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	commitProject(scratch.root);
	const id = onlyJobId(limen(scratch, "spawn", "--label", "F717 merge", "make commit").stdout);
	await waitForState(scratch.root, id, "done");
	const job = join(scratch.root, ".limen/jobs", id);
	const branch = (await readFile(join(job, "branch"), "utf8")).trim();
	const tip = git(scratch.root, "rev-parse", branch);
	await writeFile(join(scratch.root, "main-only.txt"), "main\n");
	git(scratch.root, "add", "main-only.txt");
	git(scratch.root, "commit", "-m", "main moves");

	const landed = limen(scratch, "land", id, "--onto", "main", "--yes");
	assert.equal(landed.status, 0, landed.stderr);
	assert.match(landed.stdout, new RegExp(`landed ${id} onto main`));
	assert.match(git(scratch.root, "log", "-1", "--format=%P"), / /);
	git(scratch.root, "merge-base", "--is-ancestor", tip, "HEAD");
	assert.equal(await readFile(join(scratch.root, "candidate.txt"), "utf8"), "candidate\n");
	assert.equal(await readFile(join(scratch.root, "main-only.txt"), "utf8"), "main\n");
});

test("land refuses missing id, running job, empty commits, dirty target, and unconfirmed merge", async (context) => {
	const scratch = await scratchRepo(`#!/usr/bin/env node
process.on("SIGTERM", () => process.exit(0));
console.log("waiting");
setInterval(() => {}, 1000);
`);
	context.after(scratch.cleanup);
	limen(scratch, "init");
	commitProject(scratch.root);
	const main = git(scratch.root, "rev-parse", "HEAD");

	const missing = limen(scratch, "land");
	assert.equal(missing.status, 1);
	assert.match(missing.stderr, /land requires a job id/);
	assert.equal(git(scratch.root, "rev-parse", "HEAD"), main);

	const unknown = limen(scratch, "land", "missing", "--yes");
	assert.equal(unknown.status, 1);
	assert.match(unknown.stderr, /no job matches/);

	const runningId = onlyJobId(limen(scratch, "spawn", "--label", "F717 run", "wait").stdout);
	const running = limen(scratch, "land", runningId, "--yes");
	assert.equal(running.status, 1);
	assert.match(running.stderr, /land requires a done job/);
	assert.equal(git(scratch.root, "rev-parse", "HEAD"), main);
	assert.equal(limen(scratch, "stop", runningId).status, 0);

	const emptyScratch = await scratchRepo();
	context.after(emptyScratch.cleanup);
	limen(emptyScratch, "init");
	commitProject(emptyScratch.root);
	const emptyMain = git(emptyScratch.root, "rev-parse", "HEAD");
	const emptyId = onlyJobId(limen(emptyScratch, "spawn", "--label", "F717 empty", "do work").stdout);
	await waitForState(emptyScratch.root, emptyId, "done");
	const empty = limen(emptyScratch, "land", emptyId, "--yes");
	assert.equal(empty.status, 1);
	assert.match(empty.stderr, /has no commits to land/);
	assert.equal(git(emptyScratch.root, "rev-parse", "HEAD"), emptyMain);

	const dirtyScratch = await scratchRepo();
	context.after(dirtyScratch.cleanup);
	limen(dirtyScratch, "init");
	commitProject(dirtyScratch.root);
	const dirtyId = onlyJobId(limen(dirtyScratch, "spawn", "--label", "F717 dirty", "make commit").stdout);
	await waitForState(dirtyScratch.root, dirtyId, "done");
	const dirtyMain = git(dirtyScratch.root, "rev-parse", "HEAD");
	await writeFile(join(dirtyScratch.root, "dirt.txt"), "dirt\n");
	const dirty = limen(dirtyScratch, "land", dirtyId, "--yes");
	assert.equal(dirty.status, 1);
	assert.match(dirty.stderr, /target main is dirty/);
	assert.equal(git(dirtyScratch.root, "rev-parse", "HEAD"), dirtyMain);

	const confirmScratch = await scratchRepo();
	context.after(confirmScratch.cleanup);
	limen(confirmScratch, "init");
	commitProject(confirmScratch.root);
	const confirmId = onlyJobId(limen(confirmScratch, "spawn", "--label", "F717 confirm", "make commit").stdout);
	await waitForState(confirmScratch.root, confirmId, "done");
	const confirmMain = git(confirmScratch.root, "rev-parse", "HEAD");
	git(confirmScratch.root, "branch", "other");
	const unconfirmed = limen(confirmScratch, "land", confirmId);
	assert.equal(unconfirmed.status, 1);
	assert.match(unconfirmed.stderr, /land requires a TTY confirm, or pass --yes/);
	assert.equal(git(confirmScratch.root, "rev-parse", "HEAD"), confirmMain);
	const onto = limen(confirmScratch, "land", confirmId, "--onto", "other", "--yes");
	assert.equal(onto.status, 1);
	assert.match(onto.stderr, /checkout other first/);
	assert.equal(git(confirmScratch.root, "rev-parse", "HEAD"), confirmMain);
	assert.equal(git(confirmScratch.root, "rev-parse", "other"), confirmMain);
});
