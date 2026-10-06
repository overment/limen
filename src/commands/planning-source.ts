import { mkdir } from "node:fs/promises";
import { atomicWrite } from "../job/record.ts";
import { limenRoot, repoRoot, workspaceRoot } from "../project/git.ts";
import { inheritedPlanning, parsePlanningSource, planningSource } from "../project/planning.ts";

/** `limen planning [committed|private]`: print the project planning source, or set it from the project coordinator. */
export async function planningCommand(args: readonly string[], cwd: string): Promise<void> {
	// A job reads the setting in its canonical root, not in its own worktree.
	const inherited = process.env.LIMEN_GROUP_ID || workspaceRoot(cwd) ? undefined : inheritedPlanning(repoRoot(cwd));
	const root = inherited?.root ?? limenRoot(cwd);
	if (args.length > 1) {
		throw new Error("planning accepts committed or private, or no argument to inspect");
	}
	if (args[0]) {
		if (process.env.LIMEN_JOB === "1") {
			throw new Error("only the project coordinator may change the planning source");
		}
		const source = parsePlanningSource(args[0]);
		await mkdir(`${root}/.limen`, { recursive: true });
		await atomicWrite(`${root}/.limen/planning-source`, `${source}\n`);
	}
	console.log(planningSource(root));
}
