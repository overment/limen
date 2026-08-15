import assert from "node:assert/strict";
import { access, chmod, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { git, limen, limenWithEnv, limenWithSession, onlyJobId, scratchRepo, waitForState } from "./scratch.ts";

test("spawn creates isolated branch, canonical record, runs pi, and resumes its worktree", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const inheritedHerdr = { HERDR_ENV: process.env.HERDR_ENV, HERDR_PANE_ID: process.env.HERDR_PANE_ID };
	process.env.HERDR_ENV = "1";
	process.env.HERDR_PANE_ID = "w0:p0";
	context.after(() => {
		for (const [name, value] of Object.entries(inheritedHerdr)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	});
	const launched = limenWithSession(scratch, "coordinator-a", "spawn", "--label", "F001 implementation", "make commit");
	assert.equal(launched.status, 0, launched.stderr);
	assert.match(launched.stdout, /started F001 implementation/);
	const id = onlyJobId(launched.stdout);
	assert.match(id, /^\d{4}-\d{2}-\d{2}-f001-implementation-[0-9a-f]{8}$/);
	await waitForState(scratch.root, id, "done");
	const job = join(scratch.root, ".limen/jobs", id);
	assert.equal(await readFile(join(job, "branch"), "utf8"), `limen/${id}\n`);
	assert.equal(await readFile(join(job, "task.md"), "utf8"), "make commit\n");
	assert.equal(await readFile(join(job, "label"), "utf8"), "F001 implementation\n");
	assert.equal(await readFile(join(job, "origin-session"), "utf8"), "coordinator-a\n");
	await access(join(job, "notify/subscribers/coordinator-a"));
	assert.equal(await readFile(join(job, "notify/ready"), "utf8"), "1\n");
	assert.ok(Number.isFinite(Date.parse((await readFile(join(job, "started-at"), "utf8")).trim())));
	assert.ok(Number.isFinite(Date.parse((await readFile(join(job, "finished-at"), "utf8")).trim())));
	await assert.rejects(readFile(join(job, "pid")));
	const worktreeLine = git(scratch.root, "worktree", "list", "--porcelain")
		.split("\n")
		.find((line) => line.includes(id));
	assert.ok(worktreeLine);
	const worktree = worktreeLine.slice("worktree ".length);
	assert.equal(await readFile(join(worktree, "candidate.txt"), "utf8"), "candidate\n");
	const childEnvironment = JSON.parse(await readFile(join(worktree, "pi-env.json"), "utf8")) as {
		internal?: string;
		job?: string;
		id?: string;
		label?: string;
		contextRoot?: string;
		herdr?: string[];
		pi?: string[];
	};
	assert.deepEqual(childEnvironment, { job: "1", id, label: "F001 implementation", contextRoot: await realpath(scratch.root), herdr: [], pi: [] });
	const argv = JSON.parse(await readFile(join(worktree, "pi-args.json"), "utf8")) as string[];
	assert.equal(argv[argv.indexOf("--mode") + 1], "json");
	assert.match(argv[argv.indexOf("--session-dir") + 1] ?? "", /\.limen\/jobs\/[^/]+\/session$/);
	assert.equal(argv.includes("--no-session"), false);
	assert.equal(argv.includes("--no-context-files"), false);
	assert.equal(await readFile(join(job, "last-tool"), "utf8"), "bash\n");
	assert.equal(await readFile(join(job, "tool-calls"), "utf8"), "1\n");
	const log = await readFile(join(job, "log"), "utf8");
	assert.match(log, /worker started/);
	assert.match(log, /^think$/m);
	assert.match(log, /^bash git status$/m);
	assert.notEqual(worktree, scratch.root);
	await writeFile(join(worktree, "uncommitted.txt"), "keep me\n");
	const resumed = limen(scratch, "spawn", "continue work", "--branch", `limen/${id}`);
	assert.equal(resumed.status, 0, resumed.stderr);
	const resumedId = onlyJobId(resumed.stdout);
	await waitForState(scratch.root, resumedId, "done");
	assert.equal(await readFile(join(worktree, "uncommitted.txt"), "utf8"), "keep me\n");
});

test("failure is durable and detailed jobs render facts", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const id = onlyJobId(limen(scratch, "spawn", "fail now").stdout);
	await waitForState(scratch.root, id, "failed");
	const jobs = limen(scratch, "jobs", "--all");
	assert.equal(jobs.status, 0, jobs.stderr);
	assert.match(jobs.stdout, new RegExp(`FAILED fail now · id ${id}`));
	assert.match(jobs.stdout, /tools 1 · bash/);
	assert.match(jobs.stdout, /worker exited with code 7/);
	assert.match(jobs.stdout, /fake pi completed/);
});

