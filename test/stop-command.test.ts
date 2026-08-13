import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { control, onlyJobId, scratchRepo, waitForState } from "./scratch.ts";

const stubbornPi = `#!/usr/bin/env node
process.on("SIGTERM", () => {});
console.log("waiting");
setInterval(() => {}, 1000);
`;

test("stop interrupts a process group and is idempotent", async (context) => {
	const scratch = await scratchRepo(stubbornPi);
	context.after(scratch.cleanup);
	control(scratch, "init");
	const id = onlyJobId(control(scratch, "spawn", "wait").stdout);
	const stopped = control(scratch, "stop", id, "test stop");
	assert.equal(stopped.status, 0, stopped.stderr);
	await waitForState(scratch.root, id, "stopped");
	await assert.rejects(readFile(join(scratch.root, `.control/jobs/${id}/pid`)));
	const again = control(scratch, "stop", id);
	assert.equal(again.status, 0, again.stderr);
	assert.match(again.stdout, /already stopped/);
});

test("timeout is portable and leaves failed durable truth", async (context) => {
	const scratch = await scratchRepo(stubbornPi);
	context.after(scratch.cleanup);
	control(scratch, "init");
	const id = onlyJobId(control(scratch, "spawn", "--timeout", "100ms", "wait").stdout);
	await waitForState(scratch.root, id, "failed", 8_000);
	const log = await readFile(join(scratch.root, `.control/jobs/${id}/log`), "utf8");
	assert.match(log, /timeout after 100ms/);
});
