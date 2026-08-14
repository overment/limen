import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { recordCleanup } from "../src/proc.ts";
import { limen, onlyJobId, scratchRepo, waitForState } from "./scratch.ts";

const stubbornPi = `#!/usr/bin/env node
process.on("SIGTERM", () => {});
console.log("waiting");
setInterval(() => {}, 1000);
`;

// A pi whose child detaches into its own process group (setsid-equivalent) and ignores SIGTERM.
const escapingPi = `#!/usr/bin/env node
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const escapee = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], { detached: true, stdio: "ignore" });
escapee.unref();
writeFileSync("escapee-pid", String(escapee.pid) + "\\n");
console.log("escapee started");
setInterval(() => {}, 1000);
`;

function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function readEscapeePid(scratch: { root: string }, id: string): Promise<number> {
	const worktree = join(dirname(scratch.root), `.${basename(scratch.root)}-limen-worktrees`, id, "escapee-pid");
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		const raw = await readFile(worktree, "utf8").catch(() => "");
		const pid = Number(raw.trim());
		if (Number.isSafeInteger(pid) && pid > 0) return pid;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error("escaping fake pi never recorded its detached child");
}

test("stop terminates an escaped-group child or records it in a cleanup note", async (context) => {
	const scratch = await scratchRepo(escapingPi);
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const id = onlyJobId(limen(scratch, "spawn", "escape").stdout);
	const escapee = await readEscapeePid(scratch, id);
	context.after(async () => {
		try {
			process.kill(escapee, "SIGKILL");
		} catch {}
	});
	const stopped = limen(scratch, "stop", id, "containment test");
	assert.equal(stopped.status, 0, stopped.stderr);
	await waitForState(scratch.root, id, "stopped");
	const log = await readFile(join(scratch.root, `.limen/jobs/${id}/log`), "utf8");
	assert.match(log, /terminating 1 escaped job process\(es\)/);
	// The escapee ignores SIGTERM, so its death proves the KILL escalation; an owned process always yields to KILL.
	assert.ok(!pidAlive(escapee), "escaped child must not survive stop");
	await assert.rejects(readFile(join(scratch.root, `.limen/jobs/${id}/cleanup`)), "a confirmed termination writes no cleanup note");
});

test("timeout terminates an escaped-group child", async (context) => {
	const scratch = await scratchRepo(escapingPi);
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const id = onlyJobId(limen(scratch, "spawn", "--timeout", "2s", "escape").stdout);
	const escapee = await readEscapeePid(scratch, id);
	context.after(async () => {
		try {
			process.kill(escapee, "SIGKILL");
		} catch {}
	});
	await waitForState(scratch.root, id, "failed", 15_000);
	const log = await readFile(join(scratch.root, `.limen/jobs/${id}/log`), "utf8");
	assert.match(log, /timeout after 2000ms/);
	assert.match(log, /terminating 1 escaped job process\(es\)/);
	assert.ok(!pidAlive(escapee), "escaped child must not survive timeout");
});

test("a cleanup note names unconfirmed survivors and limen jobs detail shows it", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const id = "manual-cleanup";
	const job = join(scratch.root, ".limen/jobs", id);
	await mkdir(job);
	await writeFile(join(job, "state"), "stopped\n");
	await writeFile(join(job, "branch"), "main\n");
	await writeFile(join(job, "task.md"), "cleanup\n");
	await writeFile(join(job, "log"), "");
	await recordCleanup(job, [{ pid: 4242, pgid: 4242, command: "workerd --fake" }], "after stop");
	const note = await readFile(join(job, "cleanup"), "utf8");
	assert.match(note, /termination unconfirmed after stop: 1 surviving process\(es\)/);
	assert.match(note, /4242 workerd --fake/);
	assert.match(await readFile(join(job, "log"), "utf8"), /cleanup note written: surviving pid\(s\) 4242/);
	const detail = limen(scratch, "jobs", id);
	assert.equal(detail.status, 0, detail.stderr);
	assert.match(detail.stdout, /cleanup:/);
	assert.match(detail.stdout, /4242 workerd --fake/);
});

test("stop interrupts a process group and is idempotent", async (context) => {
	const scratch = await scratchRepo(stubbornPi);
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const id = onlyJobId(limen(scratch, "spawn", "wait").stdout);
	const stopped = limen(scratch, "stop", id, "test stop");
	assert.equal(stopped.status, 0, stopped.stderr);
	await waitForState(scratch.root, id, "stopped");
	assert.ok(Number.isFinite(Date.parse((await readFile(join(scratch.root, `.limen/jobs/${id}/finished-at`), "utf8")).trim())));
	await assert.rejects(readFile(join(scratch.root, `.limen/jobs/${id}/pid`)));
	const again = limen(scratch, "stop", id);
	assert.equal(again.status, 0, again.stderr);
	assert.match(again.stdout, /already stopped/);
});

test("timeout is portable and leaves failed durable truth", async (context) => {
	const scratch = await scratchRepo(stubbornPi);
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const id = onlyJobId(limen(scratch, "spawn", "--timeout", "100ms", "wait").stdout);
	await waitForState(scratch.root, id, "failed", 8_000);
	const log = await readFile(join(scratch.root, `.limen/jobs/${id}/log`), "utf8");
	assert.match(log, /timeout after 100ms/);
	assert.ok(Number.isFinite(Date.parse((await readFile(join(scratch.root, `.limen/jobs/${id}/finished-at`), "utf8")).trim())));
});

test("stop preserves terminal truth written while interruption settles", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const id = "manual-race";
	const job = join(scratch.root, ".limen/jobs", id);
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
	const stopped = limen(scratch, "stop", id, "late stop");
	assert.equal(stopped.status, 0, stopped.stderr);
	assert.match(stopped.stdout, /already done/);
	assert.equal(await readFile(join(job, "state"), "utf8"), "done\n");
});
