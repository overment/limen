import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { containEscapedDescendants, processInfo, recordCleanup } from "../src/contain.ts";
import { limen, limenWithEnv, limenWithSession, onlyJobId, scratchRepo, waitForState } from "./scratch.ts";

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

// The parent exits as soon as its process group receives TERM, while its detached child survives.
const immediatelyExitingEscapingPi = escapingPi.replace("setTimeout(() => process.exit(0), 500)", "process.exit(0)");
const termRecordingEscapingPi = escapingPi.replace(
	'process.on("SIGTERM", () => setTimeout(() => process.exit(0), 500));',
	'process.on("SIGTERM", () => { writeFileSync("term-received-at", String(Date.now())); process.exit(0); });',
);

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
async function waitForContainment(jobDir: string, pid: number, timeoutMs = 5_000): Promise<"exited" | "recorded"> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const cleanup = await readFile(join(jobDir, "cleanup"), "utf8").catch(() => "");
		if (cleanup.includes(`${pid} `)) return "recorded";
		if (!pidAlive(pid)) return "exited";
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	assert.fail(`pid ${pid} must exit or be named in cleanup`);
}

async function delayProcessTable(scratch: { fakeBin: string }): Promise<void> {
	await writeFile(join(scratch.fakeBin, "ps"), '#!/bin/sh\n/bin/sleep 0.2\nexec /bin/ps "$@"\n');
	await chmod(join(scratch.fakeBin, "ps"), 0o755);
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
	const jobDir = join(scratch.root, `.limen/jobs/${id}`);
	const outcome = await waitForContainment(jobDir, escapee);
	assert.match(await readFile(join(jobDir, "log"), "utf8"), /terminating 1 escaped job process\(es\)/);
	if (outcome === "exited") await assert.rejects(readFile(join(jobDir, "cleanup")), "a confirmed termination writes no cleanup note");
	else assert.match(await readFile(join(jobDir, "cleanup"), "utf8"), new RegExp(`${escapee} `));
});

