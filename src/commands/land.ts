import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { jobFeatures } from "../job/job.ts";
import { resolveJob } from "../job/lookup.ts";
import { readPicture } from "../picture/picture-build.ts";
import { checkTickets, readTickets } from "../picture/tickets.ts";
import {
	abortMerge,
	commitList,
	currentBranch,
	dirtyPaths,
	limenRoot,
	mergeBranch,
	mergePaths,
	workspaceRepository,
} from "../project/git.ts";
import { closeTickets } from "../project/lanes.ts";
import { takenElsewhere } from "../project/series.ts";
import { parseFlags } from "./flags.ts";
import { deleteLandedBranches } from "./prune.ts";

export async function landCommand(args: readonly string[], cwd: string): Promise<void> {
	if (process.env.LIMEN_GROUP_ID) {
		throw new Error("group members cannot land; the owner-facing lead owns landing");
	}
	const parsed = parseLandArgs(args);
	const job = await readDoneJob(cwd, parsed.query);
	const { id, branch, base, repo, label } = job;
	const root = limenRoot(cwd);
	const repository = repo ? workspaceRepository(root, repo) : root;
	const target = landTarget(repository, parsed.onto, branch);
	const dirty = checkCheckoutBeside(repository, target, { id, branch, base });
	await checkLandGates(repository, root, branch, id);
	if (!parsed.yes && process.stdin.isTTY === true && !(await confirm(`Land ${label || id} onto ${target}? [y/N] `))) {
		throw new Error("land cancelled");
	}
	// The commits this land brings; a branch that merged main also holds main's own commits since its base.
	const subjects = (commitList(repository, "HEAD", branch) ?? "").split("\n").map((line) => line.replace(/^\S+ /, ""));
	let output: string;
	try {
		output = mergeBranch(repository, branch);
	} catch (error) {
		// A half-done merge beside another session's files would turn its next commit into this merge.
		if (dirty.length) {
			abortMerge(repository);
		}
		throw error;
	}
	if (output) {
		console.log(output);
	}
	console.log(`landed ${id} onto ${target}`);
	// The merge put every branch commit in the target, so the branch is landed.
	for (const { branch: name, kept } of await deleteLandedBranches(root, [{ repository, branch }])) {
		console.log(kept ? `kept branch ${name}: ${kept}` : `deleted branch ${name}`);
	}
	if (parsed.keepOpen) {
		return;
	}
	await closeLandedTickets(root, id, [...jobFeatures(label, id, job.task, subjects)]);
}
/** The tickets the job works on leave active/ with the land; a ticket that cannot move says why and stays. */
async function closeLandedTickets(root: string, id: string, features: readonly string[]): Promise<void> {
	try {
		const closed = await closeTickets(root, features, `landed by ${id}`);
		for (const path of closed.moved) {
			console.log(`land: closed ${path}${closed.commit ? ` in ${closed.commit}` : ""}; NOW and PROVEN regenerated`);
		}
		if (closed.moved.length === 0) {
			console.log(`land: no active ticket for ${features.join(", ") || "this job"}; nothing closed`);
		}
	} catch (error) {
		console.log(`land: tickets stay active: ${error instanceof Error ? error.message : String(error)}`);
	}
}
/** The job's recorded branch, base, repo, label and task; only a done job with a branch and a base lands. */
async function readDoneJob(
	cwd: string,
	query: string,
): Promise<{ id: string; branch: string; base: string; repo: string; label: string; task: string }> {
	const { id, jobDir } = await resolveJob(cwd, query, "control");
	const [state, branch, base, repo, label, task] = await Promise.all([
		text(`${jobDir}/state`),
		text(`${jobDir}/branch`),
		text(`${jobDir}/base`),
		text(`${jobDir}/repo`),
		text(`${jobDir}/label`),
		text(`${jobDir}/task.md`),
	]);
	if (state !== "done") {
		throw new Error(`job ${id} is ${state || "missing"}; land requires a done job`);
	}
	if (!branch || !base) {
		throw new Error(`job ${id} has no recorded ${branch ? "base" : "branch"}`);
	}
	return { id, branch, base, repo, label, task };
}
/** Land merges onto the checked-out branch, never onto the job's own branch. */
function landTarget(repository: string, onto: string | undefined, branch: string): string {
	const current = currentBranch(repository);
	const target = onto ?? current;
	if (target !== current) {
		throw new Error(`land merges onto the current branch (${current}); checkout ${target} first`);
	}
	if (target === branch) {
		throw new Error(`already on job branch ${branch}`);
	}
	return target;
}
/**
 * Another session may be editing this checkout. Land merges beside its files and never touches them: no staged
 * change, no uncommitted file the merge would change. Returns the uncommitted paths.
 */
