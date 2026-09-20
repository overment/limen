import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs, { existsSync } from "node:fs";
import { access, chmod, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { defaultFakeClaude, defaultFakePi, git, limen, limenWithEnv, limenWithInput, limenWithSession, onlyJobId, scratchRepo, waitForState, writeFakeClaude } from "./scratch.ts";

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
	assert.equal(await readFile(join(job, "role"), "utf8"), "worker\n");
	assert.equal(await readFile(join(job, "origin-session"), "utf8"), "coordinator-a\n");
	await access(join(job, "notify/subscribers/coordinator-a"));
	assert.equal(await readFile(join(job, "notify/ready"), "utf8"), "1\n");
	assert.equal(await readFile(join(job, "versions"), "utf8"), "pi 0.0.0-test\n");
	assert.match(limen(scratch, "jobs", id).stdout, /versions:\n    pi 0\.0\.0-test/);
	assert.doesNotMatch(limen(scratch, "jobs", id).stdout, /herdr/);
	assert.ok(Number.isFinite(Date.parse((await readFile(join(job, "started-at"), "utf8")).trim())));
	assert.ok(Number.isFinite(Date.parse((await readFile(join(job, "finished-at"), "utf8")).trim())));
	await assert.rejects(readFile(join(job, "pid")));
	// F017: the wake carries what landed — base at spawn, commits and the final assistant message at finalize.
	assert.equal((await readFile(join(job, "base"), "utf8")).trim(), git(scratch.root, "rev-parse", "main"));
	assert.equal(await readFile(join(job, "result"), "utf8"), "fake pi completed\n");
	const commits = await readFile(join(job, "commits"), "utf8");
	assert.match(commits, /^[0-9a-f]+ candidate\n$/);
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
	assert.equal(argv.includes("--no-extensions"), true);
	assert.match(argv[argv.indexOf("--extension") + 1] ?? "", /hook\/steering\.ts$/);
	assert.equal(argv[argv.indexOf("--append-system-prompt") + 1], await readFile(new URL("../templates/worker.md", import.meta.url), "utf8"));
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
	assert.equal((await readFile(join(scratch.root, ".limen/jobs", resumedId, "base"), "utf8")).trim(), git(scratch.root, "rev-parse", `limen/${id}`));
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

test("a project worker overlay replaces the package birth text", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	await writeFile(join(scratch.root, ".agents/limen/worker.md"), "OVERLAY WORKER\n");
	const id = onlyJobId(limen(scratch, "spawn", "no model default").stdout);
	await waitForState(scratch.root, id, "done");
	const worktree = git(scratch.root, "worktree", "list", "--porcelain")
		.split("\n")
		.find((line) => line.includes(id))
		?.slice("worktree ".length);
	assert.ok(worktree);
	const argv = JSON.parse(await readFile(join(worktree, "pi-args.json"), "utf8")) as string[];
	assert.equal(argv[argv.indexOf("--append-system-prompt") + 1], "OVERLAY WORKER\n");
});

test("review gets fresh detached worktree and reviewer birth text", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const worker = onlyJobId(limen(scratch, "spawn", "make commit").stdout);
	await waitForState(scratch.root, worker, "done");
	const branch = `limen/${worker}`;
	const candidateSha = git(scratch.root, "rev-parse", branch);
	const review = onlyJobId(limen(scratch, "spawn", "--review", "--branch", branch, "inspect candidate").stdout);
	await waitForState(scratch.root, review, "done");
	const reviewJob = join(scratch.root, ".limen/jobs", review);
	await assert.rejects(readFile(join(reviewJob, "hosted")));
	assert.equal(await readFile(join(reviewJob, "candidate"), "utf8"), `${candidateSha}\n`);
	assert.equal(await readFile(join(reviewJob, "role"), "utf8"), "reviewer\n");
	const reviewTask = await readFile(join(reviewJob, "task.md"), "utf8");
	assert.equal(reviewTask, `inspect candidate\n\nCandidate commit: ${candidateSha}.\n`);
	await assert.rejects(readFile(join(scratch.root, ".limen/jobs", worker, "candidate")));
	assert.match(limen(scratch, "jobs", review).stdout, new RegExp(`candidate ${candidateSha}`));
	assert.equal((await readFile(join(reviewJob, "base"), "utf8")).trim(), git(scratch.root, "rev-parse", branch));
	assert.equal(await readFile(join(reviewJob, "commits"), "utf8"), "");
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
	const packageDefault = onlyJobId(limen(scratch, "spawn", "package model default").stdout);
	await waitForState(scratch.root, packageDefault, "done");
	assert.equal(await modelForJob(scratch.root, packageDefault), "openai-codex/gpt-6-astra:high");
	const reviewDefault = onlyJobId(limen(scratch, "spawn", "--review", "--branch", `limen/${packageDefault}`, "requested review default").stdout);
	await waitForState(scratch.root, reviewDefault, "done");
	assert.equal(await modelForJob(scratch.root, reviewDefault), "openai-codex/gpt-6-astra:high");
	process.env.LIMEN_WORKER_MODEL = "   ";
	const blank = onlyJobId(limen(scratch, "spawn", "blank stage default").stdout);
	await waitForState(scratch.root, blank, "done");
	assert.equal(await modelForJob(scratch.root, blank), "openai-codex/gpt-6-astra:high");
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
	const explicitReview = onlyJobId(limen(scratch, "spawn", "--review", "--branch", `limen/${worker}`, "--model", "review-specific", "explicit review model").stdout);
	await waitForState(scratch.root, explicitReview, "done");
	assert.equal(await modelForJob(scratch.root, explicitReview), "review-specific");
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
if (args[0] === "--version") { console.log("0.0.0-test"); process.exit(0); }
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
	const launched = limenWithEnv(scratch, { HERDR_ENV: "1", LIMEN_HERDR: join(scratch.fakeBin, "herdr") }, "spawn", "--detached", "--label", "F012 spaces", "make commit");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	await waitForState(scratch.root, id, "done");
	const deadline = Date.now() + 2_000;
	let recorded = "";
	while (Date.now() < deadline) {
		recorded = await readFile(calls, "utf8").catch(() => "");
		if (/tab close w1:t2/.test(recorded)) break;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	assert.match(recorded, /tab create /);
	assert.match(recorded, /--label F012 spaces/);
	assert.match(recorded, /--no-focus/);
	assert.match(recorded, /tab close w1:t2/);
	const job = join(scratch.root, ".limen/jobs", id);
	assert.equal(await readFile(join(job, "herdr/tab"), "utf8"), "w1:t2\n");
	assert.equal(await readFile(join(job, "herdr/mode"), "utf8"), "watch\n");
	assert.equal(await readFile(join(job, "versions"), "utf8"), "pi 0.0.0-test\nherdr 0.0.0-test\n");
	assert.match(limen(scratch, "jobs", id).stdout, /versions:\n    pi 0\.0\.0-test\n    herdr 0\.0\.0-test/);
});

