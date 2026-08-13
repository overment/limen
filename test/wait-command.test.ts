import assert from "node:assert/strict";
import test from "node:test";
import { control, onlyJobId, scratchRepo } from "./scratch.ts";

test("wait blocks for terminal state and reports the readable label", async (context) => {
	const scratch = await scratchRepo(`#!/usr/bin/env node
setTimeout(() => console.log("finished"), 400);
`);
	context.after(scratch.cleanup);
	control(scratch, "init");
	const id = onlyJobId(control(scratch, "spawn", "--label", "F001 implementation", "do work").stdout);
	const started = Date.now();
	const suffix = id.slice(-4);
	const result = control(scratch, "wait", suffix);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, new RegExp(`DONE F001 implementation · id ${id}`));
	assert.ok(Date.now() - started >= 100, "wait returned before the running job settled");
});

test("wait rejects unknown jobs", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	const result = control(scratch, "wait", "missing");
	assert.equal(result.status, 1);
	assert.match(result.stderr, /no job matches/);
});
