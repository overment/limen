// S1 · Spawn, detached. A job gets its own worktree and branch from the base commit, the exact task bytes and an
// engine environment without the caller's Herdr pane or Pi session; reading a running job leaves its index alone;
// a workspace job works in one child repository; each refusal leaves no job, worktree or branch behind.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
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
	until,
	waitJob,
} from "./plant.ts";

let p: Plant;
before(async () => {
	p = await plant();
	await writeFile(join(p.bin, "hc"), hcSource, { mode: 0o755 });
	await writeFile(join(p.bin, "core-calls"), "");
});
after(() => p.cleanup());

const app = { HC_TERMINAL_ID: "t-source" };
const hcSource = `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const dir = __dirname, args = process.argv.slice(2).filter(x => x !== "--json");
fs.appendFileSync(path.join(dir, "core-calls"), JSON.stringify(args) + "\\n");
const fail = (kind, message) => { console.error(JSON.stringify({error: {kind, message}})); process.exit(1); };
if (fs.existsSync(path.join(dir, "core-fail"))) fail("unavailable", "core transport offline");
const file = path.join(dir, "core-state");
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
const save = () => fs.writeFileSync(file, JSON.stringify(state));
const ok = value => { console.log(JSON.stringify(value)); process.exit(0); };
const [verb, target] = args;
if (verb === "get" && target === "t-source") ok({address: target, state: "live", labels: {"herdr.space": "source-space"}});
if (verb === "get") { if (!state[target]) fail("not_found", "terminal missing"); ok(state[target]); }
if (verb === "run") {
 const id = "t" + process.pid, at = args.indexOf("--");
 const fd = fs.openSync(path.join(dir, id + ".screen"), "w");
 const child = cp.spawn(args[at + 1], args.slice(at + 2), {stdio: ["ignore", fd, fd], detached: true});
 child.unref(); fs.closeSync(fd);
 state[id] = {address: id, state: "live", pid: child.pid}; save(); ok(state[id]);
}
if (verb === "kill") { if (!state[target]) fail("not_found", "terminal missing");
 try { process.kill(state[target].pid); } catch {} state[target].state = "finished"; save(); ok({}); }
if (verb === "rm") { delete state[target]; save(); ok({}); }
fail("usage", "unsupported command");
`;
const calls = (): string[][] =>
	JSON.parse(`[${readFileSync(join(p.bin, "core-calls"), "utf8").trim().split("\n").join(",")}]`);
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
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
		[["--engine", "pi", "--extension", "missing.ts", "work"], "missing.ts"],
		[["--engine", "omp", "--extension", "README.md", "work"], "--extension"],
		[["--provider", "pi-claude", "--model", "anthropic/opus", "work"], "pi-claude/opus", { LIMEN_ENGINE: "omp" }],
		[["--provider", "pi-claude", "--model", "claude-opus-5-5", "work"], "pi install"],
		[["--engine", "devin", "--tab", "work"], "detached only"],
		[["--engine", "devin", "--thinking", "high", "work"], "--thinking"],
		[["--engine", "devin", "--provider", "windows", "work"], "macos or linux"],
		[["--engine", "devin", "work"], "DEVIN_API_KEY"],
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
		...app,
		PI_SESSION_ID: "coord",
		PI_SESSION_FILE: join(p.parent, "coord.jsonl"),
		HERDR_ENV: "1",
		HERDR_PANE_ID: "p1",
		LIMEN_JOB_ID: "2026-10-08-f001-coordinator-1a2b3c4d",
		LIMEN_HOSTED: "1",
	};
	const id = spawnJob(p, task, ["--detached", "--label", "F001 demo"], { env: caller });
	const dir = jobDir(p, id);
	const tree = jobFile(p, id, "worktree");
	assert.deepEqual([git(tree, "branch", "--show-current"), git(tree, "rev-parse", "HEAD")], [`limen/${id}`, base]);
	await liveLog(id);
	await rm(join(dir, "spawner")); // `jobs` below reads the picture's link to the spawner job, `spawned-by`, alone.

	// Plain `git status` on stale stat data rewrites the index under the worker's own `git add` (43c01cf).
	const index = join(git(tree, "rev-parse", "--absolute-git-dir"), "index");
	await utimes(join(tree, "README.md"), new Date(0), new Date(0));
	const bytes = readFileSync(index);
	for (const read of [["jobs"], ["status"], ["jobs", id]]) {
		assert.equal(limen(p, read).status, 0, read.join(" "));
	}
	assert.deepEqual(readFileSync(index), bytes);

	await release(dir);
	assert.deepEqual([waitJob(p, id), readFileSync(join(dir, "task.md"), "utf8")], ["done", task]);
	assert.equal(readFileSync(join(dir, "fake-task.txt"), "utf8"), task);
	const argv: string[] = json(join(dir, "fake-argv.json"));
	assert.ok(!argv.some((value) => value.includes("say all done")), "the task stays out of argv");
	const leak = /^(HERDR_|PI_SESSION_|HC_TERMINAL_ID$|LIMEN_HOSTED$)/;
	const leaked = json(join(dir, "fake-env.json")).filter((name: string) => leak.test(name));
	assert.deepEqual(leaked, []);
	const commits = git(p.root, "rev-list", `${base}..limen/${id}`).split("\n");
	assert.equal(commits.length, 1);
	assert.deepEqual([git(p.root, "rev-parse", "HEAD"), git(p.root, "status", "--porcelain")], [base, ""]);
	const shown = limen(p, ["jobs", id]);
	assert.ok(shown.stdout.includes(commits[0]?.slice(0, 7) ?? "?"), shown.stdout);
	assert.ok(shown.stdout.includes("all done"), shown.stdout);
	assert.ok(shown.stdout.includes(`\n  spawned-by job ${caller.LIMEN_JOB_ID}\n`), shown.stdout);

	// A served model other than the requested one shows both; a turn copied from a parent session is not counted.
	const usage = { input: 1, output: 10, cacheRead: 100, cacheWrite: 1000 };
	const turn = (timestamp: string, model: string) =>
		JSON.stringify({ type: "message", timestamp, message: { role: "assistant", provider: "p", model, usage } });
	const now = new Date().toISOString();
	const turns = [turn("2020-01-01T00:00:00.000Z", "parent"), turn(now, "other"), turn(now, "other")];
	await writeFile(join(dir, "session", "turns.jsonl"), `${turns.join("\n")}\n`);
	const detail = limen(p, ["jobs", id]).stdout;
	assert.ok(detail.includes(`model served p/other · requested ${jobFile(p, id, "model")}`), detail);
	assert.ok(detail.includes("tokens 2 turns · input 2 · output 20 · cache read 200 · cache write 2,000"), detail);
	await continueLog(id);
});