test("spawn prints failed when the wrapper dies before writing pid", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const launched = limenWithEnv(scratch, { LIMEN_PI: "" }, "spawn", "--label", "boom", "do work");
	assert.equal(launched.status, 0, launched.stderr);
	assert.match(launched.stdout, /failed boom/);
	assert.doesNotMatch(launched.stdout, /started/);
	const id = onlyJobId(launched.stdout);
	assert.equal((await readFile(join(scratch.root, ".limen/jobs", id, "state"), "utf8")).trim(), "failed");
});

test("spawn without pi on PATH fails before worktree add", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	await rm(join(scratch.fakeBin, "pi"));
	const launched = limenWithEnv(scratch, { PATH: "/nonexistent" }, "spawn", "do work");
	assert.equal(launched.status, 1);
	assert.match(launched.stderr, /pi is not on PATH/);
	assert.deepEqual(await readdir(join(scratch.root, ".limen/jobs")).catch(() => []), []);
	assert.doesNotMatch(git(scratch.root, "worktree", "list"), /limen-worktrees/);
});

test("LIMEN_PREFLIGHT=auth fails spawn with pi's message and creates no job", async (context) => {
	const scratch = await scratchRepo(`#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "auth") { console.error("provider rejected token"); process.exit(2); }
process.exit(0);
`);
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const launched = limenWithEnv(scratch, { LIMEN_PREFLIGHT: "auth" }, "spawn", "--model", "ticket-specific", "do work");
	assert.equal(launched.status, 1);
	assert.match(launched.stderr, /provider rejected token/);
	assert.deepEqual(await readdir(join(scratch.root, ".limen/jobs")).catch(() => []), []);
	assert.doesNotMatch(git(scratch.root, "worktree", "list"), /limen-worktrees/);
});

test("explicit provider reaches authentication preflight without a fallback job", async (context) => {
	const scratch = await scratchRepo(`#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "auth") {
  require("node:fs").writeFileSync("auth-args.json", JSON.stringify(args));
  console.error("requested provider refused");
  process.exit(2);
}
process.exit(0);
`);
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const launched = limenWithEnv(scratch, { LIMEN_PREFLIGHT: "auth" }, "spawn", "--provider", "openai-codex", "--model", "gpt-6-astra", "--thinking", "high", "do work");
	assert.equal(launched.status, 1);
	assert.match(launched.stderr, /requested provider refused/);
	assert.deepEqual(JSON.parse(await readFile(join(scratch.root, "auth-args.json"), "utf8")), ["auth", "check", "--provider", "openai-codex", "--model", "gpt-6-astra"]);
	assert.deepEqual(await readdir(join(scratch.root, ".limen/jobs")).catch(() => []), []);
});

test("Pi-only flags are refused for Claude before creating a job", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	for (const flags of [
		["--provider", "openai-codex"],
		["--thinking", "high"],
	]) {
		const launched = limen(scratch, "spawn", "--engine", "claude", "--detached", ...flags, "do work");
		assert.equal(launched.status, 1);
		assert.match(launched.stderr, /Pi options/);
	}
	assert.deepEqual(await readdir(join(scratch.root, ".limen/jobs")).catch(() => []), []);
});

