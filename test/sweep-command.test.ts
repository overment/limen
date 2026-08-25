import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, chmod, mkdir, readdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { limen, limenWithEnv, scratchRepo } from "./scratch.ts";

test("sweep rings unheard jobs on cadence without consuming wakes, honors liveness, and prunes the registry", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	assert.equal(limen(scratch, "init").status, 0);
	const home = dirname(scratch.root);
	const registry = join(home, ".limen/projects");
	const project = (await readFile(registry, "utf8")).trim();
	assert.ok(project.endsWith(scratch.root.slice(scratch.root.lastIndexOf("/"))));
	const missing = join(home, "deleted-project");
	await writeFile(registry, `${project}\n${missing}\n${project}\n`);

	const log = join(home, "herdr-rings");
	const herdr = join(scratch.fakeBin, "herdr-ring");
	await writeFile(herdr, `#!/usr/bin/env node\nrequire("node:fs").appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(" ") + "\\n");\n`);
	await chmod(herdr, 0o755);
	const job = join(scratch.root, ".limen/jobs/unheard");
	await mkdir(job, { recursive: true });
	await writeFile(join(job, "state"), "running\n");
	await writeFile(join(job, "label"), "F043 unheard\n");
	await writeFile(join(job, "advisory"), "idle while session remains open\n");
	const old = new Date(Date.now() - 60_000);
	await utimes(join(job, "advisory"), old, old);
	const env = { LIMEN_HERDR: herdr, LIMEN_SEAT_RING_MS: "1", LIMEN_SEAT_RERING_MS: "60000" };
	assert.equal(limenWithEnv(scratch, env, "sweep").status, 0);
	assert.equal((await readFile(log, "utf8")).trim().split("\n").length, 1);
	assert.equal((await readdir(join(job, "notify/seat"))).length, 1);
	await assert.rejects(access(join(job, "notify/claims")));
	await assert.rejects(access(join(job, "notify/delivered")));
	assert.equal(limenWithEnv(scratch, env, "sweep").status, 0);
	assert.equal((await readFile(log, "utf8")).trim().split("\n").length, 1, "an immediate sweep stays silent");
	assert.deepEqual((await readFile(registry, "utf8")).trim().split("\n"), [project]);

	for (const marker of await readdir(join(job, "notify/seat"))) await utimes(join(job, "notify/seat", marker), old, old);
	assert.equal(limenWithEnv(scratch, { ...env, LIMEN_SEAT_RERING_MS: "1" }, "sweep").status, 0);
	assert.equal((await readFile(log, "utf8")).trim().split("\n").length, 2, "an unheard job re-rings past cadence");
	await writeFile(join(scratch.root, ".limen/last-sweep"), `${new Date().toISOString()}\ncoordinator\n`);
	for (const marker of await readdir(join(job, "notify/seat"))) await utimes(join(job, "notify/seat", marker), old, old);
	assert.equal(limenWithEnv(scratch, { ...env, LIMEN_SEAT_RING_MS: "10000", LIMEN_SEAT_RERING_MS: "1" }, "sweep").status, 0);
	assert.equal((await readFile(log, "utf8")).trim().split("\n").length, 2, "a live coordinator suppresses seat rings");
});

test("sweep reaps dead jobs and a later pass rings the unheard completion", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const home = dirname(scratch.root);
	const log = join(home, "herdr-rings");
	const herdr = join(scratch.fakeBin, "herdr-ring");
	await writeFile(herdr, `#!/usr/bin/env node\nrequire("node:fs").appendFileSync(${JSON.stringify(log)}, "ring\\n");\n`);
	await chmod(herdr, 0o755);
	const job = join(scratch.root, ".limen/jobs/dead");
	await mkdir(job, { recursive: true });
	await writeFile(join(job, "task.md"), "dead\n");
	await writeFile(join(job, "log"), "");
	await writeFile(join(job, "state"), "running\n");
	await writeFile(join(job, "pid"), "999999999\n");
	await writeFile(join(job, "started-at"), "2000-01-01T00:00:00.000Z\n");
	const env = { LIMEN_HERDR: herdr, LIMEN_REAP_CONFIRM_MS: "1", LIMEN_SEAT_RING_MS: "60000" };
	assert.equal(limenWithEnv(scratch, env, "sweep").status, 0);
	assert.equal((await readFile(join(job, "state"), "utf8")).trim(), "failed");
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(limenWithEnv(scratch, { ...env, LIMEN_SEAT_RING_MS: "1" }, "sweep").status, 0);
	assert.equal((await readFile(log, "utf8")).trim(), "ring");
	await assert.rejects(access(join(job, "notify/claims")));
	await assert.rejects(access(join(job, "notify/delivered")));
});

test("sweep install writes a valid absolute launchd interval job and uninstall removes only it", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	const installed = limen(scratch, "sweep", "--install");
	assert.equal(installed.status, 0, installed.stderr);
	const path = join(dirname(scratch.root), "Library/LaunchAgents/limen-sweep.plist");
	const plist = await readFile(path, "utf8");
	assert.match(plist, /<key>StartInterval<\/key><integer>60<\/integer>/);
	assert.match(plist, new RegExp(`<string>${escapeRegex(process.execPath)}</string>`));
	assert.match(plist, /<string>\/.*\/bin\/limen<\/string>/);
	if (process.platform === "darwin") assert.match(execFileSync("plutil", ["-lint", path], { encoding: "utf8" }), /OK/);
	const kept = join(dirname(path), "keep");
	await writeFile(kept, "keep\n");
	const removed = limen(scratch, "sweep", "--uninstall");
	assert.equal(removed.status, 0, removed.stderr);
	await assert.rejects(stat(path));
	assert.equal(await readFile(kept, "utf8"), "keep\n");
});

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
