import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { liveJob } from "../src/reap.ts";
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

test("continue sends an explicit model rather than inheriting Pi settings or the old session", async (context) => {
	const scratch = await scratchRepo(continuingFakePi);
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const parent = onlyJobId(limen(scratch, "spawn", "--model", "xai/grok-4.6:xhigh", "first slice").stdout);
	await waitForState(scratch.root, parent, "done");
	const cases = [
		{ worker: "", reviewer: "", flags: [], expected: "openai-codex/gpt-6-astra:high" },
		{ worker: "   ", reviewer: "", flags: [], expected: "openai-codex/gpt-6-astra:high" },
		{ worker: "worker-model", reviewer: "review-model", flags: [], expected: "worker-model" },
		{ worker: "worker-model", reviewer: "review-model", flags: ["--review"], expected: "review-model" },
		{ worker: "worker-model", reviewer: "", flags: ["--review"], expected: "openai-codex/gpt-6-astra:high" },
		{ worker: "worker-model", reviewer: "review-model", flags: ["--model", "explicit"], expected: "explicit" },
	];
	for (const entry of cases) {
		const env = { LIMEN_WORKER_MODEL: entry.worker, LIMEN_REVIEWER_MODEL: entry.reviewer };
		const launched = limenWithEnv(scratch, env, "continue", ...entry.flags, parent, "refine the seam");
		assert.equal(launched.status, 0, launched.stderr);
		await waitForState(scratch.root, onlyJobId(launched.stdout), "done");
		const argv = JSON.parse(await readFile(join(worktreeFor(scratch.root, parent), "pi-args.json"), "utf8")) as string[];
		assert.equal(argv[argv.indexOf("--model") + 1], entry.expected);
	}
});

test("detached spawn and continuation forward literal provider, model, and thinking flags", async (context) => {
	const scratch = await scratchRepo(continuingFakePi);
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const flags = ["--provider", "openai-codex", "--model", "gpt-6-astra", "--thinking", "high"];
	const env = { LIMEN_WORKER_MODEL: "xai/grok-4.6:xhigh" };
	const first = limenWithEnv(scratch, env, "spawn", "--detached", ...flags, "first slice");
	assert.equal(first.status, 0, first.stderr);
	const parent = onlyJobId(first.stdout);
	await waitForState(scratch.root, parent, "done");
	const path = join(worktreeFor(scratch.root, parent), "pi-args.json");
	const initialArgs = JSON.parse(await readFile(path, "utf8")) as string[];
	assert.deepEqual(initialArgs.slice(initialArgs.indexOf("--provider"), initialArgs.indexOf("--provider") + flags.length), flags);
	const resumed = limenWithEnv(scratch, env, "continue", "--detached", ...flags, parent, "refine the seam");
	assert.equal(resumed.status, 0, resumed.stderr);
	await waitForState(scratch.root, onlyJobId(resumed.stdout), "done");
	const resumedArgs = JSON.parse(await readFile(path, "utf8")) as string[];
	assert.deepEqual(resumedArgs.slice(resumedArgs.indexOf("--provider"), resumedArgs.indexOf("--provider") + flags.length), flags);
});

test("continue without --review loads the parent role preamble", async (context) => {
	const scratch = await scratchRepo(continuingFakePi);
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	await writeFile(join(scratch.root, ".agents/limen/researcher.md"), "RESEARCH PREAMBLE\n");
	const parent = onlyJobId(limen(scratch, "spawn", "--role", "researcher", "--label", "F069 research", "first slice").stdout);
	await waitForState(scratch.root, parent, "done");
	const launched = limen(scratch, "continue", parent, "keep looking");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	await waitForState(scratch.root, id, "done");
	const job = join(scratch.root, ".limen/jobs", id);
	assert.equal(await readFile(join(job, "role"), "utf8"), "researcher\n");
	const argv = JSON.parse(await readFile(join((await readFile(join(job, "worktree"), "utf8")).trim(), "pi-args.json"), "utf8")) as string[];
	assert.equal(argv[argv.indexOf("--append-system-prompt") + 1], "RESEARCH PREAMBLE\n");
});

