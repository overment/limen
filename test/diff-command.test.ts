import assert from "node:assert/strict";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { git, limen, limenWithEnv, onlyJobId, scratchRepo, waitForState } from "./scratch.ts";

test("diff resolves a pruned job and prints its exact recorded changeset", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const id = onlyJobId(limen(scratch, "spawn", "--label", "F050 fallback", "make commit").stdout);
	await waitForState(scratch.root, id, "done");
	assert.equal(limen(scratch, "prune").status, 0);
	const job = join(scratch.root, ".limen/jobs", id);
	const base = (await readFile(join(job, "base"), "utf8")).trim();
	const branch = (await readFile(join(job, "branch"), "utf8")).trim();
	assert.equal(git(scratch.root, "worktree", "list").includes(id), false);

	const shown = limen(scratch, "diff", "F050 fallback");
	assert.equal(shown.status, 0, shown.stderr);
	assert.equal(shown.stdout, `git diff ${base}...${branch}\n`);
});

test("diff does not launch hunk without a TTY and fresh jobs record its version", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const calls = join(scratch.root, "hunk-calls");
	const hunk = join(scratch.fakeBin, "hunk");
	await writeFile(
		hunk,
		`#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv[2] === "--version") console.log("0.20.0-test");
else fs.appendFileSync(${JSON.stringify(calls)}, process.argv.slice(2).join(" ") + "\\n");
`,
	);
	await chmod(hunk, 0o755);
	const env = { LIMEN_HUNK: hunk };
	const id = onlyJobId(limenWithEnv(scratch, env, "spawn", "--label", "F050 no tty", "make commit").stdout);
	await waitForState(scratch.root, id, "done");
	const job = join(scratch.root, ".limen/jobs", id);
	assert.match(await readFile(join(job, "versions"), "utf8"), /^pi 0\.0\.0-test\nhunk 0\.20\.0-test\n$/);

	const shown = limenWithEnv(scratch, env, "diff", id.slice(-8));
	assert.equal(shown.status, 0, shown.stderr);
	assert.match(shown.stdout, /^git diff \S+\.\.\.\S+\n$/);
	await assert.rejects(readFile(calls));
});

test("diff requires one job selector", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.match(limen(scratch, "diff").stderr, /diff requires exactly one job id/);
	assert.match(limen(scratch, "diff", "one", "two").stderr, /diff requires exactly one job id/);
});
