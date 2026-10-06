import { readFileSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

/** Where planning files live: committed to Git (the default), or private in the canonical project root. */
export type PlanningSource = "committed" | "private";

/** The project setting is local cabinet state in `.limen/planning-source`, never a copy of planning files. */
export function planningSource(root: string): PlanningSource {
	return parsePlanningSource(readIfPresent(`${root}/.limen/planning-source`)?.trim() ?? "committed");
}

/** A job keeps the source recorded at spawn, even after the project setting changes. */
export function recordedPlanningSource(jobDir: string): PlanningSource {
	return parsePlanningSource(readIfPresent(`${jobDir}/planning-source`)?.trim() ?? "committed");
}

export function parsePlanningSource(value: string): PlanningSource {
	if (value !== "committed" && value !== "private") {
		throw new Error("planning source must be committed or private");
	}
	return value;
}

/** Inside a job's own worktree, return the canonical root, recorded source, and workspace repository from its job record. */
export function inheritedPlanning(
	worktree: string,
): { root: string; source: PlanningSource; repo?: string } | undefined {
	const root = process.env.LIMEN_CONTEXT_ROOT;
	const id = process.env.LIMEN_JOB_ID;
	if (process.env.LIMEN_JOB !== "1" || !root || !id || !/^[A-Za-z0-9._-]+$/.test(id)) {
		return;
	}
	const jobDir = `${root}/.limen/jobs/${id}`;
	if (resolve(readFileSync(`${jobDir}/worktree`, "utf8").trim()) !== resolve(worktree)) {
		return;
	}
	const repo = readIfPresent(`${jobDir}/repo`)?.trim();
	return { root, source: recordedPlanningSource(jobDir), ...(repo ? { repo } : {}) };
}

/** Return the absolute path of a readable planning file inside the canonical root. Reject `..` and symlink escapes before the read. */
export async function privatePlanningFile(root: string, path: string): Promise<string> {
	const absolute = resolve(root, path);
	if (path.split(/[\\/]/).includes("..") || !inside(resolve(root), absolute)) {
		throw new Error(`private planning path must be inside canonical root: ${path}`);
	}
	const canonicalRoot = await realpath(root);
	const file = await realpath(absolute);
	if (!inside(canonicalRoot, file)) {
		throw new Error(`private planning path escapes canonical root: ${path}`);
	}
	const info = await stat(file);
	if (!info.isFile() || !(info.mode & 0o444)) {
		throw new Error(`private planning file is not readable: ${path}`);
	}
	await readFile(file, "utf8");
	return absolute;
}

/** Read every `Ticket:` path, preserving order and excluding sentence punctuation. */
export function ticketPointers(task: string): Array<{ path: string; pointer: string }> {
	return [...task.matchAll(/\bTicket:\s+(\S+)/g)].flatMap(([pointer, token]) => {
		const path = token!.replace(/[.,;:!?)\]'"`]+$/, "");
		return path ? [{ path, pointer }] : [];
	});
}

/** Check each `Ticket:` path in the task and replace it with its absolute path in the canonical root. */
export async function privatePlanningTask(root: string, task: string): Promise<string> {
	let result = task;
	for (const { pointer, path } of ticketPointers(task)) {
		const absolute = await privatePlanningFile(root, path);
		result = result.replace(pointer, pointer.replace(path, absolute));
	}
	return result;
}

/** System-prompt lines for a session that reads private planning from the canonical root. */
export function privatePlanningGuidance(root: string): string {
	return [
		`Planning source: private. Read canonical planning in ${root}; do not copy, link, stage or commit it. Planning-commit instructions apply only to committed mode. Product-code Git requirements are unchanged.`,
		`Vision (read-only): ${root}/spec/vision.md`,
		`Board (read-only): ${root}/spec/build.md`,
		"",
	].join("\n");
}

function inside(base: string, file: string): boolean {
	const path = relative(base, file);
	return path !== "" && path !== ".." && !path.startsWith("../") && !isAbsolute(path);
}

function readIfPresent(file: string): string | undefined {
	try {
		return readFileSync(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return;
		}
		throw error;
	}
}