test("LIMEN_PREFLIGHT=auth proceeds when check passes", async (context) => {
	const scratch = await scratchRepo(defaultFakePi.replace('if (args[0] === "auth") process.exit(1);', 'if (args[0] === "auth") process.exit(0);'));
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const launched = limenWithEnv(scratch, { LIMEN_PREFLIGHT: "auth" }, "spawn", "--model", "ticket-specific", "no model default");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	await waitForState(scratch.root, id, "done");
	assert.equal(await readFile(join(scratch.root, ".limen/jobs", id, "versions"), "utf8"), "pi 0.0.0-test\n");
});

test("task-file and stdin write task.md bytes untouched", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const bytes = Buffer.from("do `echo` and $(date)\n\nkeep trailing\n");
	await writeFile(join(scratch.root, "hand.md"), bytes);
	const fromFile = limen(scratch, "spawn", "--task-file", "hand.md", "--label", "file task");
	assert.equal(fromFile.status, 0, fromFile.stderr);
	const fileId = onlyJobId(fromFile.stdout);
	await waitForState(scratch.root, fileId, "done");
	assert.deepEqual(await readFile(join(scratch.root, ".limen/jobs", fileId, "task.md")), bytes);
	const fromStdin = limenWithInput(scratch, bytes.toString("utf8"), "spawn", "--task-file", "-", "--label", "stdin task");
	assert.equal(fromStdin.status, 0, fromStdin.stderr);
	const stdinId = onlyJobId(fromStdin.stdout);
	await waitForState(scratch.root, stdinId, "done");
	assert.equal(await readFile(join(scratch.root, ".limen/jobs", stdinId, "task.md"), "utf8"), bytes.toString("utf8"));
});

test("spawn warns on a number-only or live-duplicate label and still starts", async (context) => {
	const scratch = await scratchRepo(`#!/usr/bin/env node
process.on("SIGTERM", () => process.exit(0));
setInterval(() => {}, 1000);
`);
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const numberOnly = limen(scratch, "spawn", "--label", "F068", "do work");
	assert.equal(numberOnly.status, 0, numberOnly.stderr);
	assert.match(numberOnly.stdout, /warning: label is only a feature number/);
	assert.match(numberOnly.stdout, /started F068/);
	const numberId = onlyJobId(numberOnly.stdout);
	assert.match(numberId, /^\d{4}-\d{2}-\d{2}-f068-[0-9a-f]{8}$/);
	const label = "idle backstop · F065";
	const first = limen(scratch, "spawn", "--label", label, "long work");
	assert.equal(first.status, 0, first.stderr);
	assert.doesNotMatch(first.stdout, /already holds this label/);
	const firstId = onlyJobId(first.stdout);
	assert.match(firstId, /^\d{4}-\d{2}-\d{2}-f065-idle-backstop-[0-9a-f]{8}$/);
	const duplicate = limen(scratch, "spawn", "--label", label, "long work");
	assert.equal(duplicate.status, 0, duplicate.stderr);
	assert.match(duplicate.stdout, /warning: a live job already holds this label/);
	assert.match(duplicate.stdout, /started idle backstop · F065/);
	assert.doesNotMatch(duplicate.stdout, /only a feature number/);
	const duplicateId = onlyJobId(duplicate.stdout);
	assert.notEqual(duplicateId, firstId);
	assert.match(duplicateId, /^\d{4}-\d{2}-\d{2}-f065-idle-backstop-[0-9a-f]{8}$/);
	for (const id of [numberId, firstId, duplicateId]) {
		assert.equal(limen(scratch, "stop", id, "test cleanup").status, 0);
		await waitForState(scratch.root, id, "stopped");
	}
});

test("positional empty backticks or doubled spaces warn once", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const launched = limen(scratch, "spawn", "--label", "warn", "fix `` and  gaps");
	assert.equal(launched.status, 0, launched.stderr);
	assert.match(launched.stdout, /warning: empty backticks or doubled spaces/);
	await waitForState(scratch.root, onlyJobId(launched.stdout), "done");
});

test("git missing from PATH falls back or leaves no job dir", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const launched = limenWithEnv(scratch, { PATH: `${scratch.fakeBin}:${dirname(process.execPath)}` }, "spawn", "--label", "no path git", "do work");
	if (launched.status === 0) {
		const id = onlyJobId(launched.stdout);
		await waitForState(scratch.root, id, "done");
		return;
	}
	assert.match(launched.stderr, /git is not on PATH/);
	assert.deepEqual(await readdir(join(scratch.root, ".limen/jobs")).catch(() => []), []);
});

test("spawn --role quality loads the packaged preamble", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const launched = limen(scratch, "spawn", "--role", "quality", "--label", "quality pass", "write findings");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	await waitForState(scratch.root, id, "done");
	const job = join(scratch.root, ".limen/jobs", id);
	assert.equal(await readFile(join(job, "role"), "utf8"), "quality\n");
	const worktree = (await readFile(join(job, "worktree"), "utf8")).trim();
	const argv = JSON.parse(await readFile(join(worktree, "pi-args.json"), "utf8")) as string[];
	assert.equal(argv[argv.indexOf("--append-system-prompt") + 1], await readFile(new URL("../templates/quality.md", import.meta.url), "utf8"));
});

