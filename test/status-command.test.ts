import assert from "node:assert/strict";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { git, limen, limenWithEnv, scratchRepo, scratchWorkspace } from "./scratch.ts";

async function job(root: string, id: string, fields: Record<string, string>): Promise<string> {
	const dir = join(root, ".limen/jobs", id);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "task.md"), "job\n");
	await writeFile(join(dir, "log"), "job\n");
	for (const [name, value] of Object.entries(fields)) {
		if (name.includes("/")) await mkdir(join(dir, name.slice(0, name.lastIndexOf("/"))), { recursive: true });
		await writeFile(join(dir, name), `${value}\n`);
	}
	return dir;
}

test("plant plate shows working coordinator outside worker workspace, live hosted tool, and unmerged branch", async (context) => {
	const scratch = await scratchWorkspace();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "workspace", "init").status, 0);
	const repo = scratch.repositories.api;
	git(repo, "branch", "limen/finished");
	git(repo, "switch", "limen/finished");
	await writeFile(join(repo, "change.txt"), "changed\n");
	git(repo, "add", "change.txt");
	git(repo, "commit", "-m", "finished work");
	git(repo, "switch", "main");
	const base = git(repo, "rev-parse", "HEAD");
	await job(scratch.root, "completed", { state: "done", label: "finished change", branch: "limen/finished", repo: "api", base });
	await job(scratch.root, "worker", {
		state: "running",
		label: "live OMP worker",
		branch: "limen/worker",
		repo: "api",
		engine: "omp",
		hosted: "weaker guarantees",
		pid: "1",
		activity: "tool",
		"last-tool": "bash: git status",
		advisory: "needs attention",
		"herdr/agent": "wSC:p1",
		"herdr/tab": "wSC:t1",
		worktree: join(scratch.root, ".limen-worktrees/worker"),
		"started-at": new Date().toISOString(),
	});
	const herdr = join(scratch.fakeBin, "herdr");
	await writeFile(
		herdr,
		`#!/usr/bin/env node
const args = process.argv.slice(2);
const ok = (result) => console.log(JSON.stringify({ result }));
if (args[0] === "agent" && args[1] === "get") ok({ agent: { agent_status: "working", pane_id: "wSC:p1" } });
else if (args[0] === "agent" && args[1] === "list") ok({ agents: [
  { cwd: ${JSON.stringify(repo)}, tab_id: "wNF:t19", pane_id: "wNF:p19", agent_status: "working" },
  { cwd: ${JSON.stringify(join(scratch.root, ".limen-worktrees/worker"))}, tab_id: "wSC:t1", pane_id: "wSC:p1", agent_status: "done" }
] });
else process.exit(1);
`,
	);
	await chmod(herdr, 0o755);
	const env = { LIMEN_HERDR: herdr };
	const jobs = limenWithEnv(scratch, env, "jobs", "--running");
	const status = limenWithEnv(scratch, env, "status");
	assert.equal(jobs.status, 0, jobs.stderr);
	assert.equal(status.status, 0, status.stderr);
	assert.match(jobs.stdout, /tool.*bash: git status/);
	assert.match(status.stdout, /Running \(1\):[\s\S]*live OMP worker.*tool.*advisory needs attention.*bash: git status/);
	assert.match(status.stdout, /Waiting on owner \(1\):[\s\S]*finished change.*done.*waiting on owner/);
	assert.match(status.stdout, /Coordinator tabs:[\s\S]*wNF:t19 · working/);
	assert.doesNotMatch(status.stdout, /wSC:t1/);
});

test("plant plate does not leave merged, empty or deleted branches waiting; Herdr absence is unknown", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const base = git(scratch.root, "rev-parse", "HEAD");
	git(scratch.root, "branch", "limen/empty");
	git(scratch.root, "branch", "limen/pending");
	git(scratch.root, "switch", "limen/pending");
	await writeFile(join(scratch.root, "candidate.txt"), "candidate\n");
	git(scratch.root, "add", "candidate.txt");
	git(scratch.root, "commit", "-m", "candidate");
	git(scratch.root, "switch", "main");
	await job(scratch.root, "pending", { state: "done", label: "pending", branch: "limen/pending", base });
	await job(scratch.root, "empty", { state: "done", label: "empty", branch: "limen/empty", base });
	await job(scratch.root, "gone", { state: "done", label: "gone", branch: "limen/gone", base });
	await job(scratch.root, "detached", {
		state: "running",
		label: "Pi detached",
		branch: "limen/detached",
		engine: "pi",
		"started-at": new Date().toISOString(),
		advisory: "review stall",
	});
	const before = limen(scratch, "status");
	assert.equal(before.status, 0, before.stderr);
	assert.match(before.stdout, /Running \(1\):[\s\S]*Pi detached.*starting.*advisory review stall/);
	assert.match(before.stdout, /Waiting on owner \(1\):[\s\S]*pending.*waiting on owner/);
	assert.doesNotMatch(before.stdout, /empty \(empty\)|gone \(gone\)/);
	assert.match(before.stdout, /Coordinator tabs:\n  unknown \(Herdr unavailable\)/);
	git(scratch.root, "merge", "--ff-only", "limen/pending");
	const after = limen(scratch, "status");
	assert.equal(after.status, 0, after.stderr);
	assert.match(after.stdout, /Waiting on owner \(0\):/);
	assert.doesNotMatch(after.stdout, /pending \(pending\)/);
});

test("missing Git repository stays unconfirmed, not clear", async (context) => {
	const scratch = await scratchWorkspace();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "workspace", "init").status, 0);
	await job(scratch.root, "missing", { state: "done", label: "lost repo", branch: "limen/missing", repo: "missing" });
	const result = limen(scratch, "status");
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Unconfirmed jobs:[\s\S]*lost repo.*Git unknown/);
	assert.match(result.stdout, /Waiting on owner \(0\):/);
});
