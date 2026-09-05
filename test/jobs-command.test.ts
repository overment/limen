import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { limen, limenWithEnv, onlyJobId, scratchRepo, waitForState, writeFakePi } from "./scratch.ts";

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
	const result = limen(scratch, "jobs", "--all");
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

test("jobs tails a rambling log and keeps the last limen detail line", async (context) => {
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
	await writeFile(join(job, "log"), `${noise}\n[limen 2026-08-13T00:00:00.000Z] start\n[limen 2026-08-13T00:00:01.000Z] failed: rambling\nlast line\n`);
	const result = limen(scratch, "jobs", "ramble");
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /FAILED ramble/);
	assert.match(result.stdout, /failed: rambling/);
	assert.match(result.stdout, /last line/);
	assert.doesNotMatch(result.stdout, /noise-0-/);
});

test("jobs detail shows result and commits for a terminal job that has them", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const job = join(scratch.root, ".limen/jobs/finished");
	await mkdir(job);
	await writeFile(join(job, "task.md"), "finish\n");
	await writeFile(join(job, "state"), "done\n");
	await writeFile(join(job, "label"), "F017 finished\n");
	await writeFile(join(job, "branch"), "main\n");
	await writeFile(join(job, "log"), "done\n");
	await writeFile(join(job, "commits"), "abc1234 the candidate\n");
	await writeFile(join(job, "result"), "final summary line\nsecond line\n");
	await writeFile(join(job, "stop-reason"), "error: usage limit reached\n");
	const detail = limen(scratch, "jobs", "finished");
	assert.equal(detail.status, 0, detail.stderr);
	assert.match(detail.stdout, /stop-reason:\n    error: usage limit reached/);
	assert.match(detail.stdout, /commits:\n    abc1234 the candidate/);
	assert.match(detail.stdout, /result:\n    final summary line\n    second line/);
	// The compact snapshot stays compact: no result or commits blocks there.
	await writeFile(join(job, "state"), "running\n");
	await writeFile(join(job, "activity"), "think\n");
	const snapshot = limen(scratch, "jobs");
	assert.equal(snapshot.status, 0, snapshot.stderr);
	assert.doesNotMatch(snapshot.stdout, /result:|commits:/);
});

test("jobs marks a terminal job with zero tool calls and no commits as produced nothing", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const root = join(scratch.root, ".limen/jobs");
	const empty = join(root, "empty");
	await mkdir(empty);
	await writeFile(join(empty, "task.md"), "empty\n");
	await writeFile(join(empty, "state"), "done\n");
	await writeFile(join(empty, "label"), "F011 empty\n");
	await writeFile(join(empty, "branch"), "limen/empty\n");
	await writeFile(join(empty, "log"), "[limen 2026-08-15T00:00:00.000Z] done: pi exited 0\n");
	await writeFile(join(empty, "tool-calls"), "0\n");
	await writeFile(join(empty, "commits"), "");
	await writeFile(join(empty, "stop-reason"), "error: usage limit reached\n");

	const snapshot = limen(scratch, "jobs");
	assert.equal(snapshot.status, 0, snapshot.stderr);
	assert.match(snapshot.stdout, /DONE F011 empty.*tools 0.*produced nothing \(0 tool calls, no commits\)/);
	assert.doesNotMatch(snapshot.stdout, /terminal job hidden/);
	const detail = limen(scratch, "jobs", "empty");
	assert.equal(detail.status, 0, detail.stderr);
	assert.match(detail.stdout, /DONE F011 empty.*tools 0.*produced nothing \(0 tool calls, no commits\)/);
	assert.match(detail.stdout, /stop-reason:\n    error: usage limit reached/);

	const survey = join(root, "survey");
	await mkdir(survey);
	for (const [name, value] of [
		["task.md", "survey\n"],
		["state", "done\n"],
		["label", "F011 survey\n"],
		["branch", "limen/survey\n"],
		["log", "surveyed\n"],
		["tool-calls", "1\n"],
		["commits", ""],
	] as const)
		await writeFile(join(survey, name), value);
	const surveyDetail = limen(scratch, "jobs", "survey");
	assert.equal(surveyDetail.status, 0, surveyDetail.stderr);
	assert.doesNotMatch(surveyDetail.stdout, /produced nothing/);
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
	const result = limen(scratch, "jobs", "--all");
	assert.equal(result.status, 0, result.stderr);
	const labels = [...result.stdout.matchAll(/^(?:RUNNING|DONE|STOPPED|FAILED) (.+?) ·/gm)].map((match) => match[1]);
	assert.deepEqual(labels, ["new run", "mid stop", "old done"]);
});

