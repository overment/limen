import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { cleanWorktree, commitList, currentBranch, limenRoot, mergeBranch, workspaceRepository } from "../git.ts";
import { resolveJob } from "../lookup.ts";

export async function landCommand(args: readonly string[], cwd: string): Promise<void> {
	const parsed = parseLandArgs(args);
	const { id, jobDir } = await resolveJob(cwd, parsed.query);
	const [state, branch, base, repo, label] = await Promise.all([
		text(`${jobDir}/state`),
		text(`${jobDir}/branch`),
		text(`${jobDir}/base`),
		text(`${jobDir}/repo`),
		text(`${jobDir}/label`),
	]);
	if (state !== "done") throw new Error(`job ${id} is ${state || "missing"}; land requires a done job`);
	if (!branch || !base) throw new Error(`job ${id} has no recorded ${branch ? "base" : "branch"}`);
	const root = limenRoot(cwd);
	const repository = repo ? workspaceRepository(root, repo) : root;
	const current = currentBranch(repository);
	const target = parsed.onto ?? current;
	if (target !== current) throw new Error(`land merges onto the current branch (${current}); checkout ${target} first`);
	if (target === branch) throw new Error(`already on job branch ${branch}`);
	if (!cleanWorktree(repository)) throw new Error(`target ${target} is dirty`);
	const commits = commitList(repository, base, branch);
	if (!commits) throw new Error(`job ${id} has no commits to land`);
	if (!parsed.yes && !(await confirm(`Land ${label || id} onto ${target}? [y/N] `))) throw new Error("land cancelled");
	const output = mergeBranch(repository, branch);
	if (output) console.log(output);
	console.log(`landed ${id} onto ${target}`);
}

function parseLandArgs(args: readonly string[]): { readonly query: string; readonly yes: boolean; readonly onto?: string } {
	let query: string | undefined;
	let yes = false;
	let onto: string | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const value = args[index];
		if (!value) continue;
		if (value === "--yes") yes = true;
		else if (value === "--onto") {
			const next = args[index + 1];
			if (!next || next.startsWith("--")) throw new Error("--onto requires a branch");
			if (onto !== undefined) throw new Error("--onto may be supplied only once");
			onto = next;
			index += 1;
		} else if (value.startsWith("--")) throw new Error(`unknown land option ${value}`);
		else if (query) throw new Error("land requires exactly one job id");
		else query = value;
	}
	if (!query) throw new Error("land requires a job id");
	return onto !== undefined ? { query, yes, onto } : { query, yes };
}

async function confirm(question: string): Promise<boolean> {
	if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) throw new Error("land requires a TTY confirm, or pass --yes");
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		return /^(y|yes)$/i.test((await rl.question(question)).trim());
	} finally {
		rl.close();
	}
}

function text(path: string): Promise<string> {
	return readFile(path, "utf8").then(
		(value) => value.trim(),
		() => "",
	);
}