test("continue restores a pruned finished checkout from its branch and saved session", async (context) => {
	const scratch = await scratchRepo(continuingFakePi);
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const parent = onlyJobId(limen(scratch, "spawn", "--label", "pruned worker", "first slice").stdout);
	await waitForState(scratch.root, parent, "done");
	const parentDir = join(scratch.root, ".limen/jobs", parent);
	const worktree = (await readFile(join(parentDir, "worktree"), "utf8")).trim();
	const branch = (await readFile(join(parentDir, "branch"), "utf8")).trim();
	await writeFile(join(worktree, "earned.txt"), "committed work survives\n");
	git(worktree, "add", "earned.txt");
	git(worktree, "commit", "-m", "earned work");
	const tip = git(worktree, "rev-parse", "HEAD");
	const transcript = '{"type":"session","id":"saved-parent-context"}\n';
	await writeFile(join(parentDir, "session/zz-parent.jsonl"), transcript);
	assert.equal(limen(scratch, "prune").status, 0);
	assert.equal(existsSync(worktree), false);
	assert.equal(git(scratch.root, "rev-parse", branch), tip);
	const launched = limen(scratch, "continue", parent, "refine committed work");
	assert.equal(launched.status, 0, launched.stderr);
	assert.match(launched.stdout, /restored .* from limen\/.*; only committed branch contents were recovered/);
	const id = onlyJobId(launched.stdout);
	await waitForState(scratch.root, id, "done");
	const job = join(scratch.root, ".limen/jobs", id);
	assert.equal(await readFile(join(job, "worktree"), "utf8"), `${worktree}\n`);
	assert.equal(await readFile(join(job, "base"), "utf8"), `${tip}\n`);
	assert.equal(await readFile(join(job, "branch"), "utf8"), `${branch}\n`);
	assert.equal(await readFile(join(job, "parent"), "utf8"), `${parent}\n`);
	assert.equal(await readFile(join(job, "session/zz-parent.jsonl"), "utf8"), transcript);
	assert.equal(await readFile(join(parentDir, "session/zz-parent.jsonl"), "utf8"), transcript);
	assert.equal(await readFile(join(parentDir, "state"), "utf8"), "done\n");
	assert.equal(await readFile(join(worktree, "earned.txt"), "utf8"), "committed work survives\n");
	assert.equal(git(worktree, "rev-parse", "HEAD"), tip);
	const argv = JSON.parse(await readFile(join(worktree, "pi-args.json"), "utf8")) as string[];
	assert.equal(argv[argv.indexOf("--continue") + 1], "refine committed work");
});

test("continue refuses a running job or missing transcript without writing records", async (context) => {
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
	assert.match(pruned.stderr, /has no session transcript to continue/);
	assert.equal(existsSync((await readFile(join(scratch.root, ".limen/jobs", parent, "worktree"), "utf8")).trim()), false);
	assert.deepEqual(await readdir(join(scratch.root, ".limen/jobs")), before, "refusals must not create job records");
});