test("spawn --role loads that overlay preamble and persists the name", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	await writeFile(join(scratch.root, ".agents/limen/researcher.md"), "RESEARCH PREAMBLE\n");
	const launched = limen(scratch, "spawn", "--role", "researcher", "--label", "F069 research", "look around");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	await waitForState(scratch.root, id, "done");
	const job = join(scratch.root, ".limen/jobs", id);
	assert.equal(await readFile(join(job, "role"), "utf8"), "researcher\n");
	const worktree = (await readFile(join(job, "worktree"), "utf8")).trim();
	const argv = JSON.parse(await readFile(join(worktree, "pi-args.json"), "utf8")) as string[];
	assert.equal(argv[argv.indexOf("--append-system-prompt") + 1], "RESEARCH PREAMBLE\n");
});

test("spawn --role picture loads the packaged preamble", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const launched = limen(scratch, "spawn", "--role", "picture", "--detached", "--label", "living diagram", "shape that moved: a job kind");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	await waitForState(scratch.root, id, "done");
	const job = join(scratch.root, ".limen/jobs", id);
	assert.equal(await readFile(join(job, "role"), "utf8"), "picture\n");
	const worktree = (await readFile(join(job, "worktree"), "utf8")).trim();
	const argv = JSON.parse(await readFile(join(worktree, "pi-args.json"), "utf8")) as string[];
	assert.equal(argv[argv.indexOf("--append-system-prompt") + 1], await readFile(new URL("../templates/picture.md", import.meta.url), "utf8"));
});

test("spawn --role researcher and --role judge load the packaged preambles", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	for (const role of ["researcher", "judge"] as const) {
		const launched = limen(scratch, "spawn", "--role", role, "--detached", "--label", `F070 ${role}`, "named source");
		assert.equal(launched.status, 0, launched.stderr);
		const id = onlyJobId(launched.stdout);
		await waitForState(scratch.root, id, "done");
		assert.equal(await readFile(join(scratch.root, ".limen/jobs", id, "role"), "utf8"), `${role}\n`);
		const worktree = (await readFile(join(scratch.root, ".limen/jobs", id, "worktree"), "utf8")).trim();
		const argv = JSON.parse(await readFile(join(worktree, "pi-args.json"), "utf8")) as string[];
		assert.equal(argv[argv.indexOf("--append-system-prompt") + 1], await readFile(new URL(`../templates/${role}.md`, import.meta.url), "utf8"));
	}
});

test("spawn --role without a preamble or with --review plants no job", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const missing = limen(scratch, "spawn", "--role", "ghost", "look around");
	assert.equal(missing.status, 1);
	assert.match(missing.stderr, /no preamble for role ghost/);
	const combined = limen(scratch, "spawn", "--role", "researcher", "--review", "--branch", "limen/ghost", "inspect candidate");
	assert.equal(combined.status, 1);
	assert.match(combined.stderr, /--role and --review cannot be combined/);
	assert.deepEqual(await readdir(join(scratch.root, ".limen/jobs")).catch(() => []), []);
	assert.doesNotMatch(git(scratch.root, "worktree", "list"), /limen-worktrees/);
});

test("LIMEN_PREPARE runs in the worktree before Pi and is logged", async (context) => {
	const scratch = await scratchRepo(`#!/usr/bin/env node
const { existsSync } = require("node:fs");
if (!existsSync("prepared")) process.exit(9);
console.log(JSON.stringify({ type: "agent_start" }));
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } }));
`);
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const launched = limenWithEnv(scratch, { LIMEN_PREPARE: "touch prepared" }, "spawn", "--label", "prep", "do work");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	await waitForState(scratch.root, id, "done");
	const worktree = (await readFile(join(scratch.root, ".limen/jobs", id, "worktree"), "utf8")).trim();
	await access(join(worktree, "prepared"));
	assert.match(await readFile(join(scratch.root, ".limen/jobs", id, "log"), "utf8"), /prepare: touch prepared/);
});

