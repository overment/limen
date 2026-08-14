import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { limen, scratchRepo } from "./scratch.ts";

test("init fills gaps, preserves existing bytes, and ignores runtime state once", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	await writeFile(join(scratch.root, "AGENTS.md"), "mine-no-newline");
	await writeFile(join(scratch.root, ".gitignore"), "dist/");
	const first = limen(scratch, "init");
	assert.equal(first.status, 0, first.stderr);
	assert.equal(await readFile(join(scratch.root, "AGENTS.md"), "utf8"), "mine-no-newline");
	assert.equal(await readFile(join(scratch.root, ".gitignore"), "utf8"), "dist/\n/.limen/\n");
	assert.match(await readFile(join(scratch.root, "spec/vision.md"), "utf8"), /Human-owned/);
	assert.match(await readFile(join(scratch.root, "spec/vision.md"), "utf8"), /Product principles/);
	assert.match(await readFile(join(scratch.root, "spec/build.md"), "utf8"), /## TRACK/);
	assert.match(await readFile(join(scratch.root, "spec/build.md"), "utf8"), /## PROVEN/);
	assert.match(await readFile(join(scratch.root, ".agents/limen/reviewer.md"), "utf8"), /do not rewrite/i);
	assert.match(await readFile(join(scratch.root, ".agents/limen/worker.md"), "utf8"), /You implement the coordinator's instruction/);
	assert.match(await readFile(join(scratch.root, "spec/features/_template/ticket.md"), "utf8"), /FNNN/);
	assert.match(await readFile(join(scratch.root, "spec/features/_template/outcome.md"), "utf8"), /## Result/);
	for (const lane of ["planned", "active", "done", "dropped"]) {
		await access(join(scratch.root, "spec/features", lane));
	}
	const wake = await readFile(join(scratch.root, ".pi/extensions/limen-wake.ts"), "utf8");
	assert.match(wake, /sendUserMessage/);
	assert.match(wake, /deliverAs: "steer"/);
	const communication = await readFile(join(scratch.root, ".pi/extensions/limen-communication.ts"), "utf8");
	assert.match(communication, /before_agent_start/);
	assert.match(communication, /buildContextEntries/);
	const prompt = await readFile(join(scratch.root, ".agents/limen/communication.md"), "utf8");
	assert.match(prompt, /concise completeness/);
	assert.match(prompt, /broad purpose/);
	assert.match(prompt, /distinct objectives/);
	assert.match(prompt, /artifacts\//);
	await writeFile(join(scratch.root, "spec/build.md"), "custom bytes\0allowed");
	const second = limen(scratch, "init");
	assert.equal(second.status, 0, second.stderr);
	assert.equal(await readFile(join(scratch.root, "spec/build.md"), "utf8"), "custom bytes\0allowed");
	assert.equal((await readFile(join(scratch.root, ".gitignore"), "utf8")).match(/\.limen\//g)?.length, 1);
	await writeFile(join(scratch.root, ".gitignore"), "/.limen/\n!/.limen/\n");
	limen(scratch, "init");
	assert.equal(await readFile(join(scratch.root, ".gitignore"), "utf8"), "/.limen/\n!/.limen/\n/.limen/\n");
});