for (const pruned of [false, true]) {
	test(`workspace continue copies repo and uses the child's branch (pruned: ${pruned})`, async (context) => {
		const workspace = await scratchWorkspace(continuingFakePi);
		context.after(workspace.cleanup);
		assert.equal(limen(workspace, "workspace", "init").status, 0);
		const parent = onlyJobId(limen(workspace, "spawn", "--repo", "api", "--label", "F037 api", "first slice").stdout);
		await waitForState(workspace.root, parent, "done");
		const parentDir = join(workspace.root, ".limen/jobs", parent);
		const worktree = (await readFile(join(parentDir, "worktree"), "utf8")).trim();
		const branch = (await readFile(join(parentDir, "branch"), "utf8")).trim();
		git(worktree, "commit", "--allow-empty", "-m", "api progress");
		const tip = git(worktree, "rev-parse", "HEAD");
		git(workspace.repositories.web, "branch", branch);
		const webTip = git(workspace.repositories.web, "rev-parse", branch);
		assert.notEqual(tip, webTip);
		if (pruned) {
			assert.equal(limen(workspace, "prune").status, 0);
			assert.equal(existsSync(worktree), false);
		}
		const launched = limen(workspace, "continue", parent, "keep going");
		assert.equal(launched.status, 0, launched.stderr);
		const id = onlyJobId(launched.stdout);
		await waitForState(workspace.root, id, "done");
		const job = join(workspace.root, ".limen/jobs", id);
		assert.equal(await readFile(join(job, "repo"), "utf8"), "api\n");
		assert.equal(await readFile(join(job, "base"), "utf8"), `${tip}\n`);
		assert.equal(git(worktree, "rev-parse", "HEAD"), tip);
		assert.equal(git(workspace.repositories.web, "rev-parse", branch), webTip);
		const detail = limen(workspace, "jobs", id);
		assert.match(detail.stdout, /repo api/);
		assert.doesNotMatch(detail.stdout, /\(unavailable/);
		assert.match(detail.stdout, /author: unavailable · non-Git workspace ticket/);
	});
}

for (const unavailable of ["missing", "occupied"] as const) {
	test(`continue refuses a pruned checkout when its branch is ${unavailable} without writing records`, async (context) => {
		const scratch = await scratchRepo(continuingFakePi);
		context.after(scratch.cleanup);
		assert.equal(limen(scratch, "init").status, 0);
		const parent = onlyJobId(limen(scratch, "spawn", "first slice").stdout);
		await waitForState(scratch.root, parent, "done");
		const parentDir = join(scratch.root, ".limen/jobs", parent);
		const worktree = (await readFile(join(parentDir, "worktree"), "utf8")).trim();
		const branch = (await readFile(join(parentDir, "branch"), "utf8")).trim();
		assert.equal(limen(scratch, "prune").status, 0);
		const occupied = join(dirname(worktree), "occupied");
		if (unavailable === "missing") git(scratch.root, "branch", "-D", branch);
		else {
			git(scratch.root, "worktree", "add", occupied, branch);
			await writeFile(join(occupied, "in-progress.txt"), "do not replace\n");
		}
		const before = await readdir(join(scratch.root, ".limen/jobs"));
		const refused = limen(scratch, "continue", parent, "keep going");
		assert.equal(refused.status, 1);
		if (unavailable === "missing") {
			assert.ok(refused.stderr.includes(`branch ${branch} is missing in ${scratch.root}; restore that branch before continuing`));
			assert.ok(!git(scratch.root, "branch", "--list", branch));
		} else {
			assert.match(refused.stderr, /already (?:checked out|used by worktree)/);
			assert.equal(await readFile(join(occupied, "in-progress.txt"), "utf8"), "do not replace\n");
			assert.ok(git(scratch.root, "worktree", "list", "--porcelain").includes(`worktree ${occupied}\n`));
		}
		assert.equal(existsSync(worktree), false);
		assert.deepEqual(await readdir(join(scratch.root, ".limen/jobs")), before);
	});
}

test("continue after prune leaves a live nested child owned by another checkout untouched", async (context) => {
	const scratch = await scratchRepo(continuingFakePi);
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const parent = onlyJobId(limen(scratch, "spawn", "finished parent").stdout);
	await waitForState(scratch.root, parent, "done");
	const worktree = (await readFile(join(scratch.root, ".limen/jobs", parent, "worktree"), "utf8")).trim();
	const worktreeRoot = dirname(worktree);
	const outer = join(worktreeRoot, "outer");
	const child = join(worktreeRoot, `.${basename(outer)}-limen-worktrees`, "child");
	git(scratch.root, "worktree", "add", "--detach", outer, "HEAD");
	git(outer, "worktree", "add", "--detach", child, "HEAD");
	for (const [owner, id, path] of [
		[scratch.root, "outer", outer],
		[outer, "child", child],
	] as const) {
		const job = join(owner, ".limen/jobs", id);
		await mkdir(job, { recursive: true });
		await writeFile(join(job, "state"), "running\n");
		await writeFile(join(job, "worktree"), `${path}\n`);
		await writeFile(join(job, "started-at"), `${new Date().toISOString()}\n`);
		assert.equal(await liveJob(job), true);
	}
	await writeFile(join(child, "in-progress.txt"), "live nested work\n");
	const pruned = limen(scratch, "prune");
	assert.equal(pruned.status, 0, pruned.stderr);
	assert.equal(existsSync(worktree), false);
	const launched = limen(scratch, "continue", parent, "keep going");
	assert.equal(launched.status, 0, launched.stderr);
	await waitForState(scratch.root, onlyJobId(launched.stdout), "done");
	assert.equal(existsSync(worktree), true);
	assert.equal(await readFile(join(child, "in-progress.txt"), "utf8"), "live nested work\n");
	assert.ok(git(scratch.root, "worktree", "list", "--porcelain").includes(`worktree ${child}\n`));
	assert.equal(await liveJob(join(outer, ".limen/jobs/child")), true);
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

test("continue copies the parent engine and refuses a conflicting --engine", async (context) => {
	const scratch = await scratchRepo(continuingFakePi);
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const parent = onlyJobId(limen(scratch, "spawn", "--engine", "omp", "--label", "F727 omp", "first slice").stdout);
	await waitForState(scratch.root, parent, "done");
	const launched = limen(scratch, "continue", parent, "now refine the seam");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	await waitForState(scratch.root, id, "done");
	const job = join(scratch.root, ".limen/jobs", id);
	assert.equal(await readFile(join(job, "engine"), "utf8"), "omp\n");
	assert.equal(await readFile(join(job, "versions"), "utf8"), "omp 0.0.0-test\n");
	const argv = JSON.parse(await readFile(join((await readFile(join(job, "worktree"), "utf8")).trim(), "pi-args.json"), "utf8")) as string[];
	assert.equal(argv.includes("--auto-approve"), true);
	assert.equal(argv.includes("--continue"), true);
	assert.equal(argv.includes("--approve"), false);
	const before = await readdir(join(scratch.root, ".limen/jobs"));
	const refused = limen(scratch, "continue", "--engine", "pi", parent, "switch engines");
	assert.equal(refused.status, 1);
	assert.match(refused.stderr, /continue --engine pi does not match parent engine omp/);
	assert.deepEqual(await readdir(join(scratch.root, ".limen/jobs")), before);
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