test("timeout terminates an escaped-group child or records it in cleanup", async (context) => {
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
	const jobDir = join(scratch.root, `.limen/jobs/${id}`);
	await waitForContainment(jobDir, escapee);
	const log = await readFile(join(jobDir, "log"), "utf8");
	assert.match(log, /timeout after 2000ms/);
	assert.match(log, /terminating 1 escaped job process\(es\)/);
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

test("stop completes delayed discovery before a fast parent exit", async (context) => {
	const scratch = await scratchRepo(immediatelyExitingEscapingPi);
	context.after(scratch.cleanup);
	await delayProcessTable(scratch);
	limen(scratch, "init");
	const id = onlyJobId(limen(scratch, "spawn", "escape").stdout);
	const escapee = await readEscapeePid(scratch, id);
	context.after(() => {
		try {
			process.kill(escapee, "SIGKILL");
		} catch {}
	});
	const stopped = limen(scratch, "stop", id, "delayed discovery");
	assert.equal(stopped.status, 0, stopped.stderr);
	await waitForState(scratch.root, id, "stopped", 2_000);
	const jobDir = join(scratch.root, `.limen/jobs/${id}`);
	await waitForContainment(jobDir, escapee);
	assert.match(await readFile(join(jobDir, "log"), "utf8"), /terminating 1 escaped job process\(es\)/);
	assert.doesNotMatch(await readFile(join(jobDir, "cleanup"), "utf8").catch(() => ""), /root process .* missing or terminal/);
});

test("timeout completes delayed discovery before a fast parent exit", async (context) => {
	const scratch = await scratchRepo(immediatelyExitingEscapingPi);
	context.after(scratch.cleanup);
	await delayProcessTable(scratch);
	limen(scratch, "init");
	const id = onlyJobId(limen(scratch, "spawn", "--timeout", "1s", "escape").stdout);
	const escapee = await readEscapeePid(scratch, id);
	context.after(() => {
		try {
			process.kill(escapee, "SIGKILL");
		} catch {}
	});
	await waitForState(scratch.root, id, "failed", 2_000);
	const jobDir = join(scratch.root, `.limen/jobs/${id}`);
	await waitForContainment(jobDir, escapee);
	assert.match(await readFile(join(jobDir, "log"), "utf8"), /terminating 1 escaped job process\(es\)/);
	assert.doesNotMatch(await readFile(join(jobDir, "cleanup"), "utf8").catch(() => ""), /root process .* missing or terminal/);
});

test("one deadline bounds delayed ps and all birth captures before TERM", async (context) => {
	const scratch = await scratchRepo(termRecordingEscapingPi);
	context.after(scratch.cleanup);
	await writeFile(
		join(scratch.fakeBin, "ps"),
		`#!/bin/sh\n"${process.execPath}" -e 'require("node:fs").writeFileSync(".ps-started-at", String(Date.now()))'\n/bin/sleep 0.9\nexec /bin/ps "$@"\n`,
	);
	await chmod(join(scratch.fakeBin, "ps"), 0o755);
	limen(scratch, "init");
	const id = onlyJobId(limen(scratch, "spawn", "escape").stdout);
	const escapee = await readEscapeePid(scratch, id);
	context.after(() => {
		try {
			process.kill(escapee, "SIGKILL");
		} catch {}
	});
	const stopped = limen(scratch, "stop", id, "aggregate query deadline");
	assert.equal(stopped.status, 0, stopped.stderr);
	const worktree = join(dirname(scratch.root), `.${basename(scratch.root)}-limen-worktrees`, id);
	const queryStartedAt = Number(await readFile(join(scratch.root, ".ps-started-at"), "utf8"));
	const termAt = Number(await readFile(join(worktree, "term-received-at"), "utf8"));
	assert.ok(termAt - queryStartedAt < 1_250, `TERM must follow the aggregate one-second query deadline, took ${termAt - queryStartedAt}ms`);
});

test("sleeping descendant discovery delays stop only through its short bound", async (context) => {
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
	const elapsed = Date.now() - started;
	assert.ok(elapsed >= 900 && elapsed < 2_000, `stop must wait only for the bounded ps query, took ${elapsed}ms`);
	assert.match(await readFile(join(scratch.root, `.limen/jobs/${id}/cleanup`), "utf8"), /escaped descendant discovery failed during stop/);
});

test("sleeping descendant discovery delays timeout only through its short bound", async (context) => {
	const scratch = await scratchRepo(responsivePi);
	context.after(scratch.cleanup);
	await writeFile(join(scratch.fakeBin, "ps"), `#!/bin/sh\n"${process.execPath}" -e 'require("node:fs").writeFileSync(".ps-started-at", String(Date.now()))'\nexec sleep 10\n`);
	await chmod(join(scratch.fakeBin, "ps"), 0o755);
	limen(scratch, "init");
	const id = onlyJobId(limen(scratch, "spawn", "--timeout", "100ms", "wait").stdout);
	await waitForState(scratch.root, id, "failed", 2_000);
	const queryStartedAt = Number(await readFile(join(scratch.root, ".ps-started-at"), "utf8"));
	const finishedAt = Date.parse((await readFile(join(scratch.root, `.limen/jobs/${id}/finished-at`), "utf8")).trim());
	assert.ok(finishedAt - queryStartedAt < 2_000, `timeout must wait only for the bounded ps query, took ${finishedAt - queryStartedAt}ms`);
	assert.match(await readFile(join(scratch.root, `.limen/jobs/${id}/cleanup`), "utf8"), /escaped descendant discovery failed during exhaustion/);
});

test("proc_pidinfo distinguishes present and confirmed absent PIDs", async () => {
	const deadline = Date.now() + 10_000;
	const current = await processInfo(process.pid, deadline);
	if (process.platform !== "darwin") {
		assert.equal(current.kind, "unavailable");
		assert.equal((await processInfo(999_999_999, deadline)).kind, "unavailable");
		return;
	}
	assert.equal(current.kind, "present");
	if (current.kind !== "present") assert.fail("current process identity must be available");
	assert.equal(current.process.pid, process.pid);
	assert.match(current.process.born, /^\d+\.\d{6}$/);
	assert.deepEqual(await processInfo(999_999_999, deadline), { kind: "absent" });
});
test("a changed birth identity is never signaled", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const job = join(scratch.root, ".limen/jobs", "pid-reuse");
	await mkdir(job);
	await writeFile(join(job, "log"), "");
	const captured = { pid: 4242, ppid: 1, born: "1786736391.120227", pgid: 4242, command: "workerd --fake" };
	const signals: Array<readonly [number, NodeJS.Signals]> = [];
	await containEscapedDescendants(job, [captured], "after replacement", {
		query: async () => ({ kind: "present", process: { ...captured, born: "1786736391.120228" } }),
		signal: (pid, signal) => {
			signals.push([pid, signal]);
			return "sent";
		},
	});
	assert.deepEqual(signals, []);
	assert.match(await readFile(join(job, "cleanup"), "utf8"), /4242 1786736391\.120227/);
});

test("an unavailable identity recheck is recorded without signaling", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const job = join(scratch.root, ".limen/jobs", "identity-unavailable");
	await mkdir(job);
	await writeFile(join(job, "log"), "");
	const captured = { pid: 4242, born: "1786736391.120227", pgid: 4242, command: "workerd --fake" };
	const signals: Array<readonly [number, NodeJS.Signals]> = [];
	await containEscapedDescendants(job, [captured], "after unavailable identity", {
		query: async () => ({ kind: "unavailable" }),
		signal: (pid, signal) => {
			signals.push([pid, signal]);
			return "sent";
		},
	});
	assert.deepEqual(signals, []);
	assert.match(await readFile(join(job, "cleanup"), "utf8"), /4242 1786736391\.120227 workerd --fake/);
});