test("F074: a claude job keeps the ordinary record and files the closing result", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	await writeFakeClaude(scratch.fakeBin, defaultFakeClaude);
	assert.equal(limen(scratch, "init").status, 0);
	const launched = limen(scratch, "spawn", "--role", "advisor", "--engine", "claude", "--detached", "--label", "narrow import form · F074", "should the import be narrow?");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	await waitForState(scratch.root, id, "done");
	const job = join(scratch.root, ".limen/jobs", id);
	assert.equal(await readFile(join(job, "engine"), "utf8"), "claude\n");
	assert.equal(await readFile(join(job, "role"), "utf8"), "advisor\n");
	assert.equal(await readFile(join(job, "result"), "utf8"), "ship the narrow form; it costs the bulk import\n");
	assert.equal(await readFile(join(job, "claude-session"), "utf8"), "fake-claude-session\n");
	assert.equal(await readFile(join(job, "last-tool"), "utf8"), "Bash\n");
	assert.equal(await readFile(join(job, "tool-calls"), "utf8"), "1\n");
	assert.match(await readFile(join(job, "versions"), "utf8"), /claude 0\.0\.0-test/);
	const log = await readFile(join(job, "log"), "utf8");
	assert.match(log, /worker started \(claude\)/);
	assert.match(log, /^Bash git status$/m);
	assert.match(log, /^looked at the worktree$/m);
	assert.equal(log.split("ship the narrow form; it costs the bulk import").length - 1, 1, "the filed answer reaches the log once");
	assert.match(log, /done: claude exited 0/);
	assert.match(limen(scratch, "jobs", id).stdout, /engine claude/);
	const worktree = (await readFile(join(job, "worktree"), "utf8")).trim();
	const argv = JSON.parse(await readFile(join(worktree, "claude-args.json"), "utf8")) as string[];
	assert.equal(argv[argv.indexOf("--output-format") + 1], "stream-json");
	assert.equal(argv[argv.indexOf("--permission-mode") + 1], "bypassPermissions");
	assert.match(argv[argv.indexOf("--append-system-prompt") + 1] ?? "", /You answer one question with a perspective/);
	assert.equal(argv.includes("--session-dir"), false);
	assert.equal(argv.includes("--model"), false, "the Pi package default must not reach Claude");
	// The engine is a spawn choice, not a resumable session: continue says so instead of failing on a missing transcript.
	assert.match(limen(scratch, "continue", id, "say more").stderr, /ran on claude/);
});

test("F074: a claude job refuses a hosted tab, and an unknown engine is named", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	await writeFakeClaude(scratch.fakeBin, defaultFakeClaude);
	limen(scratch, "init");
	assert.match(limen(scratch, "spawn", "--engine", "claude", "--tab", "look").stderr, /no interactive tab; pass --detached/);
	assert.match(limen(scratch, "spawn", "--engine", "gpt", "look").stderr, /--engine must be pi or claude/);
	const failed = onlyJobId(limen(scratch, "spawn", "--engine", "claude", "--detached", "--label", "boom", "fail now").stdout);
	await waitForState(scratch.root, failed, "failed");
	assert.match(await readFile(join(scratch.root, ".limen/jobs", failed, "stop-reason"), "utf8"), /error: error_during_execution/);
});

test("spawn refuses a ticket missing from the base commit and starts when it is committed", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const path = "spec/features/active/F714-spawn-fails-closed-without-ticket/ticket.md";
	const task = `do work Ticket: ${path}`;
	const missing = limen(scratch, "spawn", task);
	assert.equal(missing.status, 1);
	assert.match(missing.stderr, /ticket spec\/features\/active\/F714-spawn-fails-closed-without-ticket\/ticket\.md is missing from the base commit/);
	assert.deepEqual(await readdir(join(scratch.root, ".limen/jobs")), []);
	assert.doesNotMatch(git(scratch.root, "worktree", "list"), /limen-worktrees/);
	assert.doesNotMatch(git(scratch.root, "branch"), /limen\//);
	await mkdir(join(scratch.root, "spec/features/active/F714-spawn-fails-closed-without-ticket"), { recursive: true });
	await writeFile(join(scratch.root, path), "outcome\n");
	const untracked = limen(scratch, "spawn", task);
	assert.equal(untracked.status, 1);
	assert.match(untracked.stderr, /missing from the base commit/);
	assert.deepEqual(await readdir(join(scratch.root, ".limen/jobs")), []);
	assert.doesNotMatch(git(scratch.root, "worktree", "list"), /limen-worktrees/);
	assert.doesNotMatch(git(scratch.root, "branch"), /limen\//);
	git(scratch.root, "add", path);
	git(scratch.root, "commit", "-m", "ticket");
	const committed = limen(scratch, "spawn", task);
	assert.equal(committed.status, 0, committed.stderr);
	await waitForState(scratch.root, onlyJobId(committed.stdout), "done");
});

test("spawn --branch checks the ticket against that branch, not the caller's tree", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const first = onlyJobId(limen(scratch, "spawn", "make commit").stdout);
	await waitForState(scratch.root, first, "done");
	const branch = `limen/${first}`;
	const jobsBefore = await readdir(join(scratch.root, ".limen/jobs"));
	const worktreesBefore = git(scratch.root, "worktree", "list");
	const path = "spec/features/active/F714-resume/ticket.md";
	await mkdir(join(scratch.root, "spec/features/active/F714-resume"), { recursive: true });
	await writeFile(join(scratch.root, path), "dirty\n");
	const dirty = limen(scratch, "spawn", "--branch", branch, `continue Ticket: ${path}`);
	assert.equal(dirty.status, 1);
	assert.match(dirty.stderr, /ticket spec\/features\/active\/F714-resume\/ticket\.md is missing from the base commit/);
	assert.deepEqual(await readdir(join(scratch.root, ".limen/jobs")), jobsBefore);
	assert.equal(git(scratch.root, "worktree", "list"), worktreesBefore);
	const worktree = (await readFile(join(scratch.root, ".limen/jobs", first, "worktree"), "utf8")).trim();
	await mkdir(join(worktree, "spec/features/active/F714-resume"), { recursive: true });
	await writeFile(join(worktree, path), "on branch\n");
	git(worktree, "add", path);
	git(worktree, "commit", "-m", "ticket on branch");
	const resumed = limen(scratch, "spawn", "--branch", branch, `continue Ticket: ${path}`);
	assert.equal(resumed.status, 0, resumed.stderr);
	await waitForState(scratch.root, onlyJobId(resumed.stdout), "done");
});