test("review gets fresh detached worktree and reviewer birth text", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const worker = onlyJobId(limen(scratch, "spawn", "make commit").stdout);
	await waitForState(scratch.root, worker, "done");
	const branch = `limen/${worker}`;
	const review = onlyJobId(limen(scratch, "spawn", "--review", "--branch", branch, "inspect candidate").stdout);
	await waitForState(scratch.root, review, "done");
	const worktree = git(scratch.root, "worktree", "list", "--porcelain")
		.split("\n\n")
		.find((block) => block.includes(review));
	assert.match(worktree ?? "", /detached/);
	const reviewPath = worktree?.split("\n")[0]?.slice("worktree ".length);
	assert.ok(reviewPath);
	const argv = JSON.parse(await readFile(join(reviewPath, "pi-args.json"), "utf8")) as string[];
	const prompt = argv[argv.indexOf("--append-system-prompt") + 1];
	assert.equal(argv.includes("--no-context-files"), false);
	assert.match(prompt ?? "", /Review; do not rewrite/);
	assert.equal(git(reviewPath, "rev-parse", "HEAD"), git(scratch.root, "rev-parse", branch));
});

test("stage model defaults respect review roles and explicit overrides", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const inherited = { worker: process.env.LIMEN_WORKER_MODEL, reviewer: process.env.LIMEN_REVIEWER_MODEL };
	delete process.env.LIMEN_WORKER_MODEL;
	delete process.env.LIMEN_REVIEWER_MODEL;
	context.after(() => {
		if (inherited.worker === undefined) delete process.env.LIMEN_WORKER_MODEL;
		else process.env.LIMEN_WORKER_MODEL = inherited.worker;
		if (inherited.reviewer === undefined) delete process.env.LIMEN_REVIEWER_MODEL;
		else process.env.LIMEN_REVIEWER_MODEL = inherited.reviewer;
	});
	const noDefault = onlyJobId(limen(scratch, "spawn", "no model default").stdout);
	await waitForState(scratch.root, noDefault, "done");
	assert.equal(await modelForJob(scratch.root, noDefault), undefined);
	process.env.LIMEN_WORKER_MODEL = "worker-default";
	process.env.LIMEN_REVIEWER_MODEL = "reviewer-default";
	const worker = onlyJobId(limen(scratch, "spawn", "worker model default").stdout);
	await waitForState(scratch.root, worker, "done");
	assert.equal(await modelForJob(scratch.root, worker), "worker-default");
	const review = onlyJobId(limen(scratch, "spawn", "--review", "--branch", `limen/${worker}`, "reviewer model default").stdout);
	await waitForState(scratch.root, review, "done");
	assert.equal(await modelForJob(scratch.root, review), "reviewer-default");
	const explicit = onlyJobId(limen(scratch, "spawn", "--model", "ticket-specific", "explicit model").stdout);
	await waitForState(scratch.root, explicit, "done");
	assert.equal(await modelForJob(scratch.root, explicit), "ticket-specific");
});

async function modelForJob(root: string, id: string): Promise<string | undefined> {
	const worktree = git(root, "worktree", "list", "--porcelain")
		.split("\n")
		.find((line) => line.includes(id))
		?.slice("worktree ".length);
	assert.ok(worktree, `worktree for ${id} expected`);
	const args = JSON.parse(await readFile(join(worktree, "pi-args.json"), "utf8")) as string[];
	const index = args.indexOf("--model");
	return index < 0 ? undefined : args[index + 1];
}

