import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

test("stop preserves terminal truth written while interruption settles", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	control(scratch, "init");
	const id = "manual-race";
	const job = join(scratch.root, ".control/jobs", id);
	await mkdir(job);
	await writeFile(join(job, "state"), "running\n");
	await writeFile(join(job, "branch"), "main\n");
	await writeFile(join(job, "task.md"), "race\n");
	await writeFile(join(job, "log"), "");
	const child = spawn(
		process.execPath,
		[
			"-e",
			`const fs = require("node:fs");
const job = process.argv[1];
process.on("SIGTERM", () => {
  fs.writeFileSync(job + "/state", "done\\n");
  try { fs.unlinkSync(job + "/pid"); } catch {}
  setTimeout(() => process.exit(0), 25);
});
fs.writeFileSync(job + "/ready", "yes");
setInterval(() => {}, 1000);`,
			job,
		],
		{ detached: true, stdio: "ignore" },
	);
	assert.ok(child.pid);
	await writeFile(join(job, "pid"), `${child.pid}\n`);
	const deadline = Date.now() + 2_000;
	while (Date.now() < deadline) {
		if (
			await readFile(join(job, "ready")).then(
				() => true,
				() => false,
			)
		)
			break;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	const stopped = control(scratch, "stop", id, "late stop");
	assert.equal(stopped.status, 0, stopped.stderr);
	assert.match(stopped.stdout, /already done/);
	assert.equal(await readFile(join(job, "state"), "utf8"), "done\n");
});
