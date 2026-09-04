import assert from "node:assert/strict";
import { access, chmod, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { defaultFakePi, git, limen, limenWithEnv, limenWithInput, limenWithSession, onlyJobId, scratchRepo, waitForState } from "./scratch.ts";

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
	assert.match(argv[argv.indexOf("--append-system-prompt") + 1] ?? "", /You implement the coordinator's instruction/);
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

test("spawn --role without a preamble or with --review plants no job", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const missing = limen(scratch, "spawn", "--role", "researcher", "look around");
	assert.equal(missing.status, 1);
	assert.match(missing.stderr, /no preamble for role researcher/);
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