test("independent jobs can run concurrently and are merely announced", async (context) => {
	const fakePi = `#!/usr/bin/env node\nsetTimeout(() => { console.log("done") }, 400);\n`;
	const scratch = await scratchRepo(fakePi);
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const first = onlyJobId(limen(scratch, "spawn", "first").stdout);
	const secondLaunch = limen(scratch, "spawn", "second");
	assert.match(secondLaunch.stdout, /note: 1 job already running/);
	const second = onlyJobId(secondLaunch.stdout);
	await Promise.all([waitForState(scratch.root, first, "done"), waitForState(scratch.root, second, "done")]);
	assert.notEqual(await readFile(join(scratch.root, `.limen/jobs/${first}/branch`), "utf8"), await readFile(join(scratch.root, `.limen/jobs/${second}/branch`), "utf8"));
});

test("prune drops a finished worktree and spawn keeps a resumed one", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const first = onlyJobId(limen(scratch, "spawn", "--label", "keep later", "make commit").stdout);
	await waitForState(scratch.root, first, "done");
	const worktree = git(scratch.root, "worktree", "list", "--porcelain")
		.split("\n")
		.find((line) => line.includes(first))
		?.slice("worktree ".length);
	assert.ok(worktree);
	await writeFile(join(worktree, "uncommitted.txt"), "keep me\n");
	const second = onlyJobId(limen(scratch, "spawn", "make commit").stdout);
	await waitForState(scratch.root, second, "done");
	assert.doesNotMatch(git(scratch.root, "worktree", "list", "--porcelain"), new RegExp(first));
	const resumed = limen(scratch, "spawn", "continue work", "--branch", `limen/${first}`);
	assert.equal(resumed.status, 0, resumed.stderr);
	const resumedId = onlyJobId(resumed.stdout);
	await waitForState(scratch.root, resumedId, "done");
	const kept = git(scratch.root, "worktree", "list", "--porcelain")
		.split("\n")
		.find((line) => line.includes(resumedId || first));
	assert.ok(kept);
	const pruned = limen(scratch, "prune");
	assert.equal(pruned.status, 0, pruned.stderr);
	assert.match(pruned.stdout, /pruned /);
	assert.doesNotMatch(git(scratch.root, "worktree", "list", "--porcelain"), /limen-worktrees/);
});

test("spawn opens a named Herdr tab when a fake herdr is on PATH", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const calls = join(scratch.root, "herdr-calls.log");
	await writeFile(
		join(scratch.fakeBin, "herdr"),
		`#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)}, args.join(" ") + "\\n");
const label = args.includes("--label") ? args[args.indexOf("--label") + 1] : "";
if (args[0] === "workspace" && args[1] === "list") {
  console.log(JSON.stringify({ result: { type: "workspace_list", workspaces: [] } }));
} else if (args[0] === "workspace" && args[1] === "create") {
  console.log(JSON.stringify({ result: { type: "workspace_created", workspace: { workspace_id: "w1" }, tab: { tab_id: "w1:t1" }, root_pane: { pane_id: "w1:p1" } } }));
} else if (args[0] === "tab" && args[1] === "create") {
  console.log(JSON.stringify({ result: { type: "tab_created", tab: { tab_id: "w1:t2", label }, root_pane: { pane_id: "w1:p2" } } }));
}
`,
	);
	await chmod(join(scratch.fakeBin, "herdr"), 0o755);
	const launched = limenWithEnv(scratch, { HERDR_ENV: "1", LIMEN_HERDR: join(scratch.fakeBin, "herdr") }, "spawn", "--label", "F012 spaces", "make commit");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	await waitForState(scratch.root, id, "done");
	const recorded = await readFile(calls, "utf8");
	assert.match(recorded, /tab create /);
	assert.match(recorded, /--label F012 spaces/);
	assert.match(recorded, /--no-focus/);
	assert.match(recorded, /tab rename w1:t2 F012 spaces · done/);
	const job = join(scratch.root, ".limen/jobs", id);
	assert.equal(await readFile(join(job, "herdr/tab"), "utf8"), "w1:t2\n");
	assert.equal(await readFile(join(job, "herdr/mode"), "utf8"), "watch\n");
});
