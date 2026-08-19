import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { liveJob, processInfo, reapDeadJobs, STARTUP_GRACE_MS } from "../src/proc.ts";
import { git, limen, limenWithEnv, onlyJobId, scratchRepo, waitForState } from "./scratch.ts";

const DEAD_PID = 999_999_999;
const livePi = `#!/usr/bin/env node
process.on("SIGTERM", () => process.exit(0));
setInterval(() => {}, 1000);
`;

test("recycled pgids cannot fake life when born mismatches", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
	context.after(() => {
		if (!child.pid) return;
		try {
			process.kill(-child.pid, "SIGKILL");
		} catch {
			// Already gone.
		}
	});
	assert.ok(child.pid);
	child.unref();
	const job = await writeRunning(scratch.root, "identity", { pid: child.pid, startedMsAgo: 60_000 });
	assert.equal(await liveJob(job), true, "a live group with no birth file is alive");
	await writeFile(join(job, "born"), "0.000000\n");
	if (process.platform === "darwin") {
		assert.equal(await liveJob(job), false);
		const info = await processInfo(child.pid);
		assert.equal(info.kind, "present");
		if (info.kind === "present") await writeFile(join(job, "born"), `${info.process.born}\n`);
		assert.equal(await liveJob(job), true);
	} else {
		assert.equal(await liveJob(job), true, "without a readable birth identity the group check alone decides");
	}
});

test("two observations past grace finalize; one observation and the grace window do not", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const jobsRoot = join(scratch.root, ".limen/jobs");
	const young = await writeRunning(scratch.root, "young", { pid: DEAD_PID, startedMsAgo: 60_000 });
	const gone = await writeRunning(scratch.root, "gone", { pid: DEAD_PID, startedMsAgo: STARTUP_GRACE_MS + 60_000 });
	const seen = new Map<string, number>();
	const t0 = Date.now();
	await reapDeadJobs(jobsRoot, seen, t0);
	assert.equal(await text(join(young, "state")), "running");
	assert.equal(await text(join(gone, "state")), "running");
	assert.equal(seen.has("young"), false);
	assert.equal(seen.get("gone"), t0);
	await reapDeadJobs(jobsRoot, seen, t0 + 9_000);
	assert.equal(await text(join(gone, "state")), "running");
	await reapDeadJobs(jobsRoot, seen, t0 + 10_000);
	assert.equal(await text(join(gone, "state")), "failed");
	assert.equal(await text(join(young, "state")), "running");
	assert.match(await text(join(gone, "log")), /failed: process group gone/);
	assert.equal(seen.size, 0);
	await assert.rejects(readFile(join(gone, "pid")));
});

test("limen jobs reaps a dead record, then spawn and prune may use the branch", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const id = "2026-08-19-f025-reap-aaaaaaaa";
	const worktreeRoot = join(dirname(scratch.root), `.${basename(scratch.root)}-limen-worktrees`);
	await mkdir(worktreeRoot, { recursive: true });
	const worktree = join(worktreeRoot, id);
	git(scratch.root, "branch", "limen/reaped");
	git(scratch.root, "worktree", "add", "--detach", worktree, "limen/reaped");
	await writeRunning(scratch.root, id, {
		pid: DEAD_PID,
		startedMsAgo: STARTUP_GRACE_MS + 60_000,
		branch: "limen/reaped",
		worktree,
	});
	const listed = limenWithEnv(scratch, { LIMEN_REAP_CONFIRM_MS: "30" }, "jobs", id);
	assert.equal(listed.status, 0, listed.stderr);
	assert.match(listed.stdout, /FAILED/);
	assert.match(listed.stdout, /process group gone/);
	assert.equal(await text(join(scratch.root, ".limen/jobs", id, "state")), "failed");
	assert.equal(limen(scratch, "prune").status, 0);
	await assert.rejects(readFile(join(worktree, ".git")));
	const spawned = limen(scratch, "spawn", "--branch", "limen/reaped", "continue");
	assert.equal(spawned.status, 0, spawned.stderr);
	await waitForState(scratch.root, onlyJobId(spawned.stdout), "done");
});

test("a hosted job with a live agent is not reaped when the supervisor is gone", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const herdr = await writeFakeHerdr(scratch.fakeBin, "working");
	const previous = process.env.LIMEN_HERDR;
	process.env.LIMEN_HERDR = herdr;
	context.after(() => {
		if (previous === undefined) delete process.env.LIMEN_HERDR;
		else process.env.LIMEN_HERDR = previous;
	});
	const job = await writeRunning(scratch.root, "hosted-live", {
		pid: DEAD_PID,
		startedMsAgo: STARTUP_GRACE_MS + 60_000,
		hosted: true,
		agent: "w1:p1",
	});
	assert.equal(await liveJob(job), true);
	const listed = limenWithEnv(scratch, { LIMEN_HERDR: herdr, LIMEN_REAP_CONFIRM_MS: "30" }, "jobs");
	assert.equal(listed.status, 0, listed.stderr);
	assert.match(listed.stdout, /RUNNING/);
	assert.equal(await text(join(job, "state")), "running");
});

