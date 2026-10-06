import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { readRun } from "../job/group-cabinet.ts";
import { resolveJob } from "../job/lookup.ts";
import { branchCommit, branchExists, commitHasFile, limenRoot, workspaceRepository } from "../project/git.ts";
import { ownerAlive } from "../runtime/reap.ts";
import { landTicketCheck, TICKET_PATH } from "./land.ts";
import { spawnCommand } from "./spawn.ts";

type KeeperOptions = {
	readonly ticket: string;
	readonly jobs: readonly string[];
	readonly candidate?: string;
	readonly group?: string;
	readonly route: readonly string[];
	readonly timeout: string;
};

type KeeperJob = {
	readonly id: string;
	readonly jobDir: string;
	readonly state: string;
	readonly branch: string;
	readonly repo: string;
};

// Every keeper flag takes a value. `--job` may repeat.
const FLAGS = {
	job: { type: "string", multiple: true },
	candidate: { type: "string" },
	group: { type: "string" },
	timeout: { type: "string", default: "20m" },
	engine: { type: "string" },
	provider: { type: "string" },
	model: { type: "string" },
	thinking: { type: "string" },
} as const;

const ROUTE = ["engine", "provider", "model", "thinking"] as const;

/** After the work: a short job on its own branch at the candidate tip fixes the ticket, board and map links. */
export async function keeperCommand(args: readonly string[], cwd: string): Promise<void> {
	if (process.env.LIMEN_GROUP_ID) {
		throw new Error(
			"group members cannot start a keeper; the owner-facing lead starts one after it merges the team branches",
		);
	}
	const options = parseKeeperArgs(args);
	const code = TICKET_PATH.exec(options.ticket)?.[1];
	if (!code) {
		throw new Error(`keeper needs a ticket path like spec/features/active/FNNN-slug/ticket.md, not ${options.ticket}`);
	}
	const root = limenRoot(cwd);
	const jobs = await finishedJobs(root, options);
	const [first] = jobs;
	if (!first) {
		throw new Error("keeper requires --job ID or --group GROUP-ID");
	}
	if (!options.candidate && jobs.length > 1) {
		throw new Error("several jobs need one candidate; pass --candidate <integration branch>");
	}
	const candidate = options.candidate ?? first.branch;
	if (!candidate) {
		throw new Error(`job ${first.id} has no recorded branch; pass --candidate BRANCH`);
	}
	const repository = first.repo ? workspaceRepository(root, first.repo) : root;
	if (!branchExists(repository, candidate)) {
		throw new Error(`candidate branch ${candidate} does not exist`);
	}
	const tip = branchCommit(repository, candidate);
	const ticket = ticketAtTip(repository, tip, options.ticket, code, candidate);
	const keeperBranch = `limen/keeper-${code.toLowerCase()}-${tip.slice(0, 7)}`;
	if (branchExists(repository, keeperBranch)) {
		throw new Error(`keeper branch ${keeperBranch} already exists; land or delete it first`);
	}

	const gate = await landTicketCheck(repository, root, candidate, "HEAD", first.id);
	// The fix line names limen keeper; the keeper itself must not start another one.
	const gateLines = gate.lines.filter((line) => !line.startsWith("fix: ")).map((line) => `  ${line}`);
	const map = `${root}/.limen/picture`;
	const blocks = await Promise.all(jobs.map((job) => jobBlock(repository, job)));
	const packet = [
		`Spec keeper for ${code}. Fix the ticket, board and map links for this work; commit on this branch.`,
		"",
		`Ticket: ${ticket}`,
		"Board: spec/build.md",
		`Map: ${existsSync(map) ? map : "none"}`,
		`Group: ${options.group ?? "none"}`,
		`Candidate: ${candidate} at ${tip}`,
		`Changed tickets: ${gate.tickets.length > 0 ? gate.tickets.join(", ") : "none"}`,
		"Land check now:",
		...(gate.ok && gate.lines.length === 0 ? ["no error"] : gateLines),
		"",
		...blocks,
		"",
	].join("\n");

	execFileSync("git", ["branch", keeperBranch, tip], { cwd: repository, stdio: "ignore" });
	const scratch = await mkdtemp(join(tmpdir(), "limen-keeper-"));
	try {
		const packetFile = `${scratch}/task.md`;
		await writeFile(packetFile, packet);
		const repo = first.repo ? ["--repo", first.repo] : [];
		const label = `spec keeper · ${code}`;
		await spawnCommand(
			[
				...options.route,
				...["--role", "keeper", "--detached", "--branch", keeperBranch, "--timeout", options.timeout],
				...["--label", label, "--task-file", packetFile, ...repo],
			],
			cwd,
		);
	} catch (error) {
		execFileSync("git", ["branch", "-D", keeperBranch], { cwd: repository, stdio: "ignore" });
		throw error;
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

function parseKeeperArgs(args: readonly string[]): KeeperOptions {
	rejectBadFlags(args);
	const { values, positionals } = parseArgs({ args: [...args], options: FLAGS, allowPositionals: true });
	const [ticket, ...extra] = positionals;
	if (!ticket || extra.length > 0) {
		throw new Error("keeper requires exactly one <ticket-path>");
	}
	const jobs = values.job ?? [];
	if (jobs.length === 0 && !values.group) {
		throw new Error("keeper requires --job ID or --group GROUP-ID");
	}
	const route: string[] = [];
	for (const name of ROUTE) {
		const value = values[name];
		if (!value) {
			throw new Error(`keeper requires --engine --provider --model --thinking; missing --${name}`);
		}
		route.push(`--${name}`, value);
	}
	return {
		ticket,
		jobs,
		route,
		timeout: values.timeout,
		...(values.candidate ? { candidate: values.candidate } : {}),
		...(values.group ? { group: values.group } : {}),
	};
}

// parseArgs words its own errors. This first pass keeps keeper's messages.
function rejectBadFlags(args: readonly string[]): void {
	const { tokens } = parseArgs({
		args: [...args],
		options: FLAGS,
		allowPositionals: true,
		strict: false,
		tokens: true,
	});
	for (const token of tokens) {
		if (token.kind !== "option") {
			continue;
		}
		if (!Object.hasOwn(FLAGS, token.name)) {
			throw new Error(`unknown keeper option ${token.rawName}`);
		}
		// Without strict mode, parseArgs takes the next flag as the value: `--job --candidate x`.
		if (!token.value || (!token.inlineValue && token.value.startsWith("-"))) {
			throw new Error(`${token.rawName} requires a value`);
		}
	}
}

/** The jobs the keeper reads. A group's keeper reads every member; the lead names the group, not each member. */
async function finishedJobs(root: string, options: KeeperOptions): Promise<KeeperJob[]> {
	const queries = new Set(options.jobs);
	if (options.group) {
		for (const member of (await readRun(root, options.group)).members) {
			queries.add(member.id);
		}
	}
	const jobs: KeeperJob[] = [];
	for (const query of queries) {
		const { id, jobDir } = await resolveJob(root, query, "control");
		const state = await text(`${jobDir}/state`);
		if (state === "running" || (await ownerAlive(jobDir))) {
			throw new Error(`job ${id} is still running. A keeper never commits beside a live job. Wait for it, or stop it.`);
		}
		jobs.push({ id, jobDir, state, branch: await text(`${jobDir}/branch`), repo: await text(`${jobDir}/repo`) });
	}
	return jobs;
}

/** A ticket moved to another lane leaves its old path in the job's task. Follow the one folder with that number. */
function ticketAtTip(repository: string, tip: string, ticket: string, code: string, candidate: string): string {
	if (commitHasFile(repository, tip, ticket)) {
		return ticket;
	}
	const tree = execFileSync("git", ["ls-tree", "-r", "--name-only", tip, "--", "spec/features"], {
		cwd: repository,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	const moved = tree.split("\n").filter((path) => TICKET_PATH.exec(path)?.[1] === code);
	const [only] = moved;
	if (moved.length !== 1 || !only) {
		const found = moved.length > 0 ? `; ${code} is at ${moved.join(", ")}` : "";
		throw new Error(`ticket ${ticket} is missing at ${candidate} (${tip.slice(0, 7)})${found}`);
	}
	console.log(`ticket moved: ${ticket} -> ${only}`);
	return only;
}

async function jobBlock(repository: string, job: KeeperJob): Promise<string> {
	const [label, base, worktree] = await Promise.all(
		["label", "base", "worktree"].map((name) => text(`${job.jobDir}/${name}`)),
	);
	const jobTip = job.branch && branchExists(repository, job.branch) ? branchCommit(repository, job.branch) : "none";
	const sessions = await readdir(`${job.jobDir}/session`).catch(() => [] as string[]);
	const session = sessions
		.filter((name) => name.endsWith(".jsonl"))
		.sort()
		.at(-1);
	return [
		`Job: ${job.id}`,
		`  Label: ${label || job.id}`,
		`  State: ${job.state || "missing"}`,
		`  Branch: ${job.branch || "none"} (base ${base || "none"}, tip ${jobTip})`,
		`  Worktree: ${worktree || "none"}`,
		`  Session: ${session ? `${job.jobDir}/session/${session}` : "none"}`,
		`  Task: ${job.jobDir}/task.md`,
	].join("\n");
}

function text(path: string): Promise<string> {
	return readFile(path, "utf8").then(
		(value) => value.trim(),
		() => "",
	);
}
