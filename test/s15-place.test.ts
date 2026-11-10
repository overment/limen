// Where a job ran: the host alias, or the seat, on the lines people read and on the finish wake.
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { jobPlace, seatPlace } from "../src/job/place.ts";
import { completionWake } from "../src/job/wake-text.ts";
import { hostQueueLines } from "../src/runtime/hosts.ts";
import * as plant from "./plant.ts";

test("jobs, status, and json name the host, and a local job names the seat", async () => {
	const made = await plant.plant();
	try {
		const id = plant.spawnJob(made, "commit\nfinish\nfinish here", ["--label", "local-place"]);
		assert.equal(plant.waitJob(made, id), "done");
		const local = plant.limen(made, ["jobs", id]);
		assert.match(local.stdout, new RegExp(`on ${seatPlace()}`));
		const localJson = plant.limen(made, ["jobs", "--json", id]);
		assert.equal(localJson.status, 0, localJson.stderr);
		assert.equal(JSON.parse(localJson.stdout).host, seatPlace());
		await writeFile(join(plant.jobDir(made, id), "host"), "win\n");
		const hosted = plant.limen(made, ["jobs", id]);
		assert.match(hosted.stdout, /· on win ·/);
		const json = JSON.parse(plant.limen(made, ["jobs", id, "--json"]).stdout) as { host: string };
		assert.equal(json.host, "win");
		assert.equal(json.host.includes("\n"), false);
		const status = plant.limen(made, ["status", "--all"]);
		assert.match(status.stdout, /on win/);
		assert.equal(jobPlace("win"), "win");
		assert.equal(jobPlace("  "), seatPlace());
	} finally {
		await made.cleanup();
	}
});

test("a finish wake names a host and stays quiet for a seat job", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "place-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(join(root, "task.md"), "Say hello.\n");
	const seat = completionWake(root, "hello", "done", "id", "limen/id", "");
	assert.doesNotMatch(seat, /on host/);
	await writeFile(join(root, "host"), "mbp\n");
	assert.match(completionWake(root, "hello", "done", "id", "limen/id", ""), /on host mbp/);
});

test("queue lists each host's reach, load, and overflow", async () => {
	const made = await plant.plant();
	const ssh = join(made.bin, "ssh");
	await writeFile(ssh, "#!/bin/sh\ncat >/dev/null\necho ok\n");
	await chmod(ssh, 0o755);
	await writeFile(
		join(made.parent, ".limen", "hosts.json"),
		`${JSON.stringify({
			overflow: true,
			hosts: [
				{
					alias: "win",
					ssh: "win.tailnet",
					platform: "linux",
					root: "/repo",
					hook: "/hook",
					maxConcurrent: 2,
				},
			],
		})}\n`,
	);
	const previousHome = process.env.LIMEN_HOME;
	const previousPath = process.env.PATH;
	process.env.LIMEN_HOME = made.parent;
	process.env.PATH = made.env.PATH;
	try {
		const lines = await hostQueueLines();
		assert.match(lines, /^win · reachable · 0\/2 · overflow on$/);
		const printed = plant.limen(made, ["queue"]);
		assert.match(printed.stdout, /win · reachable · 0\/2 · overflow on/);
	} finally {
		if (previousHome === undefined) {
			delete process.env.LIMEN_HOME;
		} else {
			process.env.LIMEN_HOME = previousHome;
		}
		if (previousPath === undefined) {
			delete process.env.PATH;
		} else {
			process.env.PATH = previousPath;
		}
		await made.cleanup();
	}
});
