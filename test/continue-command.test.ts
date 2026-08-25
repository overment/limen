import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { git, limen, limenWithEnv, onlyJobId, scratchRepo, scratchWorkspace, waitForState } from "./scratch.ts";

const continuingFakePi = `#!/usr/bin/env node
const { writeFileSync, mkdirSync } = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "auth") process.exit(1);
const dirIndex = args.indexOf("--session-dir");
if (dirIndex >= 0) {
  mkdirSync(args[dirIndex + 1], { recursive: true });
  writeFileSync(args[dirIndex + 1] + "/session.jsonl", JSON.stringify({ type: "session" }) + "\\n");
}
writeFileSync("pi-args.json", JSON.stringify(args));
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "continued ok" }] } }));
`;

const sleeperFakePi = `#!/usr/bin/env node
setTimeout(() => process.exit(0), 1500);
`;

function worktreeFor(root: string, id: string): string {
	const line = git(root, "worktree", "list", "--porcelain")
		.split("\n")
		.find((entry) => entry.includes(id));
	if (!line) throw new Error(`no worktree for ${id}`);
	return line.slice("worktree ".length);
}

test("continue resumes a finished job in its own session and links the record", async (context) => {
	const scratch = await scratchRepo(continuingFakePi);
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const parent = onlyJobId(limen(scratch, "spawn", "--label", "F034 worker", "first slice").stdout);
	await waitForState(scratch.root, parent, "done");
	const launched = limen(scratch, "continue", parent, "now refine the seam");
	assert.equal(launched.status, 0, launched.stderr);
	assert.match(launched.stdout, /continued F034 worker · continue in /);
	const id = onlyJobId(launched.stdout);
	await waitForState(scratch.root, id, "done");
	const job = join(scratch.root, ".limen/jobs", id);
	assert.equal(await readFile(join(job, "parent"), "utf8"), `${parent}\n`);
	assert.equal(await readFile(join(job, "branch"), "utf8"), await readFile(join(scratch.root, ".limen/jobs", parent, "branch"), "utf8"));
	assert.equal(await readFile(join(job, "task.md"), "utf8"), "now refine the seam\n");
	// Same worktree as the parent — the earned checkout is reused, not re-planned.
	const usedWorktree = (await readFile(join(job, "worktree"), "utf8")).trim();
	assert.equal(usedWorktree, worktreeFor(scratch.root, parent));
	const argv = JSON.parse(await readFile(join(usedWorktree, "pi-args.json"), "utf8")) as string[];
	assert.equal(argv[argv.indexOf("--mode") + 1], "json");
	assert.match(argv[argv.indexOf("--session-dir") + 1] ?? "", new RegExp(`${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/session$`));
	const parentTranscript = (await readdir(join(scratch.root, ".limen/jobs", parent, "session")))
		.filter((name) => name.endsWith(".jsonl"))
		.sort()
		.at(-1);
	assert.ok(parentTranscript);
	assert.equal(existsSync(join(job, "session", parentTranscript)), true, "the child session dir must be seeded with the parent transcript");
	assert.equal(argv.includes("--continue"), true);
	assert.equal(argv[argv.indexOf("--continue") + 1], "now refine the seam");
	assert.equal(
		argv.some((value) => value.startsWith("@")),
		false,
		"a continued job must not replay the task file",
	);
	const detail = limen(scratch, "jobs", id);
	assert.match(detail.stdout, new RegExp(`parent ${parent}`));
});

