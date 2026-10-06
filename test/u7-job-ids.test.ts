// U7: every command that takes a job resolves it here, and every spawn names and bounds its job here.
// A query must resolve to exactly one job or to none; a timeout must be explicit and fit Node's timer.
import assert from "node:assert/strict";
import test from "node:test";
import { makeJobId, parseDuration, resolveJobId } from "../src/job/job.ts";

test("a job resolves by full id, id suffix, exact label or label prefix, and only when one job matches", () => {
	const ids = [
		"2026-08-13-f001-implementation-7a2f0b1c",
		"2026-08-13-f001-review-d4821e3f",
		"2026-08-14-f002-fix-0000aaaa",
	];
	const labels = {
		[ids[0] as string]: "F001 implementation",
		[ids[1] as string]: "F001 review",
		[ids[2] as string]: "F002",
	};
	const resolves: ReadonlyArray<readonly [string, string]> = [
		[ids[1] as string, ids[1] as string],
		["7a2f0b1c", ids[0] as string],
		["review-d4821e3f", ids[1] as string],
		["F001 review", ids[1] as string],
		["f001 impl", ids[0] as string],
		["F002", ids[2] as string],
	];
	for (const [query, id] of resolves) {
		assert.equal(resolveJobId(query, ids, labels), id, query);
	}
	for (const query of ["F001", "2026-08-1", "ab", "1c", "missing", "  "]) {
		assert.throws(() => resolveJobId(query, ids, labels), query);
	}
});

test("a job id hoists the feature number, keeps a bounded slug, and ends in a random suffix", () => {
	const shape = /^\d{4}-\d{2}-\d{2}-([a-z0-9-]+)-[0-9a-f]{8}$/;
	const slug = (label: string) => shape.exec(makeJobId(label))?.[1];
	assert.equal(slug("Review F927 candidate"), "f927-review-candidate");
	assert.equal(slug("!!!"), "job");
	const long = slug("an extremely long label that keeps going well past the slug bound");
	assert.ok(long && long.length <= 32 && !long.endsWith("-"), long);
	assert.notEqual(makeJobId("same"), makeJobId("same"));
});

test("a timeout needs a unit, is positive, and fits Node's maximum timer", () => {
	const valid: ReadonlyArray<readonly [string, number]> = [
		["500ms", 500],
		["90s", 90_000],
		["20m", 1_200_000],
		["2h", 7_200_000],
		["596h", 2_145_600_000],
	];
	for (const [value, ms] of valid) {
		assert.equal(parseDuration(value), ms, value);
	}
	for (const value of ["20", "0s", "-1m", "1.5h", "597h", "999999999999999999h", "1d", ""]) {
		assert.throws(() => parseDuration(value), value);
	}
});
