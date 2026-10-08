// S1 · Spawn, detached. A job gets its own worktree and branch from the base commit, the exact task bytes and an
// engine environment without the caller's Herdr pane or Pi session; reading a running job leaves its index alone;
// a workspace job works in one child repository; each refusal leaves no job, worktree or branch behind.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, realpath, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
	git,
	jobDir,
	jobFile,
	limen,
	type Plant,
	plant,
	release,
	repository,
	spawnJob,
	TICKET,
	waitJob,
} from "./plant.ts";

let p: Plant;
before(async () => {
	p = await plant();
});
after(() => p.cleanup());

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const extensionsOf = (argv: readonly string[]) =>
	argv.flatMap((value, index) => (value === "--extension" ? [argv[index + 1] ?? ""] : []));
// What a half-made job would leave: a job dir, a worktree, a branch.
const traces = () => [
	readdirSync(join(p.root, ".limen/jobs")),
	git(p.root, "worktree", "list", "--porcelain"),
	git(p.root, "branch", "--list"),
];

test("each spawn refusal exits 1, names its cause and leaves no job, worktree or branch", async (context) => {
	const draft = "spec/features/active/F002-draft/ticket.md";
	await mkdir(join(p.root, "spec/features/active/F002-draft"));
	context.after(() => rm(join(p.root, "spec/features/active/F002-draft"), { recursive: true }));
	await writeFile(join(p.root, draft), "# F002 · Not committed yet\n");
	const clean = traces();
	const refusals: ReadonlyArray<readonly [readonly string[], string, Record<string, string>?]> = [
		[[`Implement F002. Ticket: ${draft}`], draft],
		[["--role", "coordinator", "work"], "coordinator"],
		[["--engine", "claude", "work"], "--engine"],
		[["--engine", "pi", "work"], "PATH", { PATH: "/usr/bin:/bin" }],
		[["--engine", "pi", "--extension", "npm:package", "work"], "npm:package"],
		[["--engine", "pi", "--extension", "missing.ts", "work"], "missing.ts"],
		[["--engine", "omp", "--extension", "README.md", "work"], "--extension"],
	];
	for (const [args, cause, env] of refusals) {
		const run = limen(p, ["spawn", ...args], env ? { env } : {});
		assert.equal(run.status, 1, args.join(" "));
		assert.ok(run.stderr.includes(cause), `${args.join(" ")}: ${run.stderr}`);
	}
	assert.deepEqual(traces(), clean);
});

test("a detached job runs in its own worktree from the base with the exact task and a clean engine environment", async () => {
	const base = git(p.root, "rev-parse", "HEAD");
	const task = `block\ncommit\nsay all done\n\nTicket: ${TICKET}  \n\t'quoted' $HOME \`tick\`\n`;
	const caller = {
		PI_SESSION_ID: "coord",
		PI_SESSION_FILE: join(p.parent, "coord.jsonl"),
		HERDR_ENV: "1",
		HERDR_PANE_ID: "p1",
		LIMEN_JOB_ID: "2026-10-08-f001-coordinator-1a2b3c4d",
	};
	const id = spawnJob(p, task, ["--detached", "--label", "F001 demo"], { env: caller });
	const dir = jobDir(p, id);
	const tree = jobFile(p, id, "worktree");
	assert.notEqual(tree, p.root);
	assert.equal(git(tree, "branch", "--show-current"), `limen/${id}`);
	assert.equal(git(tree, "rev-parse", "HEAD"), base);
	// The picture nests this job under the job whose agent spawned it.
	assert.equal(jobFile(p, id, "spawned-by"), caller.LIMEN_JOB_ID);

	// Plain `git status` on stale stat data rewrites the index under the worker's own `git add` (43c01cf).
	const index = join(git(tree, "rev-parse", "--absolute-git-dir"), "index");
	await utimes(join(tree, "README.md"), new Date(0), new Date(0));
	const bytes = readFileSync(index);
	for (const read of [["jobs"], ["status"], ["jobs", id]]) {
		assert.equal(limen(p, read).status, 0, read.join(" "));
	}
	assert.deepEqual(readFileSync(index), bytes);
	assert.equal(existsSync(`${index}.lock`), false);

	await release(dir);
	assert.equal(waitJob(p, id), "done");
	assert.equal(readFileSync(join(dir, "task.md"), "utf8"), task);
	assert.equal(readFileSync(join(dir, "fake-task.txt"), "utf8"), task);
	const argv: string[] = json(join(dir, "fake-argv.json"));
	assert.equal(argv[argv.indexOf("--mode") + 1], "json");
	assert.equal(argv.at(-1), `@${join(dir, "task.md")}`);
	assert.equal(
		argv.some((value) => value.includes("say all done")),
		false,
	);
	assert.deepEqual(
		json(join(dir, "fake-env.json")).filter((name: string) => /^(HERDR_|PI_SESSION_)/.test(name)),
		[],
	);
	const commits = git(p.root, "rev-list", `${base}..limen/${id}`).split("\n");
	assert.equal(commits.length, 1);
	assert.equal(git(p.root, "rev-parse", "HEAD"), base);
	assert.equal(git(p.root, "status", "--porcelain"), "");
	const shown = limen(p, ["jobs", id]);
	assert.ok(shown.stdout.includes(commits[0]?.slice(0, 7) ?? "?"), shown.stdout);
	assert.ok(shown.stdout.includes("all done"), shown.stdout);
});

test("a workspace job works in one child repository and loads a selected Pi extension once", async () => {
	const workspace = join(p.parent, "workspace");
	await Promise.all(["api", "web"].map((name) => repository(join(workspace, name))));
	assert.equal(limen(p, ["workspace", "init"], { cwd: workspace }).status, 0);
	const extension = join(p.parent, "selected.ts");
	await writeFile(extension, "export default () => {};\n");
	await symlink(extension, join(p.parent, "alias.ts"));
	const flags = [
		"--repo",
		"api",
		"--engine",
		"pi",
		"--extension",
		extension,
		"--extension",
		join(p.parent, "alias.ts"),
	];
	const id = spawnJob(p, "commit", flags, { cwd: workspace });
	assert.equal(waitJob(p, id, { cwd: workspace }), "done");
	const dir = join(workspace, ".limen/jobs", id);
	assert.equal(readFileSync(join(dir, "repo"), "utf8"), "api\n");
	assert.equal(git(join(workspace, "api"), "rev-list", "--count", `main..limen/${id}`), "1");
	assert.equal(git(join(workspace, "web"), "branch", "--list", `limen/${id}`), "");
	const argv: string[] = json(join(dir, "fake-argv.json"));
	assert.ok(argv.includes("--no-extensions"));
	assert.deepEqual(
		extensionsOf(argv).filter((path) => path.startsWith(p.parent)),
		[await realpath(extension)],
	);
});
