import assert from "node:assert/strict";
import { readFile, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { changedFileCount, cleanWorktree } from "../src/git.ts";
import { scratchRepo } from "./scratch.ts";

for (const probe of [cleanWorktree, changedFileCount]) {
	test(`${probe.name} observes changes without refreshing the worker's index`, async (context) => {
		const scratch = await scratchRepo();
		context.after(scratch.cleanup);
		const index = join(scratch.root, ".git/index");
		const before = await readFile(index);
		// Stale stat data makes ordinary git status take an optional index lock and
		// rewrite the index, racing the worker's git add/commit even on a clean tree.
		const old = new Date("2000-01-01T00:00:00Z");
		await utimes(join(scratch.root, "README.md"), old, old);
		assert.equal(probe(scratch.root), probe === cleanWorktree ? true : 0);
		assert.deepEqual(await readFile(index), before, "background status must not refresh the index");
		await writeFile(join(scratch.root, "README.md"), "changed\n");
		await writeFile(join(scratch.root, "untracked.md"), "new\n");
		assert.equal(probe(scratch.root), probe === cleanWorktree ? false : 2);
		assert.deepEqual(await readFile(index), before);
	});
}