function checkCheckoutBeside(
	repository: string,
	target: string,
	job: { readonly id: string; readonly branch: string; readonly base: string },
): readonly string[] {
	const dirty = dirtyPaths(repository);
	if (dirty.staged.length) {
		throw new Error(
			`target ${target} has staged changes, and a merge would refuse or sweep them in: ${dirty.staged.join(", ")}; commit or unstage them first`,
		);
	}
	const commits = commitList(repository, job.base, job.branch);
	if (!commits) {
		throw new Error(`job ${job.id} has no commits to land`);
	}
	const merged = dirty.paths.length ? mergePaths(repository, job.branch) : new Set<string>();
	const overlap = dirty.paths.filter((path) => merged.has(path));
	if (overlap.length) {
		throw new Error(
			`target ${target} has uncommitted changes in files this land would change: ${overlap.join(", ")}; commit or move them first`,
		);
	}
	if (dirty.paths.length) {
		console.log(
			`land: ${dirty.paths.length} uncommitted file${dirty.paths.length === 1 ? "" : "s"} in ${repository} stay untouched; none is in this merge`,
		);
	}
	return dirty.paths;
}
/** The strict ticket check and the test/ line cap; either one refuses the land. */
async function checkLandGates(repository: string, root: string, branch: string, id: string): Promise<void> {
	const gate = await landTicketCheck(repository, root, branch, "HEAD", id);
	if (!gate.ok) {
		throw new Error(`land refused: ${branch} has tickets that fail the strict check\n${gate.lines.join("\n")}`);
	}
	for (const line of gate.lines) {
		console.log(line);
	}
	const cap = landTestCap(repository, branch);
	if (cap) {
		console.log(cap.line);
	}
	if (cap?.refuse) {
		throw new Error(`land refused: ${cap.refuse}`);
	}
}

/** The cap on `test/` lines that `spec/vision.md` names, or undefined when it names none. */
export function testLineCap(vision: string): number | undefined {
	const match = /`test\/` holds at most ([\d,]+) lines/.exec(vision);
	return match?.[1] ? Number(match[1].replaceAll(",", "")) : undefined;
}

// The cap is read from the target's vision, the owner's copy, so a branch cannot raise its own cap.
// Only a branch that adds test lines and leaves test/ over the cap is refused; deletions always land.
function landTestCap(
	repository: string,
	branch: string,
): { readonly line: string; readonly refuse?: string } | undefined {
	const vision = spawnSync("git", ["show", "HEAD:spec/vision.md"], { cwd: repository, encoding: "utf8" });
	const cap = vision.status === 0 ? testLineCap(vision.stdout) : undefined;
	if (cap === undefined) {
		return undefined;
	}
	let added = 0;
	let removed = 0;
	for (const row of gitText(repository, ["diff", "--numstat", `HEAD...${branch}`, "--", "test"]).split("\n")) {
		const [plus = "", minus = ""] = row.split("\t");
		added += Number(plus) || 0;
		removed += Number(minus) || 0;
	}
	const counts = spawnSync("git", ["grep", "-c", "", "HEAD", "--", "test"], {
		cwd: repository,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	}).stdout;
	const lines =
		counts.split("\n").reduce((sum, row) => sum + (Number(row.slice(row.lastIndexOf(":") + 1)) || 0), 0) +
		added -
		removed;
	const line = `land: test/ holds ${lines} lines after this land (cap ${cap}, spec/vision.md); this branch +${added} -${removed}`;
	if (lines <= cap || added <= removed) {
		return { line };
	}
	return {
		line,
		refuse: `test/ would hold ${lines} lines; spec/vision.md caps it at ${cap}. Remove ${Math.min(lines - cap, added - removed)} test lines in this branch, or ask Adam to raise the cap.`,
	};
}