test("a reaped hosted job keeps the session jsonl handoff", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const herdr = await writeFakeHerdr(scratch.fakeBin, "missing");
	const job = await writeRunning(scratch.root, "hosted-gone", {
		pid: DEAD_PID,
		startedMsAgo: STARTUP_GRACE_MS + 60_000,
		hosted: true,
		agent: "w1:p1",
	});
	await mkdir(join(job, "session"), { recursive: true });
	await writeFile(
		join(job, "session", "2026-08-19.jsonl"),
		`${JSON.stringify({
			type: "message",
			message: { role: "assistant", content: [{ type: "text", text: "worker final" }], stopReason: "error", errorMessage: "usage limit reached" },
		})}\n`,
	);
	assert.equal(await liveJob(job), false);
	const listed = limenWithEnv(scratch, { LIMEN_HERDR: herdr, LIMEN_REAP_CONFIRM_MS: "30" }, "jobs", "hosted-gone");
	assert.equal(listed.status, 0, listed.stderr);
	assert.match(listed.stdout, /FAILED/);
	assert.match(listed.stdout, /process group gone/);
	assert.equal(await text(join(job, "result")), "worker final");
	assert.equal(await text(join(job, "stop-reason")), "error: usage limit reached");
	assert.match(listed.stdout, /result:\n    worker final/);
	assert.match(listed.stdout, /stop-reason:\n    error: usage limit reached/);
});

test("handshake records wrapper birth on macOS", async (context) => {
	const scratch = await scratchRepo(livePi);
	context.after(scratch.cleanup);
	limen(scratch, "init");
	let id = "";
	context.after(() => {
		if (id) limen(scratch, "stop", id);
	});
	const launched = limen(scratch, "spawn", "--label", "F025 live", "stay up");
	assert.equal(launched.status, 0, launched.stderr);
	id = onlyJobId(launched.stdout);
	const job = join(scratch.root, ".limen/jobs", id);
	await waitForFile(join(job, "pid"));
	if (process.platform === "darwin") {
		await waitForFile(join(job, "born"));
		const born = await text(join(job, "born"));
		assert.match(born, /^\d+\.\d{6}$/);
		const pid = Number(await text(join(job, "pid")));
		const info = await processInfo(pid);
		assert.equal(info.kind, "present");
		if (info.kind === "present") assert.equal(info.process.born, born);
	} else {
		await assert.rejects(readFile(join(job, "born")));
	}
	const stopped = limen(scratch, "stop", id);
	assert.equal(stopped.status, 0, stopped.stderr);
	id = "";
});

async function writeRunning(
	root: string,
	id: string,
	input: { readonly pid: number; readonly startedMsAgo: number; readonly branch?: string; readonly worktree?: string; readonly hosted?: boolean; readonly agent?: string },
): Promise<string> {
	const job = join(root, ".limen/jobs", id);
	await mkdir(join(job, "herdr"), { recursive: true });
	await writeFile(join(job, "task.md"), "reap\n");
	await writeFile(join(job, "log"), "");
	await writeFile(join(job, "label"), `${id}\n`);
	await writeFile(join(job, "branch"), `${input.branch ?? "main"}\n`);
	if (input.worktree) await writeFile(join(job, "worktree"), `${input.worktree}\n`);
	await writeFile(join(job, "pid"), `${input.pid}\n`);
	await writeFile(join(job, "started-at"), `${new Date(Date.now() - input.startedMsAgo).toISOString()}\n`);
	await writeFile(join(job, "activity"), "think\n");
	if (input.hosted) await writeFile(join(job, "hosted"), "hosted\n");
	if (input.agent) await writeFile(join(job, "herdr/agent"), `${input.agent}\n`);
	await writeFile(join(job, "state"), "running\n");
	return job;
}

async function writeFakeHerdr(fakeBin: string, status: "working" | "missing"): Promise<string> {
	const bin = join(fakeBin, "herdr");
	await writeFile(
		bin,
		`#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "agent" && args[1] === "get") {
  if (${JSON.stringify(status)} === "missing") {
    console.log(JSON.stringify({ error: { code: "agent_not_found", message: "missing" } }));
    process.exit(1);
  }
  console.log(JSON.stringify({ result: { type: "agent_info", agent: { agent_status: "working", pane_id: args[2] } } }));
} else console.log(JSON.stringify({ result: {} }));
`,
	);
	await chmod(bin, 0o755);
	return bin;
}

function text(path: string): Promise<string> {
	return readFile(path, "utf8").then((value) => value.trim());
}
async function waitForFile(path: string): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		const value = await readFile(path, "utf8").then(
			(text) => text.trim(),
			() => "",
		);
		if (value) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`missing ${path}`);
}