test("a helper-timeout-style unavailable recheck records the captured process", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const job = join(scratch.root, ".limen/jobs", "identity-timeout");
	await mkdir(job);
	await writeFile(join(job, "log"), "");
	const captured = { pid: 4242, born: "1786736391.120227", pgid: 4242, command: "workerd --fake" };
	const signals: Array<readonly [number, NodeJS.Signals]> = [];
	let rechecks = 0;
	await containEscapedDescendants(job, [captured], "after identity timeout", {
		query: async () => (rechecks++ === 0 ? { kind: "present", process: { ...captured, ppid: 1 } } : { kind: "unavailable" }),
		signal: (pid, signal) => {
			signals.push([pid, signal]);
			return "sent";
		},
	});
	assert.deepEqual(signals, [[4242, "SIGTERM"]]);
	assert.match(await readFile(join(job, "cleanup"), "utf8"), /4242 1786736391\.120227 workerd --fake/);
});

test("confirmed absence after TERM needs neither KILL nor cleanup", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const job = join(scratch.root, ".limen/jobs", "absent-after-term");
	await mkdir(job);
	await writeFile(join(job, "log"), "");
	const captured = { pid: 4242, ppid: 1, born: "1786736391.120227", pgid: 4242, command: "workerd --fake" };
	const signals: Array<readonly [number, NodeJS.Signals]> = [];
	let rechecks = 0;
	await containEscapedDescendants(job, [captured], "after confirmed exit", {
		query: async () => (rechecks++ === 0 ? { kind: "present", process: captured } : { kind: "absent" }),
		signal: (pid, signal) => {
			signals.push([pid, signal]);
			return "sent";
		},
	});
	assert.deepEqual(signals, [[4242, "SIGTERM"]]);
	await assert.rejects(readFile(join(job, "cleanup")), "confirmed absence must not write cleanup");
});

test("stop with a done: reason records done and silences the stopping session", async (context) => {
	const scratch = await scratchRepo(stubbornPi);
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const id = onlyJobId(limen(scratch, "spawn", "wait").stdout);
	const job = join(scratch.root, `.limen/jobs/${id}`);
	const stopped = limenWithSession(scratch, "coordinator-a", "stop", id, "done: merged as abc123");
	assert.equal(stopped.status, 0, stopped.stderr);
	await waitForState(scratch.root, id, "done");
	assert.match(await readFile(join(job, "log"), "utf8"), /done: done: merged as abc123/);
	assert.ok((await readdir(join(job, "notify/delivered"))).includes("coordinator-a"));
});

