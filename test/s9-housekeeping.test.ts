// S9 · sweep, prune and recovery: a dead or finished job is cleaned up, a live one is not. One plant, real bin/limen.
import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, writeSync } from "node:fs";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	engineEvents,
	git,
	jobDir,
	jobFile,
	LIMEN,
	limen,
	type Plant,
	plant,
	release,
	spawnJob,
	until,
	waitJob,
} from "./plant.ts";

const WAKE = fileURLToPath(new URL("../hook/wake.ts", import.meta.url));
const SESSION = "s9-coordinator";
let p: Plant;
before(async () => {
	p = await plant();
});
after(() => p.cleanup());

/** A real `limen` child that runs concurrently with the test; `done` resolves to its exit code and output. */
function start(args: readonly string[], options: { cwd?: string; env?: Record<string, string> } = {}) {
	const child: ChildProcess = spawn(process.execPath, [LIMEN, ...args], {
		cwd: options.cwd ?? p.root,
		env: { ...p.env, ...options.env },
	});
	let output = "";
	child.stdout?.on("data", (chunk) => {
		output += chunk;
	});
	child.stderr?.on("data", (chunk) => {
		output += chunk;
	});
	const done = new Promise<{ status: number; output: string }>((resolve) =>
		child.on("close", (status) => resolve({ status: status ?? 1, output })),
	);
	return { child, done };
}
/** Alive and not a zombie: a zombie answers kill(pid, 0) but has already exited. */
const alive = (pid: number) =>
	/^[^Z]/.test(spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim());
const wakes = (dir: string, id: string) =>
	engineEvents(dir).filter((entry) => entry.event !== "notify" && entry.text?.includes(id)).length;

test("prune keeps live, nested and half-published work, drops finished worktrees and leftovers; retire drops only landed jobs", async () => {
	// A job published but still in its prepare step: no state yet, held on a FIFO past its startup grace.
	const gate = join(p.parent, "prepare-gate"),
		prepared = join(p.parent, "prepared");
	execFileSync("mkfifo", [gate]);
	const half = start(["spawn", "--prepare", `pwd > ${prepared}; cat ${gate} > /dev/null`, "say half"]);
	await until(p.parent, () => existsSync(prepared) && readFileSync(prepared, "utf8").endsWith("\n"));
	const halfTree = readFileSync(prepared, "utf8").trim();
	const halfId = basename(halfTree);
	assert.equal(jobFile(p, halfId, "state"), "");
	await writeFile(join(jobDir(p, halfId), "started-at"), "2000-01-01T00:00:00.000Z\n");
	// Each spawn below runs its own prune while the half-published job waits.
	const landed = spawnJob(p, "commit");
	const unmerged = spawnJob(p, "commit");
	assert.equal(waitJob(p, landed), "done");
	assert.equal(waitJob(p, unmerged), "done");
	const live = spawnJob(p, "block");
	const liveTree = jobFile(p, live, "worktree");
	// Another checkout (the live job's worktree) runs its own job; its worktree nests inside this plant's worktree root.
	assert.equal(limen(p, ["init"], { cwd: liveTree }).status, 0);
	const nested = spawnJob(p, "block", [], { cwd: liveTree });
	const nestedDir = join(liveTree, ".limen/jobs", nested);
	const nestedTree = readFileSync(join(nestedDir, "worktree"), "utf8").trim();
	assert.ok(nestedTree.startsWith(`${join(liveTree, "..")}/.${basename(liveTree)}-limen-worktrees/`), nestedTree);
	// A start whose spawner died long ago: a record and a worktree, no state, no live `starting` process.
	const stale = jobDir(p, "2000-01-01-stale-start-aaaaaaaa"),
		staleTree = join(halfTree, "..", "2000-01-01-stale-start-aaaaaaaa");
	await mkdir(stale);
	await writeFile(join(stale, "started-at"), "2000-01-01T00:00:00.000Z\n");
	await writeFile(join(stale, "worktree"), `${staleTree}\n`);
	git(p.root, "worktree", "add", "-q", "--detach", staleTree, "HEAD");

	const pruned = limen(p, ["prune"]);
	assert.equal(pruned.status, 0, pruned.stderr);
	for (const dropped of [jobFile(p, landed, "worktree"), jobFile(p, unmerged, "worktree"), stale, staleTree]) {
		assert.ok(!existsSync(dropped), `prune kept ${dropped}`);
	}
	for (const kept of [liveTree, nestedTree, halfTree, jobDir(p, halfId), nestedDir]) {
		assert.ok(existsSync(kept), `prune removed ${kept}`);
	}
	assert.ok(git(p.root, "worktree", "list", "--porcelain").includes(`worktree ${nestedTree}\n`));

	await writeFile(gate, "go\n");
	const published = await half.done;
	assert.equal(published.status, 0, published.output);
	assert.equal(waitJob(p, halfId), "done");
	await release(nestedDir);
	assert.equal(waitJob(p, nested, { cwd: liveTree }), "done");

	git(p.root, "merge", "-q", "--no-edit", jobFile(p, landed, "branch"));
	const retired = limen(p, ["prune", "--retire"]);
	assert.equal(retired.status, 0, retired.stderr);
	assert.ok(!existsSync(jobDir(p, landed)), "a landed job is retired");
	assert.ok(existsSync(jobDir(p, unmerged)), "an unmerged job stays");
	assert.ok(existsSync(jobDir(p, live)), "a running job stays");
	await release(jobDir(p, live));
	assert.equal(waitJob(p, live), "done");
});

