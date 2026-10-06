import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { resolveJob } from "../job/lookup.ts";
import { readBoard } from "../picture/board.ts";
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

export async function landCommand(args: readonly string[], cwd: string): Promise<void> {
	if (process.env.LIMEN_GROUP_ID) {
		throw new Error("group members cannot land; the owner-facing lead owns landing");
	}
	const parsed = parseLandArgs(args);
	const { id, jobDir } = await resolveJob(cwd, parsed.query, "control");
	const [state, branch, base, repo, label] = await Promise.all([
		text(`${jobDir}/state`),
		text(`${jobDir}/branch`),
		text(`${jobDir}/base`),
		text(`${jobDir}/repo`),
		text(`${jobDir}/label`),
	]);
	if (state !== "done") {
		throw new Error(`job ${id} is ${state || "missing"}; land requires a done job`);
	}
	if (!branch || !base) {
		throw new Error(`job ${id} has no recorded ${branch ? "base" : "branch"}`);
	}
	const root = limenRoot(cwd);
	const repository = repo ? workspaceRepository(root, repo) : root;
	const current = currentBranch(repository);
	const target = parsed.onto ?? current;
	if (target !== current) {
		throw new Error(`land merges onto the current branch (${current}); checkout ${target} first`);
	}
	if (target === branch) {
		throw new Error(`already on job branch ${branch}`);
	}
	// Another session may be editing this checkout. Land merges beside its files and never touches them.
	const dirty = dirtyPaths(repository);
	if (dirty.staged.length) {
		throw new Error(
			`target ${target} has staged changes, and a merge would refuse or sweep them in: ${dirty.staged.join(", ")}; commit or unstage them first`,
		);
	}
	const commits = commitList(repository, base, branch);
	if (!commits) {
		throw new Error(`job ${id} has no commits to land`);
	}
	const merged = dirty.paths.length ? mergePaths(repository, branch) : new Set<string>();
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
	if (!parsed.yes && !(await confirm(`Land ${label || id} onto ${target}? [y/N] `))) {
		throw new Error("land cancelled");
	}
	let output: string;
	try {
		output = mergeBranch(repository, branch);
	} catch (error) {
		// A half-done merge beside another session's files would turn its next commit into this merge.
		if (dirty.paths.length) {
			abortMerge(repository);
		}
		throw error;
	}
	if (output) {
		console.log(output);
	}
	console.log(`landed ${id} onto ${target}`);
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
	const changed = new Map<string, string>();
	for (const row of gitText(repository, ["diff", "--name-status", "-M", `${target}...${branch}`]).split("\n")) {
		const [status = "", ...paths] = row.split("\t");
		const path = paths.at(-1) ?? "";
		if (/^[AMR]/.test(status) && TICKET_PATH.test(path)) {
			changed.set(path, status[0] ?? "");
		}
	}
	const tickets = [...changed.keys()];
	if (tickets.length === 0) {
		return { ok: true, tickets, lines: [] };
	}
	const lines: string[] = [];
	const map = `${root}/.limen/picture`;
	let placeIds: ReadonlySet<string> | undefined;
	if (existsSync(map)) {
		const model = await readPicture(map);
		placeIds = new Set([
			...model.nodes.filter((node) => node.kind === "module").map((node) => node.id),
			...(model.project.rootId ? [model.project.rootId] : []),
		]);
		const codes = new Map(tickets.map((path) => [TICKET_PATH.exec(path)?.[1] ?? "", path]));
		for (const record of [...model.nodes, ...model.edges, ...model.features, ...model.journeys]) {
			for (const source of record.sources) {
				const current = codes.get(/\/(F\d+)-/.exec(source)?.[1] ?? "");
				if (current && !gitOk(repository, ["cat-file", "-e", `${branch}:${source.replace(/\/$/, "")}`])) {
					const at =
						(await readFile(join(map, record.source), "utf8")).split("\n").findIndex((line) => line.includes(source)) +
						1;
					lines.push(
						`warn ${map}/${record.source}:${at || 1}: source "${source}" does not exist at ${branch}; fix: change it to ${current}`,
					);
				}
			}
		}
	} else {
		lines.push(`land: no picture map at ${map}; touches place ids not checked`);
	}
	const tip = await mkdtemp(join(tmpdir(), "limen-land-"));
	try {
		const archive = execFileSync("git", ["archive", branch, "--", ":(glob)spec/features/**/ticket.md"], {
			cwd: repository,
			maxBuffer: 256 * 1024 * 1024,
		});
		execFileSync("tar", ["-x", "-C", tip], { input: archive });
		const board = spawnSync("git", ["show", `${branch}:spec/build.md`], {
			cwd: repository,
			maxBuffer: 64 * 1024 * 1024,
		});
		if (board.status === 0) {
			await writeFile(join(tip, "spec/build.md"), board.stdout);
		}
		// A branch with no board at its tip gets no board warnings.
		const entries = board.status === 0 ? await readBoard(tip) : undefined;
		for (const path of tickets) {
			const lane = path.split("/")[2];
			const folder = path.split("/").at(-2) ?? "";
			const code = TICKET_PATH.exec(path)?.[1] ?? "";
			const want =
				lane === "active"
					? { state: "ACTIVE", line: `- \`${folder}\` (🟠 ACTIVE): <one clause> under ## NOW` }
					: lane === "done"
						? { state: "PROVEN", line: `- \`${folder}\` (🟢 PROVEN): <one clause> under ## PROVEN` }
						: undefined;
			if (!want || !entries) {
				continue;
			}
			const entry = entries.get(code.toLowerCase());
			if (!entry) {
				lines.push(`warn spec/build.md: no board line for ${code}; fix: add ${want.line}`);
			} else if (entry.state !== want.state) {
				lines.push(
					`warn spec/build.md:${entry.line}: ${code} is ${entry.state} on the board but its folder is in ${lane}; fix: mark it ${want.state} in the ${lane === "active" ? "NOW" : "PROVEN"} section`,
				);
			}
		}
		const read = await readTickets(tip);
		const diagnostics = [...read.diagnostics, ...(placeIds ? checkTickets(read.tickets, placeIds) : [])].filter(
			(d) => d.source !== null && changed.has(d.source),
		);
		const failing = diagnostics.filter((d) => d.level === "error");
		const errors = failing.map((d) => `error ${d.source}:${d.line ?? 1}: ${d.message}`);
		let bad = failing[0]?.source ?? undefined;
		const all = gitText(repository, ["ls-tree", "-r", "--name-only", branch, "--", "spec/features"]).split("\n");
		for (const [path, status] of changed) {
			if (status !== "A") {
				continue;
			}
			const code = TICKET_PATH.exec(path)?.[1];
			const other = all.find((candidate) => candidate !== path && TICKET_PATH.exec(candidate)?.[1] === code);
			if (!other) {
				continue;
			}
			errors.push(
				`error ${path}:1: ${code} is also used by ${other}; fix: move this ticket to a free F number (limen ticket new picks one)`,
			);
			bad ??= path;
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

function gitText(cwd: string, args: readonly string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

function gitOk(cwd: string, args: readonly string[]): boolean {
	return spawnSync("git", args, { cwd, stdio: "ignore" }).status === 0;
}

function parseLandArgs(args: readonly string[]): {
	readonly query: string;
	readonly yes: boolean;
	readonly onto?: string;
} {
	let query: string | undefined;
	let yes = false;
	let onto: string | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const value = args[index];
		if (!value) {
			continue;
		}
		if (value === "--yes") {
			yes = true;
		} else if (value === "--onto") {
			const next = args[index + 1];
			if (!next || next.startsWith("--")) {
				throw new Error("--onto requires a branch");
			}
			if (onto !== undefined) {
				throw new Error("--onto may be supplied only once");
			}
			onto = next;
			index += 1;
		} else if (value.startsWith("--")) {
			throw new Error(`unknown land option ${value}`);
		} else if (query) {
			throw new Error("land requires exactly one job id");
		} else {
			query = value;
		}
	}
	if (!query) {
		throw new Error("land requires a job id");
	}
	return onto !== undefined ? { query, yes, onto } : { query, yes };
}

async function confirm(question: string): Promise<boolean> {
	if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
		throw new Error("land requires a TTY confirm, or pass --yes");
	}
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
