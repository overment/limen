import assert from "node:assert/strict";
import test from "node:test";
import { derivePulse, parseDuration, parseJob, renderJob, resolveJobId } from "../src/job.ts";

test("duration parsing is explicit and bounded", () => {
	assert.equal(parseDuration("500ms"), 500);
	assert.equal(parseDuration("90s"), 90_000);
	assert.equal(parseDuration("20m"), 1_200_000);
	assert.equal(parseDuration("2h"), 7_200_000);
	assert.throws(() => parseDuration("20"), /invalid timeout/);
	assert.throws(() => parseDuration("0s"), /positive/);
	assert.throws(() => parseDuration("999999h"), /maximum/);
});

test("jobs use one discriminated union and derived display facts", () => {
	const now = new Date();
	const job = parseJob({
		id: "x",
		state: "running",
		label: "F001 implementation",
		branch: "control/x",
		pid: "42",
		startedAt: now,
		lastOutputAt: now,
		detail: "",
	});
	assert.equal(job.phase, "running");
	assert.match(
		renderJob(job, {
			elapsedMs: 65_000,
			silentMs: 2_000,
			toolCalls: 7,
			lastTool: "bash",
			pulse: "dead",
			processAlive: false,
			diffstat: "one file changed",
			logTail: "hello",
		}),
		/RUNNING F001 implementation.*id x.*elapsed 1m.*dead · tools 7 · bash.*pid 42 \(not alive\)/,
	);
	assert.throws(
		() =>
			parseJob({
				id: "x",
				state: "stalled",
				label: "bad",
				branch: "b",
				startedAt: now,
				lastOutputAt: now,
				detail: "",
			}),
		/unknown state/,
	);
});

test("pulse is observed activity and liveness, never a timer", () => {
	assert.equal(derivePulse({ alive: true }), "starting");
	assert.equal(derivePulse({ pid: 1, alive: false, activity: "tool" }), "dead");
	assert.equal(derivePulse({ pid: 1, alive: true, activity: "tool" }), "tool");
	assert.equal(derivePulse({ pid: 1, alive: true, activity: "wait" }), "wait");
	// Thresholds 20_000 / 45_000 / 120_000 must match hook/wake.ts.
	assert.equal(derivePulse({ pid: 1, alive: true }), "think");
});

test("a running job with no pid is the handshake, not invalid", () => {
	const now = new Date();
	const job = parseJob({
		id: "x",
		state: "running",
		label: "F001 implementation",
		branch: "control/x",
		startedAt: now,
		lastOutputAt: now,
		detail: "",
	});
	assert.equal(job.phase, "running");
	assert.equal(job.pid, undefined);
	assert.match(
		renderJob(job, { elapsedMs: 400, silentMs: 0, pulse: "starting", diffstat: "", logTail: "" }),
		/starting/,
	);
	assert.doesNotMatch(
		renderJob(job, { elapsedMs: 400, silentMs: 0, pulse: "starting", diffstat: "", logTail: "" }),
		/pid /,
	);
});

test("job ids resolve uniquely by suffix or label", () => {
	const ids = ["2026-08-13-f001-implementation-7a2f", "2026-08-13-f001-review-d482"];
	const labels = {
		"2026-08-13-f001-implementation-7a2f": "F001 implementation",
		"2026-08-13-f001-review-d482": "F001 review",
	};
	assert.equal(resolveJobId("7a2f", ids, labels), "2026-08-13-f001-implementation-7a2f");
	assert.equal(resolveJobId("F001 review", ids, labels), "2026-08-13-f001-review-d482");
	assert.throws(() => resolveJobId("F001", ids, labels), /ambiguous/);
	assert.throws(() => resolveJobId("ab", ids, labels), /no job matches/);
	assert.throws(() => resolveJobId("missing", ids, labels), /no job matches/);
});
