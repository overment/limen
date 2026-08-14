import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { limen, scratchRepo, scratchWorkspace } from "./scratch.ts";

test("init refuses a non-Git directory with guidance", async (context) => {
	const workspace = await scratchWorkspace();
	context.after(workspace.cleanup);
	const result = limen(workspace, "init");
	assert.equal(result.status, 1);
	assert.match(result.stderr, /requires a Git repository/);
	assert.match(result.stderr, /limen workspace init/);
});

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
	assert.match(wake, /getSessionId/);
	assert.match(wake, /claimDelivery/);
	const communication = await readFile(join(scratch.root, ".pi/extensions/limen-communication.ts"), "utf8");
	assert.match(communication, /before_agent_start/);
	assert.match(communication, /limen-project-context/);
	assert.match(communication, /styleguide\.md/);
	assert.match(communication, /spec\/build\.md/);
	const styleguide = await readFile(join(scratch.root, ".agents/limen/styleguide.md"), "utf8");
	assert.match(styleguide, /Current human request/);
	assert.match(styleguide, /1000 lines/);
	await assert.rejects(access(join(scratch.root, ".agents/limen/communication.md")));
	await writeFile(join(scratch.root, "spec/build.md"), "custom bytes\0allowed");
	const second = limen(scratch, "init");
	assert.equal(second.status, 0, second.stderr);
	assert.equal(await readFile(join(scratch.root, "spec/build.md"), "utf8"), "custom bytes\0allowed");
	assert.equal((await readFile(join(scratch.root, ".gitignore"), "utf8")).match(/\.limen\//g)?.length, 1);
	await writeFile(join(scratch.root, ".gitignore"), "/.limen/\n!/.limen/\n");
	limen(scratch, "init");
	assert.equal(await readFile(join(scratch.root, ".gitignore"), "utf8"), "/.limen/\n!/.limen/\n/.limen/\n");
});
