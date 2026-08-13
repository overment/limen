import assert from "node:assert/strict";
import test from "node:test";
import { parseDuration, parseJob, renderJob } from "../src/job.ts";

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
			processAlive: false,
			diffstat: "one file changed",
			logTail: "hello",
		}),
		/RUNNING F001 implementation.*id x.*elapsed 1m.*pid 42 \(not alive\)/,
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
