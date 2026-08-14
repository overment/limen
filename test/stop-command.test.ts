import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { containEscapedDescendants, processInfo, recordCleanup } from "../src/proc.ts";
import { limen, limenWithEnv, onlyJobId, scratchRepo, waitForState } from "./scratch.ts";

const stubbornPi = `#!/usr/bin/env node
process.on("SIGTERM", () => {});
console.log("waiting");
setInterval(() => {}, 1000);
`;

const responsivePi = `#!/usr/bin/env node
process.on("SIGTERM", () => process.exit(0));
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
process.on("SIGTERM", () => setTimeout(() => process.exit(0), 500));
console.log("escapee started");
setInterval(() => {}, 1000);
`;

// A pi that keeps calling tools forever; the wrapper must bound it.
const busyPi = `#!/usr/bin/env node
process.on("SIGTERM", () => {});
let n = 0;
setInterval(() => {
  n += 1;
  console.log(JSON.stringify({ type: "tool_execution_start", toolName: "read", args: { path: "file" + n } }));
}, 5);
`;

function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
async function waitForPidExit(pid: number, timeoutMs = 15_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (pidAlive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
	assert.ok(!pidAlive(pid), `pid ${pid} must exit`);
}
async function waitForFile(path: string, timeoutMs = 2_000): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const content = await readFile(path, "utf8").catch(() => "");
		if (content) return content;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`timed out waiting for ${path}`);
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
	await waitForPidExit(escapee);
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
	await waitForPidExit(escapee);
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
	await recordCleanup(job, [{ pid: 4242, born: "1786736391.120227", pgid: 4242, command: "workerd --fake" }], "after stop");
	const note = await readFile(join(job, "cleanup"), "utf8");
	assert.match(note, /termination unconfirmed after stop: 1 process\(es\) require attention/);
	assert.match(note, /4242 1786736391\.120227 workerd --fake/);
	assert.match(await readFile(join(job, "log"), "utf8"), /cleanup note written: unconfirmed pid\(s\) 4242/);
	const detail = limen(scratch, "jobs", id);
	assert.equal(detail.status, 0, detail.stderr);
	assert.match(detail.stdout, /cleanup:/);
	assert.match(detail.stdout, /4242 1786736391\.120227 workerd --fake/);
});

test("sleeping descendant discovery cannot delay stop terminal state", async (context) => {
	const scratch = await scratchRepo(responsivePi);
	context.after(scratch.cleanup);
	await writeFile(join(scratch.fakeBin, "ps"), "#!/bin/sh\nexec sleep 10\n");
	await chmod(join(scratch.fakeBin, "ps"), 0o755);
	limen(scratch, "init");
	const id = onlyJobId(limen(scratch, "spawn", "wait").stdout);
	const started = Date.now();
	const stopped = limen(scratch, "stop", id, "ps sleeping");
	assert.equal(stopped.status, 0, stopped.stderr);
	await waitForState(scratch.root, id, "stopped", 2_000);
	assert.ok(Date.now() - started < 2_000, "stop must not wait for sleeping ps");
	assert.match(await waitForFile(join(scratch.root, `.limen/jobs/${id}/cleanup`)), /escaped descendant discovery failed during stop/);
});

test("sleeping descendant discovery cannot delay timeout terminal state", async (context) => {
	const scratch = await scratchRepo(responsivePi);
	context.after(scratch.cleanup);
	await writeFile(join(scratch.fakeBin, "ps"), "#!/bin/sh\nexec sleep 10\n");
	await chmod(join(scratch.fakeBin, "ps"), 0o755);
	limen(scratch, "init");
	const started = Date.now();
	const id = onlyJobId(limen(scratch, "spawn", "--timeout", "100ms", "wait").stdout);
	await waitForState(scratch.root, id, "failed", 2_000);
	assert.ok(Date.now() - started < 2_000, "timeout must not wait for sleeping ps");
	assert.match(await waitForFile(join(scratch.root, `.limen/jobs/${id}/cleanup`)), /escaped descendant discovery failed during exhaustion/);
});

test("proc_pidinfo returns a microsecond birth identity and rejects absent PIDs", async () => {
	const current = await processInfo(process.pid);
	assert.ok(current);
	assert.equal(current.pid, process.pid);
	assert.match(current.born, /^\d+\.\d{6}$/);
	assert.equal(await processInfo(999_999_999), undefined);
});
test("a changed birth identity is never signaled", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const job = join(scratch.root, ".limen/jobs", "pid-reuse");
	await mkdir(job);
	await writeFile(join(job, "log"), "");
	const captured = { pid: 4242, born: "1786736391.120227", pgid: 4242, command: "workerd --fake" };
	const signals: Array<readonly [number, NodeJS.Signals]> = [];
	await containEscapedDescendants(job, [captured], "after replacement", {
		query: async () => ({ ...captured, born: "1786736391.120228" }),
		signal: (pid, signal) => {
			signals.push([pid, signal]);
			return "sent";
		},
	});
	assert.deepEqual(signals, []);
	assert.match(await readFile(join(job, "cleanup"), "utf8"), /4242 1786736391\.120227/);
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

test("a runaway tool loop is bounded and says so", async (context) => {
	const scratch = await scratchRepo(busyPi);
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const id = onlyJobId(limenWithEnv(scratch, { LIMEN_MAX_TOOL_CALLS: "5" }, "spawn", "loop").stdout);
	await waitForState(scratch.root, id, "failed", 15_000);
	await new Promise((resolve) => setTimeout(resolve, 5_100));
	const log = await readFile(join(scratch.root, `.limen/jobs/${id}/log`), "utf8");
	assert.match(log, /tool-call cap reached after \d+ calls/);
	const calls = Number((await readFile(join(scratch.root, `.limen/jobs/${id}/tool-calls`), "utf8")).trim());
	assert.ok(calls >= 5, `expected the cap to fire after counting, saw ${calls}`);
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
	assert.match(stopped.stdout, /stopped manual-race|already done/);
	assert.equal(await readFile(join(job, "state"), "utf8"), "done\n");
});