test("overlapping starts keep both worktrees; prune still drops a genuine leftover", { timeout: 120_000 }, async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const waitingRoot = join(scratch.root, "prepare-waiting");
	const gate = join(scratch.root, "prepare-gate");
	const prepareScript = join(scratch.root, "wait-prepare.cjs");
	await writeFile(
		prepareScript,
		`const { writeFileSync, existsSync, mkdirSync } = require("node:fs");
const { basename, join } = require("node:path");
mkdirSync(${JSON.stringify(waitingRoot)}, { recursive: true });
writeFileSync(join(${JSON.stringify(waitingRoot)}, basename(process.cwd())), "1");
while (!existsSync(${JSON.stringify(gate)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
`,
	);
	const prepare = `node ${JSON.stringify(prepareScript)}`;
	const first = startLimen(scratch, ["spawn", "--prepare", prepare, "--label", "first start", "do work"]);
	let second: ReturnType<typeof startLimen> | undefined;
	context.after(async () => {
		await writeFile(gate, "1\n").catch(() => {});
		await Promise.race([
			Promise.all([first.output, second?.output ?? Promise.resolve()]).then(
				() => undefined,
				() => undefined,
			),
			delay(10_000),
		]);
		await first.settle();
		await second?.settle();
	});
	const firstId = await waitForInFlightJob(scratch.root);
	const firstJob = join(scratch.root, ".limen/jobs", firstId);
	const firstWorktree = (await readFile(join(firstJob, "worktree"), "utf8")).trim();
	await access(firstWorktree);
	await assert.rejects(access(join(firstJob, "state")));
	second = startLimen(scratch, ["spawn", "--prepare", prepare, "--label", "second start", "do work"]);
	await waitFor("second start did not reach prepare", async () => (await readdir(waitingRoot).catch(() => [])).length >= 2, 30_000);
	await access(firstJob);
	await access(firstWorktree);
	assert.equal(await readFile(join(firstJob, "task.md"), "utf8"), "do work\n");
	const secondId = (await readdir(join(scratch.root, ".limen/jobs"))).find((id) => id !== firstId);
	assert.ok(secondId, "second job record missing after overlapping start");
	const secondJob = join(scratch.root, ".limen/jobs", secondId);
	const secondWorktree = (await readFile(join(secondJob, "worktree"), "utf8")).trim();
	await access(secondWorktree);
	const leftover = join(scratch.root, ".limen/jobs/half-written");
	await mkdir(leftover);
	await writeFile(join(leftover, "task.md"), "half\n");
	const staleId = "2000-01-01-stale-start-aaaaaaaa";
	const staleJob = join(scratch.root, ".limen/jobs", staleId);
	const staleWorktree = join(dirname(scratch.root), `.${basename(scratch.root)}-limen-worktrees`, staleId);
	await mkdir(staleJob);
	await writeFile(join(staleJob, "task.md"), "interrupted\n");
	await writeFile(join(staleJob, "started-at"), "2000-01-01T00:00:00.000Z\n");
	await writeFile(join(staleJob, "worktree"), `${staleWorktree}\n`);
	git(scratch.root, "worktree", "add", "--detach", staleWorktree, "HEAD");
	const pruned = limen(scratch, "prune");
	assert.equal(pruned.status, 0, pruned.stderr);
	await access(firstJob);
	await access(firstWorktree);
	await access(secondJob);
	await access(secondWorktree);
	await assert.rejects(access(join(firstJob, "state")));
	await assert.rejects(access(leftover));
	await assert.rejects(access(staleJob));
	await assert.rejects(access(staleWorktree));
	await writeFile(gate, "1\n");
	assert.ok(second);
	const [firstResult, secondResult] = await Promise.all([first.output, second.output]);
	assert.equal(firstResult.status, 0, firstResult.stderr);
	assert.equal(secondResult.status, 0, secondResult.stderr);
	assert.equal(onlyJobId(firstResult.stdout), firstId);
	assert.equal(onlyJobId(secondResult.stdout), secondId);
	await Promise.all([waitForState(scratch.root, firstId, "done"), waitForState(scratch.root, secondId, "done")]);
	await access(firstJob);
	await access(secondJob);
});