export const TICKET_PATH = /^spec\/features\/(?:[^/]+\/)*(F\d+)-[^/]+\/ticket\.md$/;

/**
 * The strict ticket check for tickets that `branch` adds, changes or moves against `target`, read at the branch tip.
 * `lines` is print-ready: the no-map note, warnings, errors, then the keeper command when the check refuses.
 */
export async function landTicketCheck(
	repository: string,
	root: string,
	branch: string,
	target = "HEAD",
	job = "<id>",
): Promise<{ readonly ok: boolean; readonly tickets: readonly string[]; readonly lines: readonly string[] }> {
	const changed = changedTickets(repository, branch, target);
	const tickets = [...changed.keys()];
	if (tickets.length === 0) {
		return { ok: true, tickets, lines: [] };
	}
	const lines: string[] = [];
	const placeIds = await checkPictureSources(repository, root, branch, tickets, lines);
	const tip = await mkdtemp(join(tmpdir(), "limen-land-"));
	try {
		extractTicketsAtTip(repository, branch, tip);
		const read = await readTickets(tip);
		const diagnostics = [...read.diagnostics, ...(placeIds ? checkTickets(read.tickets, placeIds) : [])].filter(
			(d) => d.source !== null && changed.has(d.source),
		);
		const failing = diagnostics.filter((d) => d.level === "error");
		const errors = failing.map((d) => `error ${d.source}:${d.line ?? 1}: ${d.message}`);
		let bad = failing[0]?.source ?? undefined;
		for (const duplicate of duplicateTicketErrors(repository, root, branch, changed)) {
			errors.push(duplicate.error);
			bad ??= duplicate.path;
		}
		for (const d of diagnostics) {
			if (d.level === "warn") {
				lines.push(`warn ${d.source}:${d.line ?? 1}: ${d.message}`);
			}
		}
		lines.push(...errors);
		if (errors.length === 0) {
			return { ok: true, tickets, lines };
		}
		bad ??= tickets[0];
		lines.push(
			`fix: limen keeper ${bad} --job ${job} --engine <engine> --provider <provider> --model <model> --thinking <level>`,
		);
		return { ok: false, tickets, lines };
	} finally {
		await rm(tip, { recursive: true, force: true });
	}
}
/** Ticket paths the branch adds, changes or moves against the target, with the first letter of their Git status. */
function changedTickets(repository: string, branch: string, target: string): Map<string, string> {
	const changed = new Map<string, string>();
	for (const row of gitText(repository, ["diff", "--name-status", "-M", `${target}...${branch}`]).split("\n")) {
		const [status = "", ...paths] = row.split("\t");
		const path = paths.at(-1) ?? "";
		if (/^[AMR]/.test(status) && TICKET_PATH.test(path)) {
			changed.set(path, status[0] ?? "");
		}
	}
	return changed;
}
/**
 * Warns about picture sources that name a changed ticket's feature but do not exist at the branch. Returns the place
 * ids tickets may touch, or undefined when the project has no picture map.
 */