test("the default jobs snapshot stays compact and exposes every live job", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const root = join(scratch.root, ".limen/jobs");
	for (let index = 0; index < 40; index += 1) {
		const dir = join(root, `archived-${index}`);
		await mkdir(dir);
		await writeFile(join(dir, "task.md"), "x\n");
		await writeFile(join(dir, "state"), "done\n");
		await writeFile(join(dir, "label"), `archived-${index}\n`);
		await writeFile(join(dir, "branch"), "main\n");
		await writeFile(join(dir, "log"), `archive-${index}-${"x".repeat(8_192)}\n`);
	}
	const running = join(root, "live");
	await mkdir(running);
	await writeFile(join(running, "task.md"), "x\n");
	await writeFile(join(running, "state"), "running\n");
	await writeFile(join(running, "label"), `F005 live review ${"x".repeat(8_192)}\n`);
	await writeFile(join(running, "branch"), "limen/live\n");
	await writeFile(join(running, "activity"), "tool\n");
	await writeFile(join(running, "last-tool"), `${"tool".repeat(4_096)}\n`);
	await writeFile(join(running, "log"), "live log\n");
	for (const option of [undefined, "--running", "--active"] as const) {
		const result = option ? limen(scratch, "jobs", option) : limen(scratch, "jobs");
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /RUNNING F005 live review/);
		assert.match(result.stdout, /…/);
		assert.doesNotMatch(result.stdout, /archive-\d+/);
		assert.ok(Buffer.byteLength(result.stdout) < 1_024, "live snapshot must stay below tool-output limits");
		if (option) assert.doesNotMatch(result.stdout, /terminal jobs hidden/);
		else assert.match(result.stdout, /40 terminal jobs hidden/);
	}
});

test("compact snapshots cap malformed live diagnostics", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const job = join(scratch.root, ".limen/jobs/malformed-live");
	await mkdir(job);
	await writeFile(join(job, "task.md"), "x\n");
	await writeFile(join(job, "state"), "running\n");
	await writeFile(join(job, "label"), "F005 malformed live\n");
	await writeFile(join(job, "branch"), "limen/malformed\n");
	await writeFile(join(job, "tool-calls"), `${"x".repeat(8_192)}\n`);
	await writeFile(join(job, "log"), "x\n");
	const result = limen(scratch, "jobs");
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /INVALID malformed-live · invalid tool-calls/);
	assert.doesNotMatch(result.stdout, /x{200}/);
	assert.ok(Buffer.byteLength(result.stdout) < 1_024);
});

test("hosted jobs pulse follows activity, not Herdr unseen-idle", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const herdr = join(scratch.fakeBin, "herdr");
	await writeFile(
		herdr,
		`#!/usr/bin/env node
console.log(JSON.stringify({ result: { agent: { agent_status: "idle" } } }));
`,
	);
	await chmod(herdr, 0o755);
	const env = { HERDR_ENV: "1", LIMEN_HERDR: herdr };
	const job = join(scratch.root, ".limen/jobs/hosted-think");
	await mkdir(join(job, "herdr"), { recursive: true });
	await writeFile(join(job, "task.md"), "think\n");
	await writeFile(join(job, "state"), "running\n");
	await writeFile(join(job, "label"), "F038 hosted gen\n");
	await writeFile(join(job, "branch"), "limen/hosted-think\n");
	await writeFile(join(job, "log"), "think\n");
	await writeFile(join(job, "hosted"), "weaker guarantees\n");
	await writeFile(join(job, "pid"), "1\n");
	await writeFile(join(job, "herdr/agent"), "w1:p1\n");
	await writeFile(join(job, "activity"), "think\n");
	const thinking = limenWithEnv(scratch, env, "jobs");
	assert.equal(thinking.status, 0, thinking.stderr);
	assert.match(thinking.stdout, /RUNNING F038 hosted gen/);
	assert.match(thinking.stdout, / · think(?: ·|$)/);
	assert.doesNotMatch(thinking.stdout, / · wait(?: ·|$)/);
	await writeFile(join(job, "activity"), "tool\n");
	const tooling = limenWithEnv(scratch, env, "jobs");
	assert.match(tooling.stdout, / · tool(?: ·|$)/);
	await writeFile(join(job, "activity"), "wait\n");
	const waiting = limenWithEnv(scratch, env, "jobs");
	assert.match(waiting.stdout, / · wait(?: ·|$)/);
	await writeFile(join(job, "pid"), "");
	const handshake = limenWithEnv(scratch, env, "jobs");
	assert.match(handshake.stdout, /starting/);
});

test("jobs shows the advisory line on a running hosted job", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const job = join(scratch.root, ".limen/jobs/stalled");
	await mkdir(job);
	await writeFile(join(job, "task.md"), "stall\n");
	await writeFile(join(job, "state"), "running\n");
	await writeFile(join(job, "label"), "F027 stalled\n");
	await writeFile(join(job, "branch"), "limen/stalled\n");
	await writeFile(join(job, "log"), "wait\n");
	await writeFile(join(job, "activity"), "wait\n");
	await writeFile(join(job, "hosted"), "weaker guarantees\n");
	await writeFile(join(job, "advisory"), "idle 10m after 14 tool calls, session still open\n");
	const result = limen(scratch, "jobs");
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /RUNNING F027 stalled/);
	assert.match(result.stdout, /advisory idle 10m after 14 tool calls, session still open/);
});

