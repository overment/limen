// Deterministic interleaving probe, not a production change.
// Prune reads the job listing, then a new startup publishes record+worktree before prune lists worktrees.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const candidate = process.argv[2];
if (!candidate) throw new Error("Pass the candidate worktree path");
const load = (path) => import(pathToFileURL(`${candidate}/${path}`).href);
const { scratchRepo } = await load("test/scratch.ts");
const scratch = await scratchRepo();
const root = await fs.realpath(scratch.root);
const jobsRoot = `${root}/.limen/jobs`;
const originalReaddir = fs.readdir;
let injected = false;
const id = "2026-09-19-stale-snap-aaaaaaaa";
const worktreeRoot = join(dirname(root), `.${basename(root)}-limen-worktrees`);
const worktree = join(worktreeRoot, id);
const jobDir = `${jobsRoot}/${id}`;
const leftover = join(worktreeRoot, "ordinary-leftover");
try {
	await fs.mkdir(jobsRoot, { recursive: true });
	await fs.mkdir(leftover, { recursive: true });
	await fs.writeFile(join(leftover, "stale.txt"), "remove me\n");
	fs.readdir = async function (path, options) {
		const result = await originalReaddir(path, options);
		const resolved = await fs.realpath(String(path)).catch(() => String(path));
		if (!injected && resolved === jobsRoot) {
			injected = true;
			await fs.mkdir(jobDir);
			await fs.writeFile(`${jobDir}/started-at`, `${new Date().toISOString()}\n`);
			await fs.writeFile(`${jobDir}/worktree`, `${worktree}\n`);
			await fs.mkdir(worktreeRoot, { recursive: true });
			execFileSync("git", ["worktree", "add", "--detach", worktree, "HEAD"], { cwd: root, encoding: "utf8" });
			console.log(`Injected job+worktree after jobs listing: ${jobDir}`);
			console.log(`Worktree exists after inject: ${existsSync(worktree)}`);
		}
		return result;
	};
	syncBuiltinESMExports();
	const { pruneFinishedWorktrees } = await load("src/commands/prune.ts");
	const removed = await pruneFinishedWorktrees(root);
	console.log(`Prune removed count: ${removed}`);
	console.log(`Job directory exists: ${existsSync(jobDir)}`);
	console.log(`Worktree exists: ${existsSync(worktree)}`);
	console.log(`Leftover exists: ${existsSync(leftover)}`);
	if (!injected) throw new Error("readdir intercept did not fire");
	if (!existsSync(jobDir)) {
		console.log("CONFIRMED: prune deleted the job published after the listing");
		process.exitCode = 0;
	} else if (!existsSync(worktree)) {
		console.log("CONFIRMED: prune deleted the worktree published after the listing");
		process.exitCode = 0;
	} else {
		console.log("NOT REPRODUCED: injected job and worktree survived prune");
		process.exitCode = 2;
	}
} finally {
	fs.readdir = originalReaddir;
	syncBuiltinESMExports();
	await scratch.cleanup();
}
