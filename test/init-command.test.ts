import assert from "node:assert/strict";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { limen, scratchRepo, scratchWorkspace } from "./scratch.ts";

const ROOT = new URL("..", import.meta.url).pathname;

test("init refuses a non-Git directory with guidance", async (context) => {
	const workspace = await scratchWorkspace();
	context.after(workspace.cleanup);
	const result = limen(workspace, "init");
	assert.equal(result.status, 1);
	assert.match(result.stderr, /requires a Git repository/);
	assert.match(result.stderr, /limen workspace init/);
});

test("init plants project-owned files and a hook stub, never role or hook copies", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	await writeFile(join(scratch.root, "AGENTS.md"), "mine-no-newline");
	await writeFile(join(scratch.root, ".gitignore"), "dist/");
	const first = limen(scratch, "init");
	assert.equal(first.status, 0, first.stderr);
	assert.equal(await readFile(join(scratch.root, "AGENTS.md"), "utf8"), "mine-no-newline");
	assert.equal(await readFile(join(scratch.root, ".gitignore"), "utf8"), "dist/\n/.limen/\n");
	assert.match(await readFile(join(scratch.root, "spec/vision.md"), "utf8"), /Human-owned/);
	assert.match(await readFile(join(scratch.root, "spec/build.md"), "utf8"), /## TRACK/);
	assert.match(await readFile(join(scratch.root, ".agents/limen/styleguide.md"), "utf8"), /coding practice/);
	assert.doesNotMatch(await readFile(join(scratch.root, ".agents/limen/styleguide.md"), "utf8"), /Voice and shape/);
	assert.match(await readFile(join(scratch.root, "spec/features/_template/ticket.md"), "utf8"), /FNNN/);
	for (const lane of ["planned", "active", "done", "dropped"]) await access(join(scratch.root, "spec/features", lane));
	const stub = await readFile(join(scratch.root, ".pi/extensions/limen.ts"), "utf8");
	assert.match(stub, /findPackage/);
	assert.match(stub, /hook/);
	await assert.rejects(access(join(scratch.root, ".agents/limen/worker.md")));
	await assert.rejects(access(join(scratch.root, ".agents/limen/reviewer.md")));
	await assert.rejects(access(join(scratch.root, ".agents/limen/communication.md")));
	await assert.rejects(access(join(scratch.root, ".pi/extensions/limen-wake.ts")));
	assert.match(first.stdout, /overlay \(differs/);
	assert.match(first.stdout, /AGENTS\.md/);
	await writeFile(join(scratch.root, "spec/build.md"), "custom bytes\0allowed");
	const second = limen(scratch, "init");
	assert.equal(second.status, 0, second.stderr);
	assert.equal(await readFile(join(scratch.root, "spec/build.md"), "utf8"), "custom bytes\0allowed");
	assert.equal((await readFile(join(scratch.root, ".gitignore"), "utf8")).match(/\.limen\//g)?.length, 1);
});

test("init removes leftover hook copies so the stub is the only project extension", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	await mkdir(join(scratch.root, ".pi/extensions"), { recursive: true });
	await writeFile(join(scratch.root, ".pi/extensions/limen-wake.ts"), "old wake\n");
	await copyFile(join(ROOT, "hook/steering.ts"), join(scratch.root, ".pi/extensions/limen-steering.ts"));
	const first = limen(scratch, "init");
	assert.equal(first.status, 0, first.stderr);
	assert.match(first.stdout, /removed \.pi\/extensions\/limen-wake\.ts/);
	assert.match(first.stdout, /removed \.pi\/extensions\/limen-steering\.ts/);
	await assert.rejects(access(join(scratch.root, ".pi/extensions/limen-wake.ts")));
	await assert.rejects(access(join(scratch.root, ".pi/extensions/limen-steering.ts")));
	assert.match(await readFile(join(scratch.root, ".pi/extensions/limen.ts"), "utf8"), /findPackage/);
});

test("init --drop-leftovers deletes only byte-identical copies", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	await copyFile(join(ROOT, "templates/worker.md"), join(scratch.root, ".agents/limen/worker.md"));
	await writeFile(join(scratch.root, ".agents/limen/reviewer.md"), "my reviewer\n");
	const dropped = limen(scratch, "init", "--drop-leftovers");
	assert.equal(dropped.status, 0, dropped.stderr);
	assert.match(dropped.stdout, /dropped \.agents\/limen\/worker\.md/);
	assert.doesNotMatch(dropped.stdout, /reviewer/);
	await assert.rejects(access(join(scratch.root, ".agents/limen/worker.md")));
	assert.equal(await readFile(join(scratch.root, ".agents/limen/reviewer.md"), "utf8"), "my reviewer\n");
	assert.equal(limen(scratch, "init", "--drop-leftovers").stdout.includes("no leftover copies"), true);
});