test("jobs rejects ambiguous option shapes", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	for (const args of [["--missing"], ["--running", "extra"]]) {
		const result = limen(scratch, "jobs", ...args);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /jobs/);
	}
});

test("jobs names a directory with no state as an orphan", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const job = join(scratch.root, ".limen/jobs/half-written");
	await mkdir(job);
	const listed = limen(scratch, "jobs");
	assert.equal(listed.status, 0, listed.stderr);
	assert.match(listed.stdout, /ORPHAN half-written · no state/);
	const all = limen(scratch, "jobs", "--all");
	assert.match(all.stdout, /ORPHAN half-written · no state/);
});

test("jobs reports an empty set before init", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	const result = limen(scratch, "jobs");
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout, "no jobs\n");
});

test("a running job line shows the sampled changed-file count", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const job = join(scratch.root, ".limen/jobs/files");
	await mkdir(job);
	await writeFile(join(job, "task.md"), "edit\n");
	await writeFile(join(job, "state"), "running\n");
	await writeFile(join(job, "label"), "F079 files\n");
	await writeFile(join(job, "branch"), "limen/files\n");
	await writeFile(join(job, "log"), "think\n");
	await writeFile(join(job, "activity"), "think\n");
	await writeFile(join(job, "tool-calls"), "4\n");
	await writeFile(join(job, "changed-files"), "3\n");
	const dirty = limen(scratch, "jobs");
	assert.equal(dirty.status, 0, dirty.stderr);
	assert.match(dirty.stdout, /RUNNING F079 files/);
	assert.match(dirty.stdout, /tools 4 · files 3/);
	const human = limenWithEnv(scratch, { LIMEN_VIEW: "human" }, "jobs");
	assert.equal(human.status, 0, human.stderr);
	assert.match(human.stdout, /4 tools · 3 files/);
	await writeFile(join(job, "changed-files"), "0\n");
	const clean = limen(scratch, "jobs");
	assert.equal(clean.status, 0, clean.stderr);
	assert.match(clean.stdout, /tools 4 · files 0/);
	await rm(join(job, "changed-files"));
	const gone = limen(scratch, "jobs");
	assert.equal(gone.status, 0, gone.stderr);
	assert.doesNotMatch(gone.stdout, /files \d/);
	assert.doesNotMatch(gone.stderr, /changed-files|ENOENT|worktree/);
});

test("activity sampling records how many files the worktree has changed", async (context) => {
	const dirtyPi = `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
process.on("SIGTERM", () => process.exit(0));
writeFileSync("edited.txt", "hello\\n");
console.log(JSON.stringify({ type: "agent_start" }));
console.log(JSON.stringify({ type: "tool_execution_start", toolName: "bash", args: { command: "echo" } }));
setInterval(() => {}, 1000);
`;
	const cleanPi = `#!/usr/bin/env node
process.on("SIGTERM", () => process.exit(0));
console.log(JSON.stringify({ type: "agent_start" }));
console.log(JSON.stringify({ type: "tool_execution_start", toolName: "read", args: { path: "README.md" } }));
setInterval(() => {}, 1000);
`;
	const scratch = await scratchRepo(dirtyPi);
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const dirtyId = onlyJobId(limen(scratch, "spawn", "--label", "F079 dirty", "edit a file").stdout);
	await waitForRecordedCount(scratch.root, dirtyId, "1");
	const dirty = limen(scratch, "jobs");
	assert.equal(dirty.status, 0, dirty.stderr);
	assert.match(dirty.stdout, /RUNNING F079 dirty/);
	assert.match(dirty.stdout, /files 1/);
	limen(scratch, "stop", dirtyId, "sampled dirty");
	await waitForState(scratch.root, dirtyId, "stopped");
	await writeFakePi(scratch.fakeBin, cleanPi);
	const cleanId = onlyJobId(limen(scratch, "spawn", "--label", "F079 clean", "keep reading").stdout);
	await waitForRecordedCount(scratch.root, cleanId, "0");
	const clean = limen(scratch, "jobs");
	assert.equal(clean.status, 0, clean.stderr);
	assert.match(clean.stdout, /RUNNING F079 clean/);
	assert.match(clean.stdout, /files 0/);
	limen(scratch, "stop", cleanId, "sampled clean");
	await waitForState(scratch.root, cleanId, "stopped");
});

async function waitForRecordedCount(root: string, id: string, expected: string): Promise<void> {
	const path = join(root, ".limen/jobs", id, "changed-files");
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		const value = await readFile(path, "utf8").then(
			(text) => text.trim(),
			() => "",
		);
		if (value === expected) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`job ${id} did not record changed-files ${JSON.stringify(expected)}`);
}
