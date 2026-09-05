import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { parseJob } from "../src/job.ts";
import { colorWanted, formatAge, humanDetail, humanRow, humanSnapshot, type JobRecord, paintWhen, renderLogTail, resolveView, tallyStates } from "../src/view.ts";
import { limen, limenWithEnv, scratchRepo } from "./scratch.ts";

const plain = paintWhen(false);
const now = new Date();
function record(state: string, extra: Partial<JobRecord> & { readonly detail?: string } = {}): JobRecord {
	const job = parseJob({
		id: "2026-08-31-f051-readable-jobs-ab12cd34",
		state,
		label: "F051 readable jobs",
		branch: "limen/2026-08-31-f051-readable-jobs-ab12cd34",
		...(state === "running" ? { pid: "42" } : {}),
		startedAt: now,
		lastOutputAt: now,
		detail: extra.detail ?? "",
	});
	const { detail: _detail, ...rest } = extra;
	return { id: job.id, job, ...rest };
}

test("a running human row is glyph, label, suffix, then live facts", () => {
	const row = humanRow(record("running", { pulse: "tool", lastTool: "bash", toolCalls: 24, elapsedMs: 720_000, silentMs: 3_000 }), 20, plain);
	assert.equal(row, `● ${"F051 readable jobs".padEnd(20)}  ${"ab12cd34".padEnd(12)}  12m · bash · 24 tools`);
});

test("a running human row names how many files the job has changed", () => {
	const dirty = humanRow(record("running", { pulse: "tool", lastTool: "bash", toolCalls: 24, changedFiles: 3, elapsedMs: 720_000, silentMs: 3_000 }), 20, plain);
	assert.equal(dirty, `● ${"F051 readable jobs".padEnd(20)}  ${"ab12cd34".padEnd(12)}  12m · bash · 24 tools · 3 files`);
	const clean = humanRow(record("running", { pulse: "think", toolCalls: 4, changedFiles: 0, elapsedMs: 60_000, silentMs: 0 }), 20, plain);
	assert.equal(clean, `● ${"F051 readable jobs".padEnd(20)}  ${"ab12cd34".padEnd(12)}  1m · think · 4 tools · 0 files`);
	const missing = humanRow(record("running", { pulse: "think", toolCalls: 4, elapsedMs: 60_000, silentMs: 0 }), 20, plain);
	assert.equal(missing, `● ${"F051 readable jobs".padEnd(20)}  ${"ab12cd34".padEnd(12)}  1m · think · 4 tools`);
});