test("continue refuses a running job and a pruned worktree without writing records", async (context) => {
	const scratch = await scratchRepo(sleeperFakePi);
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const parent = onlyJobId(limen(scratch, "spawn", "--label", "slow worker", "first slice").stdout);
	const pidPath = join(scratch.root, ".limen/jobs", parent, "pid");
	const deadline = Date.now() + 5_000;
	while (!(await readFile(pidPath, "utf8").catch(() => "")) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
	const running = limen(scratch, "continue", parent, "too early");
	assert.equal(running.status, 1);
	assert.match(running.stderr, /is running; continue needs a finished job/);
	await waitForState(scratch.root, parent, "done");
	assert.equal(limen(scratch, "prune").status, 0);
	const before = await readdir(join(scratch.root, ".limen/jobs"));
	const pruned = limen(scratch, "continue", parent, "worktree is gone");
	assert.equal(pruned.status, 1);
	assert.match(pruned.stderr, /gone .* pruned; spawn a fresh job instead/s);
	assert.deepEqual(await readdir(join(scratch.root, ".limen/jobs")), before, "refusals must not create job records");
});

test("workspace continue copies repo so jobs diffs the child", async (context) => {
	const workspace = await scratchWorkspace(continuingFakePi);
	context.after(workspace.cleanup);
	assert.equal(limen(workspace, "workspace", "init").status, 0);
	const parent = onlyJobId(limen(workspace, "spawn", "--repo", "api", "--label", "F037 api", "first slice").stdout);
	await waitForState(workspace.root, parent, "done");
	const launched = limen(workspace, "continue", parent, "keep going");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	await waitForState(workspace.root, id, "done");
	assert.equal(await readFile(join(workspace.root, ".limen/jobs", id, "repo"), "utf8"), "api\n");
	const detail = limen(workspace, "jobs", id);
	assert.match(detail.stdout, /repo api/);
	assert.doesNotMatch(detail.stdout, /unavailable/);
});

test("continue --detached stays a wrapper even in Herdr", async (context) => {
	const scratch = await scratchRepo(continuingFakePi);
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const parent = onlyJobId(limen(scratch, "spawn", "--label", "F037 det", "first slice").stdout);
	await waitForState(scratch.root, parent, "done");
	const herdr = join(scratch.fakeBin, "herdr");
	await writeFile(herdr, "#!/usr/bin/env node\nconsole.log(JSON.stringify({ result: {} }));\n");
	await chmod(herdr, 0o755);
	const launched = limenWithEnv(scratch, { HERDR_ENV: "1", LIMEN_HERDR: herdr }, "continue", "--detached", parent, "keep going");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	await waitForState(scratch.root, id, "done");
	const job = join(scratch.root, ".limen/jobs", id);
	await assert.rejects(readFile(join(job, "hosted")));
	const worktree = (await readFile(join(job, "worktree"), "utf8")).trim();
	const argv = JSON.parse(await readFile(join(worktree, "pi-args.json"), "utf8")) as string[];
	assert.equal(argv.includes("--continue"), true);
	assert.equal(argv.includes("--mode"), true);
});

test("LIMEN_PREFLIGHT=auth fails continue with no record", async (context) => {
	const scratch = await scratchRepo(continuingFakePi);
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const parent = onlyJobId(limen(scratch, "spawn", "--label", "F037 auth", "first slice").stdout);
	await waitForState(scratch.root, parent, "done");
	const before = await readdir(join(scratch.root, ".limen/jobs"));
	const refused = limenWithEnv(scratch, { LIMEN_PREFLIGHT: "auth" }, "continue", parent, "keep going");
	assert.equal(refused.status, 1);
	assert.match(refused.stderr, /auth/);
	assert.deepEqual(await readdir(join(scratch.root, ".limen/jobs")), before);
});

test("hosted continue start failure finalizes the child record", async (context) => {
	const scratch = await scratchRepo(continuingFakePi);
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const parent = onlyJobId(limen(scratch, "spawn", "--label", "F037 fail", "first slice").stdout);
	await waitForState(scratch.root, parent, "done");
	const herdr = join(scratch.fakeBin, "herdr");
	await writeFile(
		herdr,
		`#!/usr/bin/env node
console.log(JSON.stringify({ error: { code: "boom", message: "herdr down" } }));
process.exit(1);
`,
	);
	await chmod(herdr, 0o755);
	const launched = limenWithEnv(scratch, { HERDR_ENV: "1", LIMEN_HERDR: herdr }, "continue", parent, "keep going");
	assert.equal(launched.status, 1);
	const jobs = await readdir(join(scratch.root, ".limen/jobs"));
	const child = jobs.find((name) => name !== parent);
	assert.ok(child);
	const job = join(scratch.root, ".limen/jobs", child);
	assert.equal((await readFile(join(job, "state"), "utf8")).trim(), "failed");
	assert.match(await readFile(join(job, "finished-at"), "utf8"), /T/);
	const leftovers = (await readdir(job)).filter((name) => /\.tmp$/.test(name));
	assert.deepEqual(leftovers, []);
});