test("a second spawn cannot delete a worktree still being added", { timeout: 120_000 }, async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const delayFile = join(scratch.root, "delay-worktree");
	const addedFile = join(scratch.root, "worktree-added");
	await writeFile(delayFile, "1\n");
	const realGit = ["/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"].find((path) => existsSync(path));
	assert.ok(realGit, "real git binary not found");
	await writeFile(
		join(scratch.fakeBin, "git"),
		`#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const { existsSync, writeFileSync } = require("node:fs");
const result = spawnSync(${JSON.stringify(realGit)}, process.argv.slice(2), { encoding: "utf8" });
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.status === 0 && process.argv.includes("worktree") && process.argv.includes("add") && existsSync(${JSON.stringify(delayFile)}) && !existsSync(${JSON.stringify(addedFile)})) {
  writeFileSync(${JSON.stringify(addedFile)}, "1");
  while (existsSync(${JSON.stringify(delayFile)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
}
process.exit(result.status ?? 1);
`,
	);
	await chmod(join(scratch.fakeBin, "git"), 0o755);
	const first = startLimen(scratch, ["spawn", "--label", "worktree first", "do work"]);
	context.after(async () => {
		await rm(delayFile, { force: true }).catch(() => {});
		await Promise.race([
			first.output.then(
				() => undefined,
				() => undefined,
			),
			delay(10_000),
		]);
		await first.settle();
	});
	await waitFor(
		`first worktree add never paused\n${addedFile}`,
		async () =>
			access(addedFile).then(
				() => true,
				() => false,
			),
		30_000,
	);
	const worktreeRoot = join(dirname(scratch.root), `.${basename(scratch.root)}-limen-worktrees`);
	const planted = (await readdir(worktreeRoot)).filter((name) => !name.startsWith("."));
	assert.equal(planted.length, 1, `expected one in-flight worktree, got ${planted.join(",")}`);
	const firstWorktree = join(worktreeRoot, planted[0] ?? "");
	await access(firstWorktree);
	const second = limen(scratch, "spawn", "--label", "worktree second", "do work");
	assert.equal(second.status, 0, second.stderr);
	const secondId = onlyJobId(second.stdout);
	await waitForState(scratch.root, secondId, "done");
	await access(firstWorktree);
	assert.match(git(scratch.root, "worktree", "list", "--porcelain"), new RegExp(planted[0] ?? ""));
	await rm(delayFile);
	const firstResult = await first.output;
	assert.equal(firstResult.status, 0, firstResult.stderr);
	const firstId = onlyJobId(firstResult.stdout);
	await waitForState(scratch.root, firstId, "done");
	await access(join(scratch.root, ".limen/jobs", firstId));
	await access(join(scratch.root, ".limen/jobs", secondId));
});

test("prune between job-directory creation and marker writes cannot delete the start", { timeout: 120_000 }, async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const root = await realpath(scratch.root);
	const jobsRoot = `${root}/.limen/jobs`;
	const originalMkdir = fs.promises.mkdir;
	const originalRename = fs.promises.rename;
	let interleaved = 0;
	const previousEnv = { ...process.env };
	const pruneAfterPublish = async (jobDir: string) => {
		interleaved += 1;
		const { pruneFinishedWorktrees } = await import("../src/commands/prune.ts");
		await pruneFinishedWorktrees(root);
		assert.ok(existsSync(jobDir), `prune deleted in-flight job directory ${jobDir}`);
		assert.ok(existsSync(`${jobDir}/started-at`) && existsSync(`${jobDir}/worktree`), `prune stripped in-flight markers from ${jobDir}`);
	};
	try {
		process.env.PATH = `${scratch.fakeBin}:${process.env.PATH}`;
		process.env.LIMEN_HERDR = "0";
		process.env.LIMEN_HUNK = "0";
		process.env.LIMEN_FINISH_WEBHOOK_ENV = "";
		for (const name of Object.keys(process.env)) {
			if (name.startsWith("HERDR_") || name === "PI_SESSION_ID" || name === "PI_SESSION_FILE") delete process.env[name];
		}
		fs.promises.mkdir = (async (path: Parameters<typeof originalMkdir>[0], options?: Parameters<typeof originalMkdir>[1]) => {
			const result = await originalMkdir(path, options as never);
			const text = String(path);
			if (text.startsWith(`${jobsRoot}/`) && !text.slice(jobsRoot.length + 1).includes("/") && options === undefined) await pruneAfterPublish(text);
			return result;
		}) as typeof originalMkdir;
		fs.promises.rename = (async (from: Parameters<typeof originalRename>[0], to: Parameters<typeof originalRename>[1]) => {
			const result = await originalRename(from, to);
			const text = String(to);
			if (text.startsWith(`${jobsRoot}/`) && !text.slice(jobsRoot.length + 1).includes("/")) await pruneAfterPublish(text);
			return result;
		}) as typeof originalRename;
		syncBuiltinESMExports();
		const { spawnCommand } = await import("../src/commands/spawn.ts");
		await spawnCommand(["--detached", "--label", "publication probe", "do work"], root);
		assert.ok(interleaved > 0, "spawn published no job directory for prune to interleave");
		const ids = await readdir(jobsRoot);
		assert.equal(ids.length, 1);
		const id = ids[0];
		assert.ok(id);
		await waitForState(root, id, "done");
	} finally {
		fs.promises.mkdir = originalMkdir;
		fs.promises.rename = originalRename;
		syncBuiltinESMExports();
		for (const name of Object.keys(process.env)) {
			if (!(name in previousEnv)) delete process.env[name];
		}
		Object.assign(process.env, previousEnv);
	}
});

