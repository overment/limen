import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { access, chmod, mkdir, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { limen, limenWithEnv, scratchRepo } from "./scratch.ts";

// Keep fake Herdr alive beyond the native test deadline; a timeout would fall through to real macOS notifications.
const fakeSeatTimeoutMs = "120000";

test("sweep claims each advisory once without consuming wakes, honors liveness, and prunes the registry", async (context) => {
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
	await writeFile(herdr, `#!/bin/sh\nprintf 'ring\\n' >> '${log}'\n`);
	await chmod(herdr, 0o755);
	const job = join(scratch.root, ".limen/jobs/unheard");
	await mkdir(job, { recursive: true });
	await writeFile(join(job, "state"), "running\n");
	await writeFile(join(job, "pid"), `${process.pid}\n`);
	await writeFile(join(job, "label"), "F043 unheard\n");
	await writeFile(join(job, "advisory"), "idle while session remains open\n");
	const old = new Date(Date.now() - 60_000);
	await utimes(join(job, "advisory"), old, old);
	const env = { LIMEN_HERDR: herdr, LIMEN_SEAT_RING_MS: "1", LIMEN_SEAT_NOTIFY_TIMEOUT_MS: fakeSeatTimeoutMs };
	assert.equal(limenWithEnv(scratch, env, "sweep").status, 0);
	assert.equal(await readFile(log, "utf8"), "ring\n", "the first advisory reaches the fake bell");
	assert.equal((await readdir(join(job, "notify/seat"))).length, 1);
	await assert.rejects(access(join(job, "notify/claims")));
	await assert.rejects(access(join(job, "notify/delivered")));
	assert.equal(limenWithEnv(scratch, env, "sweep").status, 0);
	assert.equal((await readdir(join(job, "notify/seat"))).length, 1, "an immediate sweep stays silent");
	assert.equal(await readFile(log, "utf8"), "ring\n");
	assert.deepEqual((await readFile(registry, "utf8")).trim().split("\n"), [project]);

	for (const marker of await readdir(join(job, "notify/seat"))) await utimes(join(job, "notify/seat", marker), old, old);
	assert.equal(limenWithEnv(scratch, env, "sweep").status, 0);
	assert.equal((await readdir(join(job, "notify/seat"))).length, 1, "the unchanged advisory stays quiet even when the marker ages");
	assert.equal(await readFile(log, "utf8"), "ring\n");
	await rm(join(job, "advisory"));
	await writeFile(join(job, "advisory"), "new stall\n");
	const resumed = new Date(Date.now() - 1000);
	await utimes(join(job, "advisory"), resumed, resumed);
	assert.equal(limenWithEnv(scratch, env, "sweep").status, 0);
	assert.equal((await readdir(join(job, "notify/seat"))).length, 2, "a new advisory after recovery gets its own receipt");
	assert.equal(await readFile(log, "utf8"), "ring\nring\n", "the renewed advisory reaches the fake bell once");
	assert.equal(limenWithEnv(scratch, env, "sweep").status, 0);
	assert.equal((await readdir(join(job, "notify/seat"))).length, 2, "the new advisory remains quiet");
	assert.equal(await readFile(log, "utf8"), "ring\nring\n");
	await writeFile(join(scratch.root, ".limen/last-sweep"), `${new Date().toISOString()}\ncoordinator\n`);
	assert.equal(limenWithEnv(scratch, { ...env, LIMEN_SEAT_RING_MS: "10000" }, "sweep").status, 0);
	assert.equal((await readdir(join(job, "notify/seat"))).length, 2, "a live coordinator suppresses seat rings");
});

test("seat sweep honors legacy receipts and atomically claims a terminal event", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const home = dirname(scratch.root),
		log = join(home, "rings"),
		herdr = join(scratch.fakeBin, "herdr-ring"),
		jobs = join(scratch.root, ".limen/jobs"),
		old = new Date(Date.now() - 60_000),
		env = { ...process.env, LIMEN_HOME: home, LIMEN_HERDR: herdr, LIMEN_SEAT_RING_MS: "1", LIMEN_SEAT_NOTIFY_TIMEOUT_MS: fakeSeatTimeoutMs };
	await writeFile(herdr, `#!/bin/sh\nprintf 'ring\\n' >> '${log}'\n`);
	await chmod(herdr, 0o755);
	await writeFile(log, "");
	for (const id of ["legacy", "new"]) {
		const job = join(jobs, id);
		await mkdir(job, { recursive: true });
		await writeFile(join(job, "state"), "done\n");
		await writeFile(join(job, "finished-at"), old.toISOString());
		await utimes(join(job, "finished-at"), old, old);
		await utimes(join(job, "state"), old, old);
	}
	const legacy = join(jobs, "legacy/notify/seat");
	await mkdir(legacy, { recursive: true });
	await writeFile(join(legacy, `${Date.now()}`), "old seat ring\n");
	assert.equal(limenWithEnv(scratch, env, "sweep").status, 0);
	assert.equal(await readFile(log, "utf8"), "ring\n", "only the new terminal event reaches Herdr");
	assert.equal(limenWithEnv(scratch, env, "sweep").status, 0);
	assert.equal(await readFile(log, "utf8"), "ring\n", "the restarted sweep never rings again");
	assert.equal((await readdir(legacy)).length, 1, "old timestamp markers remain untouched");

	const concurrent = join(jobs, "concurrent");
	await mkdir(concurrent);
	await writeFile(join(concurrent, "state"), "failed\n");
	await writeFile(join(concurrent, "finished-at"), old.toISOString());
	await utimes(join(concurrent, "finished-at"), old, old);
	await utimes(join(concurrent, "state"), old, old);
	const sweep = new URL("../src/commands/sweep.ts", import.meta.url).href;
	const source = `import { sweepCommand } from ${JSON.stringify(sweep)}; const { promise, resolve } = Promise.withResolvers(); process.send("ready"); process.once("message", resolve); await promise; process.disconnect(); await sweepCommand([], process.cwd());`;
	const results = await runChildren(
		[
			{ source, args: [] },
			{ source, args: [] },
		],
		env,
		context.signal,
	);
	assert.deepEqual(
		results.filter((result) => result.status !== 0),
		[],
		results.map((result) => result.stderr).join("\n"),
	);
	assert.equal(await readFile(log, "utf8"), "ring\nring\n", "concurrent sweeps show one bell");
	assert.equal((await readdir(join(concurrent, "notify/seat"))).length, 1);

	if (process.platform !== "darwin") {
		const failed = join(jobs, "transport-failed");
		await mkdir(failed);
		await writeFile(join(failed, "state"), "done\n");
		await writeFile(join(failed, "finished-at"), old.toISOString());
		await utimes(join(failed, "state"), old, old);
		await utimes(join(failed, "finished-at"), old, old);
		const failingEnv = { ...env, LIMEN_HERDR: join(scratch.fakeBin, "missing-herdr") };
		assert.match(limenWithEnv(scratch, failingEnv, "sweep").stderr, /seat notification failed/);
		assert.equal(limenWithEnv(scratch, failingEnv, "sweep").status, 0);
		assert.equal((await readdir(join(failed, "notify/seat"))).length, 1, "failed transport never retries ambiguously");
	}
});