test("a workspace job works in one child repository", async () => {
	const before = calls().length;
	const workspace = join(p.parent, "workspace");
	await Promise.all(["api", "web"].map((name) => repository(join(workspace, name))));
	assert.equal(limen(p, ["workspace", "init"], { cwd: workspace }).status, 0);
	const id = spawnJob(p, "commit", ["--repo", "api", "--engine", "pi"], { cwd: workspace });
	assert.equal(waitJob(p, id, { cwd: workspace }), "done");
	const dir = join(workspace, ".limen/jobs", id);
	assert.equal(readFileSync(join(dir, "repo"), "utf8"), "api\n");
	assert.match(limen(p, ["jobs", id], { cwd: workspace }).stdout, /\n {2}spawned-by user \S+, parent .+ \(pid \d+\)\n/);
	assert.equal(git(join(workspace, "api"), "rev-list", "--count", `main..limen/${id}`), "1");
	assert.equal(git(join(workspace, "web"), "branch", "--list", `limen/${id}`), "");
	assert.equal(calls().length, before, "a discoverable hc is not used outside Herdr");
	assert.ok(!existsSync(join(dir, "herdr-core/terminal")));
});

async function liveLog(id: string) {
	const dir = jobDir(p, id);
	const terminal = jobFile(p, id, "herdr-core/terminal");
	assert.ok(terminal);
	const launch = calls().find((args) => args[0] === "run") ?? [];
	for (const flag of ["--bg", "--no-notify", "--outlive-parent", "herdr.space=source-space"]) {
		assert.ok(launch.includes(flag), flag);
	}
	assert.equal(launch[launch.indexOf("--parent") + 1], app.HC_TERMINAL_ID);
	assert.deepEqual(launch.slice(launch.indexOf("--") + 1), ["tail", "-n", "+1", "-f", join(dir, "log")]);
	await screen(terminal, "worker started");
	const opened = limen(p, ["open", id], { env: app });
	assert.equal(opened.status, 0, opened.stderr);
	assert.equal(calls().filter((args) => args[0] === "run").length, 1, "open reuses the live log");
}
async function closed(id: string, terminal: string) {
	await until(jobDir(p, id), () => jobFile(p, id, "log").includes(`hc log close ${terminal}: closed`));
	for (const verb of ["kill", "rm"]) {
		assert.ok(
			calls().some((args) => args[0] === verb && args[1] === terminal),
			verb,
		);
	}
}
async function continueLog(id: string) {
	await closed(id, jobFile(p, id, "herdr-core/terminal"));
	const resumed = limen(p, ["continue", id, "--detached", "finish continued"], { env: app });
	assert.equal(resumed.status, 0, resumed.stderr);
	const next = resumed.stdout.trim().split("\n").at(-1) ?? "";
	const terminal = jobFile(p, next, "herdr-core/terminal");
	assert.ok(terminal);
	assert.equal(waitJob(p, next), "done");
	await closed(next, terminal);
	const opened = limen(p, ["open", id], { env: app });
	assert.equal(opened.status, 0, opened.stderr);
	assert.deepEqual(
		calls()
			.filter((args) => args[0] === "run")
			.at(-1)
			?.slice(-5),
		["tail", "-n", "+1", "-f", join(jobDir(p, id), "log")],
	);
	await screen(jobFile(p, id, "herdr-core/terminal"), "done: pi exited 0");
}
async function screen(terminal: string, text: string) {
	const path = join(p.bin, `${terminal}.screen`);
	await until(p.bin, () => existsSync(path) && readFileSync(path, "utf8").includes(text));
}
test("a core transport failure is logged but the detached job still completes", async () => {
	await writeFile(join(p.bin, "core-fail"), "offline");
	const id = spawnJob(p, "finish transport survived", ["--detached"], { env: app });
	assert.equal(waitJob(p, id), "done");
	assert.match(jobFile(p, id, "log"), /herdr skipped: core transport offline/);
	assert.equal(jobFile(p, id, "herdr-core/terminal"), "");
});
