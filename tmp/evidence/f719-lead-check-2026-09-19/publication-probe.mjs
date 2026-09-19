// Deterministic interleaving probe, not a production change.
// Pause spawn immediately after publishing an empty job directory, then prune.

import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { pathToFileURL } from "node:url";

const candidate = process.argv[2];
if (!candidate) throw new Error("Pass the candidate worktree path");
const load = (path) => import(pathToFileURL(`${candidate}/${path}`).href);
const { scratchRepo } = await load("test/scratch.ts");
const scratch = await scratchRepo();
const root = await fs.realpath(scratch.root);
const originalMkdir = fs.mkdir;
let interrupted = false;
let published;
try {
	for (const name of Object.keys(process.env)) {
		if (name.startsWith("HERDR_") || name.startsWith("LIMEN_") || name.startsWith("PI_SESSION")) delete process.env[name];
	}
	process.env.PATH = `${scratch.fakeBin}:${process.env.PATH}`;
	process.env.LIMEN_HERDR = "0";
	process.env.LIMEN_HUNK = "0";
	process.env.LIMEN_FINISH_WEBHOOK_ENV = "";
	const { pruneFinishedWorktrees } = await load("src/commands/prune.ts");
	fs.mkdir = async function (path, options) {
		const result = await originalMkdir(path, options);
		if (!interrupted && String(path).startsWith(`${root}/.limen/jobs/`) && !options) {
			interrupted = true;
			published = String(path);
			console.log(`Prune interleaving after mkdir, before started-at: ${published}`);
			console.log(`Removed records/worktrees: ${await pruneFinishedWorktrees(root)}`);
			console.log(`Job directory still exists: ${existsSync(published)}`);
		}
		return result;
	};
	syncBuiltinESMExports();
	const { spawnCommand } = await load("src/commands/spawn.ts");
	try {
		await spawnCommand(["--detached", "--label", "publication probe", "do work"], root);
		throw new Error("Unexpected success; inspect probe before interpreting the result");
	} catch (error) {
		if (!interrupted || error.code !== "ENOENT" || existsSync(published)) throw error;
		console.log(`CONFIRMED: candidate spawn fails after prune removes the in-flight directory: ${error.message}`);
	}
} finally {
	fs.mkdir = originalMkdir;
	syncBuiltinESMExports();
	await scratch.cleanup();
}
