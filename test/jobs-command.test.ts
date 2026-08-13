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

test("jobs reports an empty set before init", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	const result = control(scratch, "jobs");
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout, "no jobs\n");
});