test("registry registration and pruning repeatedly reclaim dead locks across processes", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	const home = dirname(scratch.root),
		registry = join(home, ".limen/projects");
	await mkdir(dirname(registry), { recursive: true });
	const seat = new URL("../hook/seat.ts", import.meta.url).href,
		sweep = new URL("../src/commands/sweep.ts", import.meta.url).href,
		ready = `process.send("ready"); await new Promise(resolve => process.once("message", resolve)); process.disconnect();`,
		registerSource = `import { registerProject } from ${JSON.stringify(seat)}; ${ready} for (const project of process.argv.slice(1)) await registerProject(project);`,
		pruneSource = `import { sweepCommand } from ${JSON.stringify(sweep)}; ${ready} for (let pass = 0; pass < 4; pass++) await sweepCommand([], process.cwd());`,
		environment = { ...process.env, LIMEN_HOME: home, LIMEN_HERDR: "0" };
	for (let round = 0; round < 8; round++) {
		const projects = Array.from({ length: 80 }, (_, index) => join(home, `project-${round}-${index}`));
		await Promise.all(projects.map((project) => mkdir(project)));
		await writeFile(registry, `${join(home, "missing-one")}\n${join(home, "missing-two")}\n`);
		await mkdir(`${registry}.lock`);
		await writeFile(join(`${registry}.lock`, "owner"), "999999999\n");
		// Preserve 80 registrations and 12 prunes per round without 92 Node startups.
		// All imports finish before release, so both roles contend for the dead lock.
		const began = performance.now();
		const results = await runChildren(
			[
				...Array.from({ length: 8 }, (_, index) => ({ source: registerSource, args: projects.slice(index * 10, (index + 1) * 10) })),
				...Array.from({ length: 3 }, () => ({ source: pruneSource, args: [] })),
			],
			environment,
			context.signal,
		);
		context.diagnostic(`round ${round + 1}: 80 registrations, 12 prunes, 11 ready children; ${(performance.now() - began).toFixed(3)} ms`);
		assert.deepEqual(
			results.filter((result) => result.status !== 0),
			[],
			results.map((result) => result.stderr).join("\n"),
		);
		assert.deepEqual(new Set((await readFile(registry, "utf8")).trim().split("\n")), new Set(projects));
	}
});

