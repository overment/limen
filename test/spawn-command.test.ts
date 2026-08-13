import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { control, git, onlyJobId, scratchRepo, waitForState } from "./scratch.ts";

test("spawn creates isolated branch, canonical record, runs pi, and resumes its worktree", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(control(scratch, "init").status, 0);
	const launched = control(scratch, "spawn", "--label", "F001 implementation", "make commit");
	assert.equal(launched.status, 0, launched.stderr);
	assert.match(launched.stdout, /started F001 implementation/);
	const id = onlyJobId(launched.stdout);
	await waitForState(scratch.root, id, "done");
	const job = join(scratch.root, ".control/jobs", id);
	assert.equal(await readFile(join(job, "branch"), "utf8"), `control/${id}\n`);
	assert.equal(await readFile(join(job, "task.md"), "utf8"), "make commit\n");
	assert.equal(await readFile(join(job, "label"), "utf8"), "F001 implementation\n");
	assert.ok(Number.isFinite(Date.parse((await readFile(join(job, "started-at"), "utf8")).trim())));
	assert.ok(Number.isFinite(Date.parse((await readFile(join(job, "finished-at"), "utf8")).trim())));
	await assert.rejects(readFile(join(job, "pid")));
	const worktreeLine = git(scratch.root, "worktree", "list", "--porcelain")
		.split("\n")
		.find((line) => line.includes(id));
	assert.ok(worktreeLine);
	const worktree = worktreeLine.slice("worktree ".length);
	assert.equal(await readFile(join(worktree, "candidate.txt"), "utf8"), "candidate\n");
	const childEnvironment = JSON.parse(await readFile(join(worktree, "pi-env.json"), "utf8")) as {
		internal?: string;
		job?: string;
		id?: string;
	};
	assert.deepEqual(childEnvironment, { job: "1", id, label: "F001 implementation" });
	assert.notEqual(worktree, scratch.root);
	await writeFile(join(worktree, "uncommitted.txt"), "keep me\n");
	const resumed = control(scratch, "spawn", "continue work", "--branch", `control/${id}`);
	assert.equal(resumed.status, 0, resumed.stderr);
	const resumedId = onlyJobId(resumed.stdout);
	await waitForState(scratch.root, resumedId, "done");
	assert.equal(await readFile(join(worktree, "uncommitted.txt"), "utf8"), "keep me\n");
});

test("failure is durable and jobs renders live facts", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	control(scratch, "init");
	const id = onlyJobId(control(scratch, "spawn", "fail now").stdout);
	await waitForState(scratch.root, id, "failed");
	const jobs = control(scratch, "jobs");
	assert.equal(jobs.status, 0, jobs.stderr);
	assert.match(jobs.stdout, new RegExp(`FAILED fail now · id ${id}`));
	assert.match(jobs.stdout, /worker exited with code 7/);
	assert.match(jobs.stdout, /fake pi completed/);
});

test("review gets fresh detached worktree and reviewer birth text", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	control(scratch, "init");
	const worker = onlyJobId(control(scratch, "spawn", "make commit").stdout);
	await waitForState(scratch.root, worker, "done");
	const branch = `control/${worker}`;
	const review = onlyJobId(control(scratch, "spawn", "--review", "--branch", branch, "inspect candidate").stdout);
	await waitForState(scratch.root, review, "done");
	const worktree = git(scratch.root, "worktree", "list", "--porcelain")
		.split("\n\n")
		.find((block) => block.includes(review));
	assert.match(worktree ?? "", /detached/);
	const reviewPath = worktree?.split("\n")[0]?.slice("worktree ".length);
	assert.ok(reviewPath);
	const argv = JSON.parse(await readFile(join(reviewPath, "pi-args.json"), "utf8")) as string[];
	const prompt = argv[argv.indexOf("--append-system-prompt") + 1];
	assert.ok(argv.includes("--no-context-files"));
	assert.match(prompt ?? "", /Review; do not rewrite/);
	assert.equal(git(reviewPath, "rev-parse", "HEAD"), git(scratch.root, "rev-parse", branch));
});

test("independent jobs can run concurrently and are merely announced", async (context) => {
	const fakePi = `#!/usr/bin/env node\nsetTimeout(() => { console.log("done") }, 400);\n`;
	const scratch = await scratchRepo(fakePi);
	context.after(scratch.cleanup);
	control(scratch, "init");
	const first = onlyJobId(control(scratch, "spawn", "first").stdout);
	const secondLaunch = control(scratch, "spawn", "second");
	assert.match(secondLaunch.stdout, /note: 1 job already running/);
	const second = onlyJobId(secondLaunch.stdout);
	await Promise.all([waitForState(scratch.root, first, "done"), waitForState(scratch.root, second, "done")]);
	assert.notEqual(
		await readFile(join(scratch.root, `.control/jobs/${first}/branch`), "utf8"),
		await readFile(join(scratch.root, `.control/jobs/${second}/branch`), "utf8"),
	);
});
