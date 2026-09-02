import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { limenRoot, workspaceRepository } from "../git.ts";
import { herdrAvailable } from "../herdr.ts";
import { resolveJob } from "../lookup.ts";

export async function diffCommand(args: readonly string[], cwd: string): Promise<void> {
	const query = args[0];
	if (!query || args.length !== 1) throw new Error("diff requires exactly one job id");
	const { id, jobDir } = await resolveJob(cwd, query);
	const [base, branch, worktree, state, repo] = await Promise.all([
		text(`${jobDir}/base`),
		text(`${jobDir}/branch`),
		text(`${jobDir}/worktree`),
		text(`${jobDir}/state`),
		text(`${jobDir}/repo`),
	]);
	if (!base || !branch) throw new Error(`job ${id} has no recorded ${base ? "branch" : "base"}`);
	const range = `${base}...${branch}`;
	const fallback = `git diff ${shellArg(range)}`;
	const hunk = hunkBinary();
	if (!hunk || (!process.stdin.isTTY && !herdrAvailable())) {
		console.log(fallback);
		return;
	}
	const root = limenRoot(cwd);
	const repository = repo ? workspaceRepository(root, repo) : root;
	const live = state === "running" && Boolean(worktree) && existsSync(worktree);
	const result = spawnSync(hunk, live ? ["diff", base, "--watch"] : ["diff", range], {
		cwd: live ? worktree : repository,
		stdio: "inherit",
	});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`hunk exited with status ${result.status ?? "unknown"}`);
}

export function hunkBinary(): string | undefined {
	const override = process.env.LIMEN_HUNK?.trim();
	if (override === "0") return;
	if (override) return existsSync(override) ? override : undefined;
	for (const dir of (process.env.PATH ?? "").split(":")) {
		const candidate = `${dir}/hunk`;
		if (dir && existsSync(candidate)) return candidate;
	}
}

function shellArg(value: string): string {
	return /^[A-Za-z0-9_./:@+~-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

function text(path: string): Promise<string> {
	return readFile(path, "utf8").then(
		(value) => value.trim(),
		() => "",
	);
}
