import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { git, limen, onlyJobId, scratchRepo, waitForState } from "./scratch.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const exists = (path: string) =>
	access(path).then(
		() => true,
		() => false,
	);

async function legacyProject(root: string): Promise<void> {
	await mkdir(join(root, ".control/jobs/stale"), { recursive: true });
	await writeFile(join(root, ".control/jobs/stale/state"), "running\n");
	await writeFile(join(root, ".control/jobs/stale/pid"), "99999999\n");
	await mkdir(join(root, ".agents/control"), { recursive: true });
	await writeFile(join(root, ".agents/control/worker.md"), Buffer.from("custom worker\0bytes"));
	await mkdir(join(root, ".pi/extensions"), { recursive: true });
	await writeFile(join(root, ".pi/extensions/control-wake.ts"), "old wake\n");
	await writeFile(join(root, ".pi/extensions/control-communication.ts"), "old communication\n");
}

test("migrate preserves project bytes, replaces extensions, patches narrow text, and is idempotent", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	await legacyProject(scratch.root);
	const communication = await readFile(join(ROOT, "hook/communication.ts"));
	await writeFile(join(scratch.root, ".pi/extensions/limen-communication.ts"), communication);
	await writeFile(
		join(scratch.root, "AGENTS.md"),
		"Use `control` with control init, control spawn, !control jobs, control wait, and control stop.\nKeep ordinary English control and branch control/historical. Read .control/jobs.\n",
	);
	await writeFile(join(scratch.root, ".gitignore"), "dist/\n/.control/\n!/.control/keep\n/.control/\nnotes.tmp\n");
	const result = limen(scratch, "migrate");
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /moved \.control -> \.limen/);
	assert.match(result.stdout, /restart.*\/reload/);
	assert.match(result.stdout, /created \.pi\/extensions\/limen\.ts/);
	assert.equal(await readFile(join(scratch.root, ".agents/limen/worker.md"), "utf8"), "custom worker\0bytes");
	assert.equal(await exists(join(scratch.root, ".agents/limen/reviewer.md")), false, "missing prompts stay missing");
	assert.equal(await exists(join(scratch.root, ".control")), false);
	assert.equal(await exists(join(scratch.root, ".agents/control")), false);
	assert.equal(await exists(join(scratch.root, ".pi/extensions/limen-wake.ts")), false);
	assert.deepEqual(await readFile(join(scratch.root, ".pi/extensions/limen-communication.ts")), communication);
	assert.match(await readFile(join(scratch.root, ".pi/extensions/limen.ts"), "utf8"), /findPackage/);
	assert.equal(
		(await readdir(join(scratch.root, ".pi/extensions"))).some((name) => name.startsWith("control-")),
		false,
	);
	assert.equal(
		await readFile(join(scratch.root, "AGENTS.md"), "utf8"),
		"Use `limen` with limen init, limen spawn, !limen jobs, limen wait, and limen stop.\nKeep ordinary English control and branch control/historical. Read .limen/jobs.\n",
	);
	assert.equal(await readFile(join(scratch.root, ".gitignore"), "utf8"), "dist/\n/.limen/\n!/.limen/keep\nnotes.tmp\n");
	assert.equal(await readFile(join(scratch.root, ".limen/jobs/stale/pid"), "utf8"), "99999999\n");
	const before = await readFile(join(scratch.root, ".gitignore"));
	const again = limen(scratch, "migrate");
	assert.equal(again.status, 0, again.stderr);
	assert.match(again.stdout, /kept \.limen/);
	assert.deepEqual(await readFile(join(scratch.root, ".gitignore")), before);
});

test("init refuses legacy artifacts before creating Limen files", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	await mkdir(join(scratch.root, ".agents/control"), { recursive: true });
	const result = limen(scratch, "init");
	assert.equal(result.status, 1);
	assert.match(result.stderr, /limen migrate/);
	assert.equal(await exists(join(scratch.root, ".limen")), false);
	assert.equal(await exists(join(scratch.root, ".pi")), false);
	assert.equal(await exists(join(scratch.root, "AGENTS.md")), false);
});

