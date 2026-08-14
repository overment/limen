import assert from "node:assert/strict";
import { access, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { git, limen, onlyJobId, scratchWorkspace, waitForState } from "./scratch.ts";

test("workspace coordinates explicit child repositories while its specs stay outside Git", async (context) => {
	const workspace = await scratchWorkspace();
	context.after(workspace.cleanup);
	const initialized = limen(workspace, "workspace", "init");
	assert.equal(initialized.status, 0, initialized.stderr);
	assert.match(await readFile(join(workspace.root, "spec/workspace.md"), "utf8"), /never parses/i);
	await access(join(workspace.root, ".limen/jobs"));
	await assert.rejects(access(join(workspace.root, ".gitignore")));
	const missing = limen(workspace, "spawn", "no target");
	assert.equal(missing.status, 1);
	assert.match(missing.stderr, /requires --repo/);
	const traversal = limen(workspace, "spawn", "--repo", "../api", "bad target");
	assert.equal(traversal.status, 1);
	assert.match(traversal.stderr, /immediate child/);
	const worker = onlyJobId(
		limen(workspace, "spawn", "--repo", "api", "--label", "F003 api slice", "make commit Ticket: spec/features/active/F003-workspace-coordinator/ticket.md").stdout,
	);
	await waitForState(workspace.root, worker, "done");
	const job = join(workspace.root, ".limen/jobs", worker);
	assert.equal(await readFile(join(job, "repo"), "utf8"), "api\n");
	const task = await readFile(join(job, "task.md"), "utf8");
	assert.match(task, /^Repository: api\. Work only in this repository\.\n\n/);
	assert.match(task, /\bTicket: \/.+\/workspace\/spec\/features\/active\/F003-workspace-coordinator\/ticket\.md\n$/);
	const apiWorktrees = git(workspace.repositories.api, "worktree", "list", "--porcelain");
	assert.match(apiWorktrees, new RegExp(`worktree .*${worker}`));
	assert.match(apiWorktrees, new RegExp(`branch refs/heads/limen/${worker}`));
	const workerWorktree = apiWorktrees
		.split("\n\n")
		.find((entry) => entry.includes(worker))
		?.split("\n")[0]
		?.slice("worktree ".length);
	assert.ok(workerWorktree);
	const workerEnvironment = JSON.parse(await readFile(join(workerWorktree, "pi-env.json"), "utf8")) as { readonly contextRoot?: string };
	assert.equal(workerEnvironment.contextRoot, await realpath(workspace.root));
	assert.doesNotMatch(git(workspace.repositories.web, "worktree", "list", "--porcelain"), new RegExp(worker));
	const jobs = limen(workspace, "jobs", "--all");
	assert.equal(jobs.status, 0, jobs.stderr);
	assert.match(jobs.stdout, /repo api/);
	assert.match(jobs.stdout, /candidate.txt/);
	const review = onlyJobId(limen(workspace, "spawn", "--repo", "api", "--review", "--branch", `limen/${worker}`, "review candidate").stdout);
	await waitForState(workspace.root, review, "done");
	assert.equal(await readFile(join(workspace.root, ".limen/jobs", review, "repo"), "utf8"), "api\n");
	assert.match(git(workspace.repositories.api, "worktree", "list", "--porcelain"), new RegExp(`worktree .*${review}[\\s\\S]*detached`));
	const waited = limen(workspace, "wait", review.slice(-4));
	assert.equal(waited.status, 0, waited.stderr);
	assert.match(waited.stdout, /DONE review candidate/);
});

test("workspace permits the same live branch name in different child repositories", async (context) => {
	const workspace = await scratchWorkspace(`#!/usr/bin/env node
setTimeout(() => console.log("done"), 500);
`);
	context.after(workspace.cleanup);
	assert.equal(limen(workspace, "workspace", "init").status, 0);
	const api = limen(workspace, "spawn", "--repo", "api", "--branch", "limen/shared", "api work");
	assert.equal(api.status, 0, api.stderr);
	const web = limen(workspace, "spawn", "--repo", "web", "--branch", "limen/shared", "web work");
	assert.equal(web.status, 0, web.stderr);
	await Promise.all([waitForState(workspace.root, onlyJobId(api.stdout), "done"), waitForState(workspace.root, onlyJobId(web.stdout), "done")]);
});

test("workspace stop resolves parent job records", async (context) => {
	const workspace = await scratchWorkspace(`#!/usr/bin/env node
process.on("SIGTERM", () => {});
console.log("waiting");
setInterval(() => {}, 1000);
`);
	context.after(workspace.cleanup);
	assert.equal(limen(workspace, "workspace", "init").status, 0);
	const id = onlyJobId(limen(workspace, "spawn", "--repo", "api", "wait").stdout);
	const stopped = limen(workspace, "stop", id, "workspace stop");
	assert.equal(stopped.status, 0, stopped.stderr);
	await waitForState(workspace.root, id, "stopped");
});

test("workspace init refuses a Git repository", async (context) => {
	const workspace = await scratchWorkspace();
	context.after(workspace.cleanup);
	const result = limen({ ...workspace, root: workspace.repositories.api }, "workspace", "init");
	assert.equal(result.status, 1);
	assert.match(result.stderr, /non-Git parent/);
});
