import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { control, scratchRepo } from "./scratch.ts";

test("init fills gaps, preserves existing bytes, and ignores runtime state once", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	await writeFile(join(scratch.root, "AGENTS.md"), "mine-no-newline");
	await writeFile(join(scratch.root, ".gitignore"), "dist/");
	const first = control(scratch, "init");
	assert.equal(first.status, 0, first.stderr);
	assert.equal(await readFile(join(scratch.root, "AGENTS.md"), "utf8"), "mine-no-newline");
	assert.equal(await readFile(join(scratch.root, ".gitignore"), "utf8"), "dist/\n/.control/\n");
	assert.match(await readFile(join(scratch.root, "spec/vision.md"), "utf8"), /Human-owned/);
	assert.match(await readFile(join(scratch.root, ".agents/control/reviewer.md"), "utf8"), /do not rewrite/i);
	assert.match(await readFile(join(scratch.root, ".pi/extensions/control-wake.ts"), "utf8"), /sendUserMessage/);
	await writeFile(join(scratch.root, "spec/build.md"), "custom bytes\0allowed");
	const second = control(scratch, "init");
	assert.equal(second.status, 0, second.stderr);
	assert.equal(await readFile(join(scratch.root, "spec/build.md"), "utf8"), "custom bytes\0allowed");
	assert.equal((await readFile(join(scratch.root, ".gitignore"), "utf8")).match(/\.control\//g)?.length, 1);
});