test("sweep reaps dead jobs and a later pass rings the unheard completion", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const home = dirname(scratch.root);
	const log = join(home, "herdr-rings");
	const herdr = join(scratch.fakeBin, "herdr-ring");
	await writeFile(herdr, `#!/bin/sh\nprintf 'ring\\n' >> '${log}'\n`);
	await chmod(herdr, 0o755);
	const job = join(scratch.root, ".limen/jobs/dead");
	await mkdir(job, { recursive: true });
	await writeFile(join(job, "task.md"), "dead\n");
	await writeFile(join(job, "log"), "");
	await writeFile(join(job, "state"), "running\n");
	await writeFile(join(job, "pid"), "999999999\n");
	await writeFile(join(job, "started-at"), "2000-01-01T00:00:00.000Z\n");
	const env = { LIMEN_HERDR: herdr, LIMEN_REAP_CONFIRM_MS: "1", LIMEN_SEAT_RING_MS: "60000", LIMEN_SEAT_NOTIFY_TIMEOUT_MS: fakeSeatTimeoutMs };
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

function runChildren(tasks: readonly { readonly source: string; readonly args: readonly string[] }[], env: NodeJS.ProcessEnv, signal: AbortSignal) {
	const children = tasks.map(({ source, args }) =>
		spawn(process.execPath, ["--input-type=module", "--eval", source, ...args], {
			env,
			stdio: ["ignore", "ignore", "pipe", "ipc"],
			signal,
			killSignal: "SIGKILL",
			timeout: 15_000,
		}),
	);
	let ready = 0;
	return Promise.all(
		children.map(
			(child) =>
				new Promise<{ readonly status: number; readonly stderr: string }>((done) => {
					let stderr = "";
					child.stderr?.setEncoding("utf8");
					child.stderr?.on("data", (chunk) => (stderr += chunk));
					child.on("error", (error) => (stderr += error.message));
					child.once("message", () => {
						ready += 1;
						if (ready === children.length) for (const waiting of children) waiting.send("go", (error) => error && waiting.kill("SIGKILL"));
					});
					child.on("close", (status, killed) => done({ status: status ?? 1, stderr: `${stderr}${killed ? `killed by ${killed}` : ""}` }));
				}),
		),
	);
}
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