test("a killed wrapper is reaped at once and a stopped job leaves no escaped child; each wakes the coordinator once", async () => {
	const env = { PI_SESSION_ID: SESSION };
	const killed = spawnJob(p, "block", [], { env });
	await until(jobDir(p, killed), () => existsSync(join(jobDir(p, killed), "fake-blocked-1")));
	const pid = Number(jobFile(p, killed, "pid"));
	assert.ok(pid > 0, "the wrapper recorded its pid");
	process.kill(pid, "SIGKILL");
	// A young job: only the product's dead-pid confirmation window applies, never the startup grace.
	const listed = limen(p, ["jobs", killed], { env: { LIMEN_REAP_CONFIRM_MS: "1" } });
	assert.equal(listed.status, 0, listed.stderr);
	assert.equal(jobFile(p, killed, "state"), "failed");
	await release(jobDir(p, killed));

	const stopped = spawnJob(p, "orphan\nblock", [], { env });
	await until(jobDir(p, stopped), () => existsSync(join(jobDir(p, stopped), "fake-blocked-1")));
	const orphan = Number(jobFile(p, stopped, "fake-orphan"));
	assert.ok(alive(orphan), "the orphan escaped into its own process group and runs");
	const stop = limen(p, ["stop", stopped, "s9"]);
	assert.equal(stop.status, 0, stop.stderr);
	assert.equal(jobFile(p, stopped, "state"), "stopped");
	assert.ok(
		!alive(orphan) || jobFile(p, stopped, "cleanup").includes(`${orphan} `),
		`orphan ${orphan} survived stop unnamed`,
	);

	const coordinator = join(p.parent, "coordinator");
	await mkdir(coordinator);
	await writeFile(join(coordinator, "task.md"), "block\n");
	const session = spawn(
		join(p.bin, "pi"),
		["--extension", WAKE, "--session-dir", join(coordinator, "session"), `@${join(coordinator, "task.md")}`],
		{
			cwd: p.root,
			env: { ...p.env, ...env },
			stdio: "ignore",
		},
	);
	// A later job's wake orders the count: a duplicate for either earlier job would have arrived before it.
	const last = spawnJob(p, "say last", [], { env });
	assert.equal(waitJob(p, last), "done");
	await until(coordinator, () => wakes(coordinator, last) > 0);
	assert.deepEqual([wakes(coordinator, killed), wakes(coordinator, stopped)], [1, 1]);
	await release(coordinator);
	await new Promise((resolve) => session.once("exit", resolve));
});

test("seat registrations survive a dead-owner registry lock under contention", async () => {
	const registry = join(p.parent, ".limen/projects"),
		lock = `${registry}.lock`,
		gate = join(p.parent, "registry-gate"),
		ready = join(p.parent, "registry-ready"),
		barrier = join(p.parent, "registry-barrier.mjs");
	const projects = Array.from({ length: 40 }, (_, index) => join(p.parent, `seat-${index}`));
	await Promise.all([...projects, ready].map((dir) => mkdir(dir)));
	await writeFile(registry, `${p.root}\n${join(p.parent, "gone-one")}\n${join(p.parent, "gone-two")}\n`);
	// A lock whose owner died long ago: a pid no process holds, an mtime far past any freshness window, and the marker of
	// a reclaimer that died mid-claim inside it.
	await mkdir(lock);
	await writeFile(join(lock, "owner"), "999999999\n");
	await writeFile(join(lock, "reclaimer"), "999999998.0");
	await utimes(lock, new Date(0), new Date(0));
	execFileSync("mkfifo", [gate]);
	// Each process pauses at its first registry touch, so every one meets the dead lock together; one write releases all.
	await writeFile(
		barrier,
		`import fs from "node:fs"; import { syncBuiltinESMExports } from "node:module";
let waited = false;
for (const name of ["existsSync", "mkdirSync"]) {
	const original = fs[name];
	fs[name] = (path, ...rest) => {
		if (!waited && String(path).startsWith(${JSON.stringify(registry)})) {
			waited = true;
			fs.writeFileSync(${JSON.stringify(ready)} + "/" + process.pid, "");
			const fd = fs.openSync(${JSON.stringify(gate)}, "r");
			fs.readSync(fd, Buffer.alloc(1));
			fs.closeSync(fd);
		}
		return original(path, ...rest);
	};
}
syncBuiltinESMExports();
`,
	);
	const hold = openSync(gate, "r+");
	const env = { NODE_OPTIONS: `${p.env.NODE_OPTIONS} --import=${barrier}` };
	const children = [
		...projects.map((project) => start(["workspace", "init"], { cwd: project, env })),
		...Array.from({ length: 8 }, () => start(["sweep"], { env })),
	];
	// A child that fails before its first registry touch never reaches the barrier; count it so the wait still ends.
	await until(
		ready,
		() => readdirSync(ready).length + children.filter(({ child }) => child.exitCode !== null).length >= children.length,
	);
	writeSync(hold, "x".repeat(children.length));
	const results = await Promise.all(children.map((child) => child.done));
	closeSync(hold);
	assert.deepEqual(
		results.filter((result) => result.status !== 0 || /ENOTEMPTY/.test(result.output)),
		[],
	);
	assert.deepEqual(new Set(readFileSync(registry, "utf8").trim().split("\n")), new Set([p.root, ...projects]));
});