test("a terminal human row carries age, duration, work, and flags once each", () => {
	const done = humanRow(record("done", { toolCalls: 82, commitCount: 1, elapsedMs: 2_040_000, ageMs: 4 * 86_400_000, hosted: true }), 20, plain);
	assert.equal(done, `✓ ${"F051 readable jobs".padEnd(20)}  ${"ab12cd34".padEnd(12)}  4d ago · 34m · 82 tools · 1 commit · hosted`);
	const failed = humanRow(
		record("failed", { detail: "see log", producedNothing: true, toolCalls: 0, elapsedMs: 120_000, ageMs: 60_000, reason: "error: usage limit reached", candidate: "abc" }),
		20,
		plain,
	);
	assert.equal(failed, `✗ ${"F051 readable jobs".padEnd(20)}  ${"ab12cd34".padEnd(12)}  1m ago · 2m · nothing · error: usage limit reached · review`);
	assert.doesNotMatch(failed, /produced nothing \(/);
	assert.doesNotMatch(`${done}\n${failed}`, / id | branch |limen\//);
});

test("silence colors only when it means something", () => {
	const paint = paintWhen(true);
	const quiet = humanRow(record("running", { pulse: "think", elapsedMs: 60_000, silentMs: 3_000 }), 20, paint);
	assert.doesNotMatch(quiet, /silent/);
	assert.match(humanRow(record("running", { pulse: "think", elapsedMs: 60_000, silentMs: 120_000 }), 20, paint), /\u001b\[33msilent 2m\u001b\[0m/);
	assert.match(humanRow(record("running", { pulse: "think", elapsedMs: 60_000, silentMs: 360_000 }), 20, paint), /\u001b\[31msilent 6m\u001b\[0m/);
});

test("the cabinet line counts states and names odd ones invalid", () => {
	const states = ["running", ...Array.from({ length: 78 }, () => "done"), "failed", "failed", "stopped", "mystery"];
	const snapshot = humanSnapshot([record("running", { pulse: "think", elapsedMs: 1_000, silentMs: 0 })], tallyStates(states), true, plain);
	assert.equal(snapshot.split("\n").at(-1), "83 jobs · 1 running · 78 done · 2 failed · 1 stopped · 1 invalid · limen jobs --all");
});

test("human detail sections identity, work, and a filtered log", () => {
	const detail = humanDetail(
		record("done", {
			toolCalls: 82,
			commitCount: 1,
			elapsedMs: 2_040_000,
			ageMs: 4 * 86_400_000,
			hosted: true,
			versions: "pi 0.84.3\nherdr herdr 0.8.2",
			commits: "9e7e231 Move hosted startup into supervisor",
			result: "Exited.",
			logTail:
				"think\nbash\nwait\n[limen 2026-08-27T10:41:51.598Z] advisory: idle 1m after 82 tool calls, session still open\n[limen 2026-08-27T10:43:01.393Z] done: hosted session ended",
		}),
		plain,
	);
	assert.equal(detail.split("\n")[0], "✓ F051 readable jobs · done · hosted");
	assert.match(detail, new RegExp(`^  ${"id".padEnd(11)} 2026-08-31-f051-readable-jobs-ab12cd34$`, "m"));
	assert.match(detail, new RegExp(`^  ${"branch".padEnd(11)} limen/2026-08-31-f051-readable-jobs-ab12cd34$`, "m"));
	assert.match(detail, new RegExp(`^  ${"ran".padEnd(11)} 34m · 82 tools · 1 commit · finished 4d ago$`, "m"));
	assert.match(detail, new RegExp(`^  ${"versions".padEnd(11)} pi 0.84.3\\n {14}herdr herdr 0.8.2$`, "m"));
	assert.match(detail, new RegExp(`^  ${"log".padEnd(11)} \\d\\d:\\d\\d:\\d\\d advisory: idle 1m after 82 tool calls, session still open$`, "m"));
	assert.match(detail, /^ {14}\d\d:\d\d:\d\d done: hosted session ended$/m);
	assert.doesNotMatch(detail, /^\s*(think|bash|wait)\s*$/m);
});

test("the log filter keeps events and prose, drops activity beats", () => {
	const rendered = renderLogTail("…\nthink\nbash npm run check\nwait\nAll 24 checks passed.\n[limen 2026-08-27T10:43:01.393Z] done: pi exited 0", plain);
	const lines = rendered.split("\n");
	assert.equal(lines.length, 3);
	assert.equal(lines[0], "bash npm run check");
	assert.equal(lines[1], "All 24 checks passed.");
	assert.match(lines[2] ?? "", /^\d\d:\d\d:\d\d done: pi exited 0$/);
});

test("view selection follows LIMEN_VIEW, then the TTY; color needs a willing terminal", () => {
	assert.equal(resolveView(undefined, true), "human");
	assert.equal(resolveView(undefined, false), "compact");
	assert.equal(resolveView("compact", true), "compact");
	assert.equal(resolveView("human", false), "human");
	assert.equal(colorWanted(true, undefined, "xterm-256color"), true);
	assert.equal(colorWanted(false, undefined, "xterm-256color"), false);
	assert.equal(colorWanted(true, "1", "xterm-256color"), false);
	assert.equal(colorWanted(true, undefined, "dumb"), false);
});

test("ages read like a human said them", () => {
	assert.equal(formatAge(20_000), "just now");
	assert.equal(formatAge(180_000), "3m ago");
	assert.equal(formatAge(7_200_000), "2h ago");
	assert.equal(formatAge(4 * 86_400_000), "4d ago");
});

test("the human snapshot prints rows and a footer, never id chains, and the suffix resolves", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const root = join(scratch.root, ".limen/jobs");
	const done = join(root, "2026-08-31-demo-work-abc123de");
	await mkdir(done);
	await writeFile(join(done, "task.md"), "work\n");
	await writeFile(join(done, "state"), "done\n");
	await writeFile(join(done, "label"), "F051 demo work\n");
	await writeFile(join(done, "branch"), "limen/2026-08-31-demo-work-abc123de\n");
	await writeFile(join(done, "started-at"), "2026-08-31T10:00:00.000Z\n");
	await writeFile(join(done, "finished-at"), "2026-08-31T10:05:00.000Z\n");
	await writeFile(join(done, "tool-calls"), "0\n");
	await writeFile(join(done, "commits"), "");
	await writeFile(join(done, "log"), "think\n[limen 2026-08-31T10:05:00.000Z] done: pi exited 0\n");
	const human = limenWithEnv(scratch, { LIMEN_VIEW: "human" }, "jobs");
	assert.equal(human.status, 0, human.stderr);
	assert.match(human.stdout, /✓ F051 demo work\s+abc123de\s+.*5m · nothing/);
	assert.doesNotMatch(human.stdout, /done: pi exited 0/);
	assert.match(human.stdout, /1 job · 1 done/);
	assert.doesNotMatch(human.stdout, / id | branch |limen\/|produced nothing \(|silent 0s|\u001b/);
	const bySuffix = limenWithEnv(scratch, { LIMEN_VIEW: "human" }, "jobs", "abc123de");
	assert.equal(bySuffix.status, 0, bySuffix.stderr);
	assert.match(bySuffix.stdout, new RegExp(`^  ${"id".padEnd(11)} 2026-08-31-demo-work-abc123de$`, "m"));
	assert.match(bySuffix.stdout, new RegExp(`^  ${"ran".padEnd(11)} 5m · nothing · finished`, "m"));
	const compact = limen(scratch, "jobs");
	assert.match(compact.stdout, /DONE F051 demo work · id 2026-08-31-demo-work-abc123de .* produced nothing \(0 tool calls, no commits\)/);
});

test("an odd state renders a red-glyph row and an invalid count without rewriting the file", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const job = join(scratch.root, ".limen/jobs/manual");
	await mkdir(job);
	await writeFile(join(job, "task.md"), "manual\n");
	await writeFile(join(job, "state"), "mystery\n");
	await writeFile(join(job, "branch"), "main\n");
	await writeFile(join(job, "log"), "plain log\n");
	const result = limenWithEnv(scratch, { LIMEN_VIEW: "human" }, "jobs", "--all");
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /! manual\s+job manual has unknown state "mystery"/);
	assert.match(result.stdout, /1 job · 1 invalid/);
	assert.equal(await import("node:fs/promises").then(({ readFile }) => readFile(join(job, "state"), "utf8")), "mystery\n");
});
