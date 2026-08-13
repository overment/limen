import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { control, scratchRepo } from "./scratch.ts";

test("malformed records are informational and do not get rewritten", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	control(scratch, "init");
	const job = join(scratch.root, ".control/jobs/manual");
	await mkdir(job);
	await writeFile(join(job, "task.md"), "manual\n");
	await writeFile(join(job, "state"), "mystery\n");
	await writeFile(join(job, "branch"), "main\n");
	await writeFile(join(job, "log"), "plain log\n");
	const result = control(scratch, "jobs");
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /INVALID manual.*unknown state "mystery"/);
	assert.equal(
		await import("node:fs/promises").then(({ readFile }) => readFile(join(job, "state"), "utf8")),
		"mystery\n",
	);
});

test("a running record without pid is starting, not invalid", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	control(scratch, "init");
	const job = join(scratch.root, ".control/jobs/handshake");
	await mkdir(job);
	await writeFile(join(job, "task.md"), "soon\n");
	await writeFile(join(job, "state"), "running\n");
	await writeFile(join(job, "label"), "F001 implementation\n");
	await writeFile(join(job, "branch"), "control/handshake\n");
	await writeFile(join(job, "log"), "");
	await writeFile(join(job, "activity"), "think\n");
	const result = control(scratch, "jobs");
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /RUNNING F001 implementation/);
	assert.match(result.stdout, /starting/);
	assert.doesNotMatch(result.stdout, /INVALID/);
});

test("jobs reports an empty set before init", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	const result = control(scratch, "jobs");
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout, "no jobs\n");
});