async function checkPictureSources(
	repository: string,
	root: string,
	branch: string,
	tickets: readonly string[],
	lines: string[],
): Promise<ReadonlySet<string> | undefined> {
	const map = `${root}/.limen/picture`;
	if (!existsSync(map)) {
		lines.push(`land: no picture map at ${map}; touches place ids not checked`);
		return;
	}
	const model = await readPicture(map);
	const placeIds = new Set([
		...model.nodes.filter((node) => node.kind === "module").map((node) => node.id),
		...(model.project.rootId ? [model.project.rootId] : []),
	]);
	const codes = new Map(tickets.map((path) => [TICKET_PATH.exec(path)?.[1] ?? "", path]));
	for (const record of [...model.nodes, ...model.edges, ...model.features, ...model.journeys]) {
		for (const source of record.sources) {
			const current = codes.get(/\/(F\d+)-/.exec(source)?.[1] ?? "");
			if (current && !gitOk(repository, ["cat-file", "-e", `${branch}:${source.replace(/\/$/, "")}`])) {
				const at =
					(await readFile(join(map, record.source), "utf8")).split("\n").findIndex((line) => line.includes(source)) + 1;
				lines.push(
					`warn ${map}/${record.source}:${at || 1}: source "${source}" does not exist at ${branch}; fix: change it to ${current}`,
				);
			}
		}
	}
	return placeIds;
}
/** Writes the branch's tickets into `tip`. */
function extractTicketsAtTip(repository: string, branch: string, tip: string): void {
	const archive = execFileSync("git", ["archive", branch, "--", ":(glob)spec/features/**/ticket.md"], {
		cwd: repository,
		maxBuffer: 256 * 1024 * 1024,
	});
	execFileSync("tar", ["-x", "-C", tip], { input: archive });
}
/** An added ticket whose F number another ticket at the branch, the plant's archive or its series already uses. */
function duplicateTicketErrors(
	repository: string,
	root: string,
	branch: string,
	changed: ReadonlyMap<string, string>,
): { readonly path: string; readonly error: string }[] {
	const duplicates: { readonly path: string; readonly error: string }[] = [];
	const all = gitText(repository, ["ls-tree", "-r", "--name-only", branch, "--", "spec/features"]).split("\n");
	const elsewhere = takenElsewhere(root);
	for (const [path, status] of changed) {
		if (status !== "A") {
			continue;
		}
		const code = TICKET_PATH.exec(path)?.[1] ?? "";
		const other =
			all.find((candidate) => candidate !== path && TICKET_PATH.exec(candidate)?.[1] === code) ?? elsewhere.get(code);
		if (!other) {
			continue;
		}
		duplicates.push({
			path,
			error: `error ${path}:1: ${code} is also used by ${other}; fix: move this ticket to a free F number (limen ticket new picks one)`,
		});
	}
	return duplicates;
}

function gitText(cwd: string, args: readonly string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

function gitOk(cwd: string, args: readonly string[]): boolean {
	return spawnSync("git", args, { cwd, stdio: "ignore" }).status === 0;
}

function parseLandArgs(args: readonly string[]): {
	readonly query: string;
	readonly yes: boolean;
	readonly keepOpen: boolean;
	readonly onto?: string;
} {
	const { values, positionals } = parseFlags(
		args,
		{ yes: { type: "boolean" }, "keep-open": { type: "boolean" }, onto: { type: "string" } } as const,
		{
			unknown: (word) => `unknown land option ${word}`,
			missing: () => "--onto requires a branch",
			repeated: (flag) => (flag === "--onto" ? "--onto may be supplied only once" : undefined),
			endOfFlags: false,
		},
	);
	// An empty word, such as an unset shell variable, was never a job id.
	const [query, ...extra] = positionals.filter((word) => word !== "");
	if (!query) {
		throw new Error("land requires a job id");
	}
	if (extra.length > 0) {
		throw new Error("land requires exactly one job id");
	}
	const flags = { query, yes: values.yes ?? false, keepOpen: values["keep-open"] ?? false };
	return values.onto !== undefined ? { ...flags, onto: values.onto } : flags;
}

async function confirm(question: string): Promise<boolean> {
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