test("a successful hosted stop marks the caller delivered after terminal state", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const id = "hosted-dead";
	const job = join(scratch.root, ".limen/jobs", id);
	await mkdir(job);
	await writeFile(join(job, "state"), "running\n");
	await writeFile(join(job, "branch"), "main\n");
	await writeFile(join(job, "task.md"), "hosted\n");
	await writeFile(join(job, "log"), "");
	await writeFile(join(job, "hosted"), "hosted\n");
	const stopped = limenWithSession(scratch, "coordinator-a", "stop", id, "hosted stop");
	assert.equal(stopped.status, 0, stopped.stderr);
	assert.equal((await readFile(join(job, "state"), "utf8")).trim(), "stopped");
	assert.ok((await readdir(join(job, "notify/delivered"))).includes("coordinator-a"));
});

test("a hosted stop that is still running does not mark the caller delivered", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const id = "hosted-live";
	const job = join(scratch.root, ".limen/jobs", id);
	await mkdir(job);
	await writeFile(join(job, "state"), "running\n");
	await writeFile(join(job, "branch"), "main\n");
	await writeFile(join(job, "task.md"), "hosted\n");
	await writeFile(join(job, "log"), "");
	await writeFile(join(job, "hosted"), "hosted\n");
	const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], { detached: true, stdio: "ignore" });
	const pid = child.pid;
	assert.ok(pid);
	child.unref();
	context.after(() => {
		try {
			process.kill(-pid, "SIGKILL");
		} catch {}
	});
	await writeFile(join(job, "pid"), `${pid}\n`);
	const stopped = limenWithEnv(
		scratch,
		{ PI_SESSION_ID: "coordinator-a", PI_SESSION_FILE: "/sessions/coordinator-a.jsonl", LIMEN_HOSTED_STOP_WAIT_MS: "200" },
		"stop",
		id,
		"still up",
	);
	assert.notEqual(stopped.status, 0);
	assert.match(stopped.stderr, /agent is still up/);
	assert.equal((await readFile(join(job, "state"), "utf8")).trim(), "running");
	const delivered = await readdir(join(job, "notify/delivered")).catch(() => [] as string[]);
	assert.equal(delivered.includes("coordinator-a"), false);
});

test("stop interrupts a process group and is idempotent", async (context) => {
	// Emit a last assistant message, then hang: stop must not copy that text into result.
	const talkThenWait = `#!/usr/bin/env node
process.on("SIGTERM", () => {});
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "partial answer" }] } }));
setInterval(() => {}, 1000);
`;
	const scratch = await scratchRepo(talkThenWait);
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const id = onlyJobId(limen(scratch, "spawn", "wait").stdout);
	const jobDir = join(scratch.root, `.limen/jobs/${id}`);
	const seenBy = Date.now() + 5_000;
	while (Date.now() < seenBy) {
		if ((await readFile(join(jobDir, "log"), "utf8").catch(() => "")).includes("partial answer")) break;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	assert.match(await readFile(join(jobDir, "log"), "utf8"), /partial answer/);
	const stopped = limen(scratch, "stop", id, "test stop");
	assert.equal(stopped.status, 0, stopped.stderr);
	await waitForState(scratch.root, id, "stopped");
	assert.ok(Number.isFinite(Date.parse((await readFile(join(scratch.root, `.limen/jobs/${id}/finished-at`), "utf8")).trim())));
	await assert.rejects(readFile(join(scratch.root, `.limen/jobs/${id}/pid`)));
	await assert.rejects(readFile(join(scratch.root, `.limen/jobs/${id}/result`)), "stop must not fabricate a result file");
	await new Promise((resolve) => setTimeout(resolve, 1_100));
	await assert.rejects(readFile(join(scratch.root, `.limen/jobs/${id}/cleanup`)), "an ordinary in-group worker needs no cleanup warning");
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