test("migrate refuses a running handshake with no valid PID without partial changes", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	await legacyProject(scratch.root);
	await rm(join(scratch.root, ".control/jobs/stale/pid"));
	const result = limen(scratch, "migrate");
	assert.equal(result.status, 1);
	assert.match(result.stderr, /no valid PID.*handshake/);
	assert.equal(await exists(join(scratch.root, ".control")), true);
	assert.equal(await exists(join(scratch.root, ".limen")), false);
	assert.equal(await exists(join(scratch.root, ".pi/extensions/control-wake.ts")), true);
	assert.equal(await exists(join(scratch.root, ".pi/extensions/limen-wake.ts")), false);
});

test("migrate refuses a live legacy process group", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	await mkdir(join(scratch.root, ".control/jobs/live"), { recursive: true });
	const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
	assert.ok(child.pid);
	child.unref();
	context.after(() => {
		try {
			process.kill(-(child.pid as number), "SIGKILL");
		} catch {}
	});
	await writeFile(join(scratch.root, ".control/jobs/live/state"), "running\n");
	await writeFile(join(scratch.root, ".control/jobs/live/pid"), `${child.pid}\n`);
	const result = limen(scratch, "migrate");
	assert.equal(result.status, 1);
	assert.match(result.stderr, /live process group/);
	assert.equal(await exists(join(scratch.root, ".control")), true);
	assert.equal(await exists(join(scratch.root, ".limen")), false);
});

test("directory and extension conflicts fail preflight without mutation", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	await mkdir(join(scratch.root, ".control"));
	await mkdir(join(scratch.root, ".limen"));
	const both = limen(scratch, "migrate");
	assert.equal(both.status, 1);
	assert.match(both.stderr, /both \.control and \.limen exist/);
	await rm(join(scratch.root, ".limen"), { recursive: true });
	await mkdir(join(scratch.root, ".agents/control"), { recursive: true });
	await mkdir(join(scratch.root, ".pi/extensions"), { recursive: true });
	await writeFile(join(scratch.root, ".pi/extensions/control-wake.ts"), "legacy\n");
	await writeFile(join(scratch.root, ".pi/extensions/limen-wake.ts"), "modified new\n");
	const extensions = limen(scratch, "migrate");
	assert.equal(extensions.status, 1);
	assert.match(extensions.stderr, /modified \.pi\/extensions\/limen-wake\.ts/);
	assert.equal(await exists(join(scratch.root, ".control")), true);
	assert.equal(await exists(join(scratch.root, ".agents/control")), true);
	assert.equal(await exists(join(scratch.root, ".agents/limen")), false);
});

test("migrate neither matrix is a read-only no-op and creates no extension pair", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	const result = limen(scratch, "migrate");
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /no-op \.limen/);
	assert.equal(await exists(join(scratch.root, ".limen")), false);
	assert.equal(await exists(join(scratch.root, ".pi")), false);
	assert.equal(await exists(join(scratch.root, "AGENTS.md")), false);
	assert.equal(await exists(join(scratch.root, ".gitignore")), false);
});

test("spawn reuses a historical control branch and registered worktree after migration", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	const branch = "control/historical";
	const oldWorktree = join(dirname(scratch.root), `.${basename(scratch.root)}-control-worktrees`, "historical");
	await mkdir(dirname(oldWorktree), { recursive: true });
	git(scratch.root, "worktree", "add", "-b", branch, oldWorktree, "HEAD");
	await mkdir(join(scratch.root, ".control/jobs"), { recursive: true });
	assert.equal(limen(scratch, "migrate").status, 0);
	const spawned = limen(scratch, "spawn", "resume legacy", "--branch", branch);
	assert.equal(spawned.status, 0, spawned.stderr);
	const id = onlyJobId(spawned.stdout);
	await waitForState(scratch.root, id, "done");
	assert.equal(await readFile(join(scratch.root, `.limen/jobs/${id}/branch`), "utf8"), `${branch}\n`);
	assert.equal(await readFile(join(oldWorktree, "pi-task.txt"), "utf8"), "resume legacy\n");
	assert.equal(await exists(join(dirname(scratch.root), `.${basename(scratch.root)}-limen-worktrees`, id)), false);
});
