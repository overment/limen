import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { limen, scratchRepo } from "./scratch.ts";

test("malformed records are informational and do not get rewritten", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const job = join(scratch.root, ".limen/jobs/manual");
	await mkdir(job);
	await writeFile(join(job, "task.md"), "manual\n");
	await writeFile(join(job, "state"), "mystery\n");
	await writeFile(join(job, "branch"), "main\n");
	await writeFile(join(job, "log"), "plain log\n");
	const result = limen(scratch, "jobs");
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /INVALID manual.*unknown state "mystery"/);
	assert.equal(await import("node:fs/promises").then(({ readFile }) => readFile(join(job, "state"), "utf8")), "mystery\n");
});

test("a running record without pid is starting, not invalid", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const job = join(scratch.root, ".limen/jobs/handshake");
	await mkdir(job);
	await writeFile(join(job, "task.md"), "soon\n");
	await writeFile(join(job, "state"), "running\n");
	await writeFile(join(job, "label"), "F001 implementation\n");
	await writeFile(join(job, "branch"), "limen/handshake\n");
	await writeFile(join(job, "log"), "");
	await writeFile(join(job, "activity"), "think\n");
	const result = limen(scratch, "jobs");
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /RUNNING F001 implementation/);
	assert.match(result.stdout, /starting/);
	assert.doesNotMatch(result.stdout, /INVALID/);
});

test("jobs tails a rambling log and recognizes historical Control terminal lines", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const job = join(scratch.root, ".limen/jobs/ramble");
	await mkdir(job);
	await writeFile(join(job, "task.md"), "ramble\n");
	await writeFile(join(job, "state"), "failed\n");
	await writeFile(join(job, "label"), "ramble\n");
	await writeFile(join(job, "branch"), "main\n");
	const noise = Array.from({ length: 400 }, (_, i) => `noise-${i}-${"x".repeat(40)}`).join("\n");
	await writeFile(join(job, "log"), `${noise}\n[limen 2026-08-13T00:00:00.000Z] start\n[control 2026-08-13T00:00:01.000Z] failed: rambling\nlast line\n`);
	const result = limen(scratch, "jobs");
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /FAILED ramble/);
	assert.match(result.stdout, /failed: rambling/);
	assert.match(result.stdout, /last line/);
	assert.doesNotMatch(result.stdout, /noise-0-/);
});

test("jobs lists running first, then newest started-at", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const root = join(scratch.root, ".limen/jobs");
	for (const job of [
		{ id: "old-done", state: "done", started: "2026-08-13T18:00:00.000Z", label: "old done" },
		{ id: "new-run", state: "running", started: "2026-08-13T20:00:00.000Z", label: "new run" },
		{ id: "mid-stop", state: "stopped", started: "2026-08-13T19:00:00.000Z", label: "mid stop" },
	]) {
		const dir = join(root, job.id);
		await mkdir(dir);
		await writeFile(join(dir, "task.md"), "x\n");
		await writeFile(join(dir, "state"), `${job.state}\n`);
		await writeFile(join(dir, "label"), `${job.label}\n`);
		await writeFile(join(dir, "branch"), "main\n");
		await writeFile(join(dir, "started-at"), `${job.started}\n`);
		await writeFile(join(dir, "log"), "");
	}
	const result = limen(scratch, "jobs");
	assert.equal(result.status, 0, result.stderr);
	const labels = [...result.stdout.matchAll(/^(?:RUNNING|DONE|STOPPED|FAILED) (.+?) ·/gm)].map((match) => match[1]);
	assert.deepEqual(labels, ["new run", "mid stop", "old done"]);
});

test("jobs reports an empty set before init", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	const result = limen(scratch, "jobs");
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout, "no jobs\n");
});