test("overlapping-start helpers reap gated children after a forced failure", { timeout: 120_000 }, async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const waitingRoot = join(scratch.root, "prepare-waiting");
	const gate = join(scratch.root, "prepare-gate");
	const prepareScript = join(scratch.root, "wait-prepare.cjs");
	await writeFile(
		prepareScript,
		`const { writeFileSync, existsSync, mkdirSync } = require("node:fs");
const { basename, join } = require("node:path");
mkdirSync(${JSON.stringify(waitingRoot)}, { recursive: true });
writeFileSync(join(${JSON.stringify(waitingRoot)}, basename(process.cwd())), "1");
while (!existsSync(${JSON.stringify(gate)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
`,
	);
	const started = startLimen(scratch, ["spawn", "--prepare", `node ${JSON.stringify(prepareScript)}`, "--label", "forced fail", "do work"]);
	context.after(() => started.settle());
	await waitForInFlightJob(scratch.root);
	await waitFor("prepare did not start", async () => (await readdir(waitingRoot).catch(() => [])).length >= 1, 30_000);
	const before = matchingProcesses(prepareScript);
	assert.ok(before.length > 0, `expected gated prepare still running\n${before.join("\n")}`);
	console.log(`forced-failure before settle:\n${before.join("\n")}`);
	await started.settle();
	const after = matchingProcesses(prepareScript);
	console.log(`forced-failure after settle:\n${after.join("\n") || "(none)"}`);
	assert.equal(after.length, 0, `gated child survived settle\n${after.join("\n")}`);
});

function startLimen(scratch: { readonly root: string; readonly fakeBin: string }, args: readonly string[], env: NodeJS.ProcessEnv = {}) {
	const child = spawn(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`import { limenWithEnv } from ${JSON.stringify(new URL("./scratch.ts", import.meta.url).href)};
const result = limenWithEnv(${JSON.stringify({ root: scratch.root, fakeBin: scratch.fakeBin })}, ${JSON.stringify(env)}, ...${JSON.stringify(args)});
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exit(result.status);`,
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	let stdout = "";
	let stderr = "";
	child.stdout?.setEncoding("utf8");
	child.stderr?.setEncoding("utf8");
	child.stdout?.on("data", (chunk) => {
		stdout += chunk;
	});
	child.stderr?.on("data", (chunk) => {
		stderr += chunk;
	});
	const output = new Promise<{ readonly stdout: string; readonly stderr: string; readonly status: number }>((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (status) => resolve({ stdout, stderr, status: status ?? 1 }));
	});
	const settle = async () => {
		const pid = child.pid;
		const tree = pid ? [pid, ...descendantPids(pid)] : [];
		for (const target of tree) {
			try {
				process.kill(target, "SIGTERM");
			} catch {}
		}
		await Promise.race([
			output.then(
				() => undefined,
				() => undefined,
			),
			delay(1_000),
		]);
		for (const target of new Set([...tree, ...(pid ? descendantPids(pid) : [])])) {
			try {
				process.kill(target, "SIGKILL");
			} catch {}
		}
		await Promise.race([
			output.then(
				() => undefined,
				() => undefined,
			),
			delay(1_000),
		]);
	};
	return { child, output, settle };
}

async function waitForInFlightJob(root: string): Promise<string> {
	const jobsRoot = join(root, ".limen/jobs");
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		for (const id of await readdir(jobsRoot).catch(() => [] as string[])) {
			const hasTask = await access(join(jobsRoot, id, "task.md")).then(
				() => true,
				() => false,
			);
			const hasState = await access(join(jobsRoot, id, "state")).then(
				() => true,
				() => false,
			);
			const hasWorktree = await access(join(jobsRoot, id, "worktree")).then(
				() => true,
				() => false,
			);
			if (hasTask && hasWorktree && !hasState) return id;
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`in-flight job with task.md and no state did not appear under ${jobsRoot}`);
}

async function waitFor(message: string, probe: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await probe()) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(message);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function matchingProcesses(needle: string): string[] {
	const result = spawnSync("/bin/ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8" });
	return (result.stdout ?? "")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.includes(needle));
}

function descendantPids(rootPid: number): number[] {
	const table: Array<{ pid: number; ppid: number }> = [];
	for (const line of (spawnSync("/bin/ps", ["-ax", "-o", "pid=,ppid="], { encoding: "utf8" }).stdout ?? "").split("\n")) {
		const [pid, ppid] = line.trim().split(/\s+/).map(Number);
		if (pid && ppid) table.push({ pid, ppid });
	}
	const found: number[] = [];
	const seen = new Set([rootPid]);
	const queue = [rootPid];
	for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
		for (const row of table) {
			if (row.ppid !== current || seen.has(row.pid)) continue;
			seen.add(row.pid);
			found.push(row.pid);
			queue.push(row.pid);
		}
	}
	return found;
}
