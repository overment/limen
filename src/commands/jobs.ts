import type { Stats } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { inspectFinishWebhook } from "../integrations/finish-receipt.ts";
import { hostedAgentStatus } from "../integrations/herdr.ts";
import { derivePulse, type Job, type Pulse, parseJob, producedNothing, renderJob } from "../job/job.ts";
import { resolveJob } from "../job/lookup.ts";
import {
	colorWanted,
	humanDetail,
	humanSnapshot,
	type JobRecord,
	type Paint,
	paintWhen,
	resolveView,
	tallyStates,
} from "../job/view.ts";
import { limenRoot, liveDiffstat, workspaceRepository } from "../project/git.ts";
import { hostedUncertaintyText, readHostedUncertainty } from "../runtime/hosted-uncertainty.ts";
import { confirmDeadJobs, ownerAlive, startingJob } from "../runtime/reap.ts";

export const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
const HUMAN_TERMINAL_ROWS = 6;

type Selection = "snapshot" | "running" | "all" | { readonly prefix: string } | { readonly detail: string };
type Ordered = ReadonlyArray<readonly [string, string, string]>;

export async function jobsCommand(args: readonly string[], cwd: string): Promise<void> {
	const selection = parseJobsArgs(args);
	const tty = process.stdout.isTTY === true;
	const human = resolveView(process.env.LIMEN_VIEW, tty) === "human";
	const paint = paintWhen(human && colorWanted(tty, process.env.NO_COLOR, process.env.TERM));
	const root = limenRoot(cwd),
		jobsRoot = `${root}/.limen/jobs`;
	await confirmDeadJobs(jobsRoot);
	const entries = await readdir(jobsRoot, { withFileTypes: true }).catch((error: unknown) => {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
			return [];
		}
		throw error;
	});
	if (typeof selection === "object" && "detail" in selection) {
		const { id } = await resolveJob(cwd, selection.detail, "read");
		const loaded = await renderJobDirectory(root, jobsRoot, id, "detail");
		console.log(human ? humanDetail(loaded.record, paint) : loaded.compact);
		return;
	}
	const ids = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	if (ids.length === 0) {
		console.log("no jobs");
		return;
	}
	const order = await orderedJobs(ids, jobsRoot);
	if (typeof selection === "object") {
		await printLabelledJobs(root, jobsRoot, order, selection.prefix, human ? paint : undefined);
		return;
	}
	if (human) {
		await printHumanJobs(root, jobsRoot, order, selection, paint);
		return;
	}
	if (selection === "all") {
		console.log(
			(
				await Promise.all(order.map(async ([id]) => (await renderJobDirectory(root, jobsRoot, id, "detail")).compact))
			).join("\n\n"),
		);
		return;
	}
	await printJobRows(root, jobsRoot, order, selection);
}
/** Every job whose label, or id when it has none, starts with the prefix. A paint means the human view. */
async function printLabelledJobs(
	root: string,
	jobsRoot: string,
	order: Ordered,
	prefix: string,
	paint: Paint | undefined,
): Promise<void> {
	const labels = await Promise.all(order.map(([id]) => text(`${jobsRoot}/${id}/label`)));
	const listed = order.filter(([id], index) => (labels[index] || id).startsWith(prefix));
	if (listed.length === 0) {
		console.log("nothing matched");
		return;
	}
	const loaded = await Promise.all(
		listed.map(([id]) => renderJobDirectory(root, jobsRoot, id, paint ? "human" : "row")),
	);
	if (paint) {
		console.log(
			humanSnapshot(
				loaded.map((item) => item.record),
				tallyStates(listed.map(([, state]) => state)),
				false,
				paint,
			),
		);
		return;
	}
	console.log(loaded.map((item) => item.compact).join("\n"));
}
/** The human board: running jobs first, then the latest terminal jobs unless the selection asks for all or running. */
async function printHumanJobs(
	root: string,
	jobsRoot: string,
	order: Ordered,
	selection: "snapshot" | "running" | "all",
	paint: Paint,
): Promise<void> {
	const running = order.filter(([, state]) => state === "running");
	const terminal = order.filter(([, state]) => state !== "running");
	const shown =
		selection === "all"
			? order
			: selection === "running"
				? running
				: [...running, ...terminal.slice(0, HUMAN_TERMINAL_ROWS)];
	if (shown.length === 0) {
		console.log("no running jobs");
		return;
	}
	const records = await Promise.all(
		shown.map(async ([id]) => (await renderJobDirectory(root, jobsRoot, id, "human")).record),
	);
	console.log(
		humanSnapshot(
			records,
			tallyStates(order.map(([, state]) => state)),
			selection === "snapshot" && terminal.length > HUMAN_TERMINAL_ROWS,
			paint,
		),
	);
}
/** Running job rows; the snapshot adds recent jobs that produced nothing and counts what it hides. */
async function printJobRows(
	root: string,
	jobsRoot: string,
	order: Ordered,
	selection: "snapshot" | "running",
): Promise<void> {
	const running = order.filter(([, state]) => state === "running");
	const rendered = await Promise.all(
		running.map(async ([id]) => (await renderJobDirectory(root, jobsRoot, id, "row")).compact),
	);
	if (selection !== "snapshot") {
		console.log(rendered.length ? rendered.join("\n") : "no running jobs");
		return;
	}
	const terminal = order.filter(([, state]) => state !== "running");
	const observed = await Promise.all(
		terminal.map(async (entry) => ({
			entry,
			empty: !entry[1] || (await jobProducedNothing(`${jobsRoot}/${entry[0]}`)),
		})),
	);
	const empty = observed.filter(({ empty }) => empty).map(({ entry }) => entry);
	const now = Date.now();
	const recent = await Promise.all(
		empty.map(async ([id, state]) => !state || now - (await finishedAt(`${jobsRoot}/${id}`)) <= RECENT_MS),
	);
	const shown = empty.filter((_, index) => recent[index]);
	const emptyRendered = await Promise.all(
		shown.map(async ([id]) => (await renderJobDirectory(root, jobsRoot, id, "row")).compact),
	);
	const lines = [...rendered, ...emptyRendered];
	if (!lines.length) {
		lines.push("no running jobs");
	}
	const hiddenCount = terminal.length - empty.length;
	if (hiddenCount) {
		lines.push(
			`${hiddenCount} terminal ${hiddenCount === 1 ? "job" : "jobs"} hidden · use limen jobs --all or limen jobs <id> for detail`,
		);
	}
	const olderCount = empty.length - shown.length;
	if (olderCount) {
		lines.push(`${olderCount} older empty ${olderCount === 1 ? "job" : "jobs"} hidden`);
	}
	console.log(lines.join("\n"));
}
async function finishedAt(jobDir: string): Promise<number> {
	return Date.parse(await text(`${jobDir}/finished-at`)) || (await optionalStat(`${jobDir}/state`))?.mtimeMs || 0;
}
function parseJobsArgs(args: readonly string[]): Selection {
	if (args[0] === "--label") {
		if (args.length !== 2 || !args[1] || args[1].startsWith("--")) {
			throw new Error("jobs --label requires a prefix");
		}
		return { prefix: args[1] };
	}
	if (args.length > 1) {
		throw new Error(
			"jobs accepts no argument, --running, --active, --all, --label <prefix>, or one job id, suffix, or label",
		);
	}
	const arg = args[0];
	if (!arg) {
		return "snapshot";
	}
	if (arg === "--running" || arg === "--active") {
		return "running";
	}
	if (arg === "--all") {
		return "all";
	}
	if (arg.startsWith("--")) {
		throw new Error(`unknown jobs option ${JSON.stringify(arg)}`);
	}
	return { detail: arg };
}
async function orderedJobs(ids: readonly string[], jobsRoot: string): Promise<Ordered> {
	// A job its live spawner is still setting up lists as running, with pulse `starting`.
	const order = await Promise.all(
		ids.map(
			async (id) =>
				[id, await shownState(`${jobsRoot}/${id}`), (await text(`${jobsRoot}/${id}/started-at`)) || id] as const,
		),
	);
	return order.sort((a, b) => Number(b[1] === "running") - Number(a[1] === "running") || b[2].localeCompare(a[2]));
}
type JobFields = {
	readonly state: string;
	readonly label: string;
	readonly branch: string;
	readonly repo: string;
	readonly pid: string;
	readonly started: string;
	readonly finished: string;
	readonly toolCalls: string;
	readonly lastTool: string;
	readonly activity: string;
	readonly hosted: string;
	readonly candidate: string;
	readonly advisory: string;
	readonly parent: string;
	readonly engine: string;
	readonly stopReason: string;
};
/** Files beside the job fields. Detail-only files stay empty in the row and human views. */
type JobEvidence = {
	readonly warning: string;
	readonly agent: string;
	readonly commits: string;
	readonly commitsStat: Stats | undefined;
	readonly result: string;
	readonly versions: string;
	readonly cleanup: string;
	readonly finishWebhook: string;
	readonly herdrWake: string;
};
/** A job directory with its task and log present, read for one view. */
type LoadedJob = {
	readonly root: string;
	readonly jobDir: string;
	readonly id: string;
	readonly detailed: boolean;
	readonly fields: JobFields;
	readonly evidence: JobEvidence;
	readonly taskStat: Stats;
	readonly logStat: Stats;
	readonly log: { readonly tail: string; readonly detail: string };
};
/** What the parsed job and its live owner say, shared by the compact text and the record. */
type JobFacts = {
	readonly job: Job;
	readonly startedAt: Date;
	readonly observedAt: number;
	readonly agentStatus: string | undefined;
	readonly pulse: Pulse | undefined;
	readonly recordedTools: number | undefined;
	readonly empty: boolean;
	readonly diffstat: string;
};
export async function renderJobDirectory(
	root: string,
	jobsRoot: string,
	id: string,
	view: "row" | "human" | "detail",
): Promise<{ compact: string; record: JobRecord }> {
	const jobDir = `${jobsRoot}/${id}`;
	const detailed = view === "detail";
	const fields = await readJobFields(jobDir);
	if (!fields.state) {
		return { compact: `ORPHAN ${id} · no state`, record: { id, invalid: "orphan · no state" } };
	}
	const { evidence, taskStat, logStat } = await readJobEvidence(jobDir, fields, detailed);
	if (!taskStat || !logStat) {
		return { compact: `INVALID ${id} · missing task.md or log`, record: { id, invalid: "missing task.md or log" } };
	}
	const log = view !== "row" ? await readLog(`${jobDir}/log`) : { tail: "", detail: "" };
	if (fields.hosted) {
		log.tail = activitySummary(log.tail);
	}
	try {
		return await renderReadableJob({ root, jobDir, id, detailed, fields, evidence, taskStat, logStat, log });
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			compact: `INVALID ${id} · ${message}${log.tail ? `\n  log:\n${log.tail}` : ""}`,
			record: { id, invalid: message, ...(log.tail ? { logTail: log.tail } : {}) },
		};
	}
}
async function readJobFields(jobDir: string): Promise<JobFields> {
	const [
		state = "",
		label = "",
		branch = "",
		repo = "",
		pid = "",
		started = "",
		finished = "",
		toolCalls = "",
		lastTool = "",
		activity = "",
		hosted = "",
		candidate = "",
		advisory = "",
		parent = "",
		engine = "",
		stopReason = "",
	] = await Promise.all(
		"state label branch repo pid started-at finished-at tool-calls last-tool activity hosted candidate advisory parent engine stop-reason"
			.split(" ")
			.map((field) => (field === "state" ? shownState(jobDir) : text(`${jobDir}/${field}`))),
	);
	return {
		state,
		label,
		branch,
		repo,
		pid,
		started,
		finished,
		toolCalls,
		lastTool,
		activity,
		hosted,
		candidate,
		advisory,
		parent,
		engine,
		stopReason,
	};
}
async function readJobEvidence(
	jobDir: string,
	fields: JobFields,
	detailed: boolean,
): Promise<{ evidence: JobEvidence; taskStat: Stats | undefined; logStat: Stats | undefined }> {
	const uncertainty = readHostedUncertainty(jobDir);
	const warning = fields.advisory || (uncertainty ? hostedUncertaintyText(uncertainty) : "");
	const agent = await text(`${jobDir}/herdr/agent`);
	const [commits, commitsStat] = await Promise.all([text(`${jobDir}/commits`), optionalStat(`${jobDir}/commits`)]);
	const [result, versions] = detailed
		? await Promise.all([text(`${jobDir}/result`), text(`${jobDir}/versions`)])
		: ["", ""];
	const [taskStat, logStat] = await Promise.all([optionalStat(`${jobDir}/task.md`), optionalStat(`${jobDir}/log`)]);
	const cleanup = detailed ? await text(`${jobDir}/cleanup`) : "";
	const finishWebhook = detailed && fields.state !== "running" ? await inspectFinishWebhook(jobDir) : "";
	const herdrWake = detailed ? await text(`${jobDir}/notify/herdr-prompt`) : "";
	return {
		evidence: { warning, agent, commits, commitsStat, result, versions, cleanup, finishWebhook, herdrWake },
		taskStat,
		logStat,
	};
}
/** Parses the job and asks whether its owner is alive. Throws on a record that does not parse. */
async function renderReadableJob(loaded: LoadedJob): Promise<{ compact: string; record: JobRecord }> {
	const { id, detailed, fields, evidence, logStat, log } = loaded;
	const startedAt = recordedDate(fields.started, loaded.taskStat.mtime, "started-at");
	const job = parseJob({
		id,
		state: fields.state,
		label: displayed(fields.label || id, detailed),
		branch: displayed(fields.branch, detailed),
		...(fields.pid ? { pid: fields.pid } : {}),
		startedAt,
		lastOutputAt: logStat.mtime,
		detail: detailed ? log.detail : "",
	});
	const running = job.phase === "running";
	const observedAt = running ? Date.now() : recordedDate(fields.finished, new Date(), "finished-at").getTime();
	const alive = running && (await ownerAlive(loaded.jobDir));
	const agentStatus = running && fields.hosted && evidence.agent ? hostedAgentStatus(evidence.agent) : undefined;
	const pulse = running ? runningPulse(job.pid, alive, fields.activity) : undefined;
	const recordedTools = fields.toolCalls ? recordedCount(fields.toolCalls) : undefined;
	const empty = !running && producedNothing(recordedTools, evidence.commitsStat ? evidence.commits : undefined);
	const diffstat = detailed
		? liveDiffstat(fields.repo ? workspaceRepository(loaded.root, fields.repo) : loaded.root, fields.branch)
		: "";
	const rendered = renderJob(job, {
		elapsedMs: observedAt - startedAt.getTime(),
		silentMs: observedAt - logStat.mtimeMs,
		...(recordedTools !== undefined ? { toolCalls: recordedTools } : {}),
		...(empty ? { producedNothing: true } : {}),
		...(fields.lastTool ? { lastTool: displayed(fields.lastTool, detailed) } : {}),
		...(running && pulse ? { pulse, processAlive: alive } : {}),
		diffstat,
		logTail: log.tail,
	});
	const facts: JobFacts = { job, startedAt, observedAt, agentStatus, pulse, recordedTools, empty, diffstat };
	return { compact: [rendered, ...jobBlocks(loaded, facts)].join("\n"), record: jobRecord(loaded, facts) };
}
function runningPulse(pid: number | undefined, alive: boolean, activity: string): Pulse {
	const input: { alive: boolean; pid?: number; activity?: string } = { alive };
	if (pid !== undefined) {
		input.pid = pid;
	}
	if (activity) {
		input.activity = activity;
	}
	return derivePulse(input);
}
/** The indented lines under a job's first line, in the order the board has always shown them. */
function jobBlocks(loaded: LoadedJob, facts: JobFacts): string[] {
	const { detailed, fields, evidence } = loaded;
	const blocks: string[] = [];
	if (fields.repo) {
		blocks.push(`  repo ${displayed(fields.repo, detailed)}`);
	}
	if (fields.parent) {
		blocks.push(`  parent ${displayed(fields.parent, detailed)}`);
	}
	if (fields.candidate) {
		blocks.push(`  candidate ${displayed(fields.candidate, detailed)}`);
	}
	if (fields.engine && fields.engine !== "pi") {
		blocks.push(`  engine ${displayed(fields.engine, detailed)}`);
	}
	if (fields.hosted) {
		blocks.push("  hosted (weaker guarantees)");
	}
	if (facts.agentStatus) {
		blocks.push(`  agent ${facts.agentStatus}`);
	}
	if (facts.job.phase === "running" && evidence.warning) {
		blocks.push(`  advisory ${displayed(evidence.warning, detailed)}`);
	}
	const sections: ReadonlyArray<readonly [string, string]> = [
		["stop-reason", fields.stopReason],
		["versions", evidence.versions],
		["commits", detailed ? evidence.commits : ""],
		["result", evidence.result],
		["herdr-wake", evidence.herdrWake],
		["finish-webhook", evidence.finishWebhook],
		["cleanup", evidence.cleanup],
	];
	for (const [name, body] of sections) {
		if (body) {
			blocks.push(indented(name, body));
		}
	}
	return blocks;
}
function jobRecord(loaded: LoadedJob, facts: JobFacts): JobRecord {
	const { id, detailed, fields, evidence, logStat, log } = loaded;
	const { job, observedAt, pulse, recordedTools, empty, agentStatus } = facts;
	const reason = stopSummary(fields.stopReason || log.detail);
	const running = job.phase === "running";
	return {
		id,
		job,
		...(pulse ? { pulse } : {}),
		...(recordedTools !== undefined ? { toolCalls: recordedTools } : {}),
		...(empty ? { producedNothing: true } : {}),
		...(fields.lastTool ? { lastTool: displayed(fields.lastTool, detailed) } : {}),
		...((job.phase === "failed" || job.phase === "stopped") && reason && reason !== "see log" ? { reason } : {}),
		elapsedMs: observedAt - facts.startedAt.getTime(),
		silentMs: observedAt - logStat.mtimeMs,
		...(running ? {} : { ageMs: Date.now() - observedAt }),
		...(evidence.commitsStat ? { commitCount: evidence.commits.split("\n").filter((line) => line.trim()).length } : {}),
		...(fields.repo ? { repo: fields.repo } : {}),
		...(fields.parent ? { parent: fields.parent } : {}),
		...(fields.candidate ? { candidate: fields.candidate } : {}),
		...(fields.hosted ? { hosted: true } : {}),
		...(agentStatus ? { agentStatus } : {}),
		...(running && evidence.warning ? { advisory: evidence.warning } : {}),
		...recordedEvidence(loaded, facts.diffstat),
	};
}
/** Stop reason, detail files, diffstat and log tail of the record, in the order the record has always held them. */
function recordedEvidence(loaded: LoadedJob, diffstat: string): Partial<JobRecord> {
	const { detailed, fields, evidence, log } = loaded;
	return {
		...(fields.stopReason ? { stopReason: fields.stopReason } : {}),
		...(evidence.versions ? { versions: evidence.versions } : {}),
		...(detailed && evidence.commits ? { commits: evidence.commits } : {}),
		...(evidence.result ? { result: evidence.result } : {}),
		...(evidence.cleanup ? { cleanup: evidence.cleanup } : {}),
		...(evidence.herdrWake ? { herdrWake: evidence.herdrWake } : {}),
		...(evidence.finishWebhook ? { finishWebhook: evidence.finishWebhook } : {}),
		...(diffstat ? { diffstat } : {}),
		...(log.tail ? { logTail: log.tail } : {}),
	};
}
/** The stop reason or last log line without its prefix; a rate limit names its retry delay. */
function stopSummary(line: string): string {
	const reason = line
		.replace(/^\[limen [^\]]*\]\s*/, "")
		.replace(/^(error|failed|stopped):\s*/, "")
		.replace(/\s+/g, " ");
	if (!/\b429\b/.test(reason) || !/rate_limit_error|rate limit/i.test(reason)) {
		return reason;
	}
	const retryMs = /retry-after-ms=(\d+)/.exec(reason)?.[1];
	return `rate limit (429)${retryMs ? `; retry after ${Math.max(1, Math.round(Number(retryMs) / 60_000))}m` : ""}`;
}
/** Row and human views cut long values; the detail view shows them whole. */
function displayed(value: string, detailed: boolean): string {
	return detailed || value.length <= 160 ? value : `${value.slice(0, 159)}…`;
}
async function jobProducedNothing(jobDir: string): Promise<boolean> {
	const [toolCalls, commits, commitsStat] = await Promise.all([
		text(`${jobDir}/tool-calls`),
		text(`${jobDir}/commits`),
		optionalStat(`${jobDir}/commits`),
	]);
	if (!toolCalls || !commitsStat) {
		return false;
	}
	try {
		return producedNothing(recordedCount(toolCalls), commits);
	} catch {
		return false;
	}
}
function indented(name: string, body: string): string {
	return `  ${name}:\n${body
		.split("\n")
		.map((line) => `    ${line}`)
		.join("\n")}`;
}
/** The recorded state, or `running` for a job whose live spawner has not written one yet. */
export async function shownState(jobDir: string): Promise<string> {
	return (await text(`${jobDir}/state`)) || ((await startingJob(jobDir)) ? "running" : "");
}
function text(path: string): Promise<string> {
	return readFile(path, "utf8")
		.then((value) => value.trim())
		.catch(() => "");
}
function optionalStat(path: string) {
	return stat(path).catch(() => undefined);
}
function recordedDate(value: string, fallback: Date, name: string): Date {
	if (!value) {
		return fallback;
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new Error(`invalid ${name} ${JSON.stringify(value.slice(0, 160))}`);
	}
	return date;
}
function recordedCount(value: string): number {
	const count = Number(value);
	if (!Number.isSafeInteger(count) || count < 0) {
		throw new Error(`invalid tool-calls ${JSON.stringify(value.slice(0, 160))}`);
	}
	return count;
}
function activitySummary(tail: string): string {
	const words = tail.split("\n");
	if (words.length < 2 || !words.every((word) => /^[a-z_-]+$/.test(word))) {
		return tail;
	}
	return `recent activity: ${[...new Set(words)].join(", ")} (${words.length} events)`;
}
async function readLog(path: string): Promise<{ tail: string; detail: string }> {
	try {
		const handle = await open(path, "r");
		try {
			const { size } = await handle.stat();
			const buf = Buffer.alloc(Math.min(size, 8_192));
			await handle.read(buf, 0, buf.length, Math.max(0, size - buf.length));
			const raw = buf.toString("utf8");
			const lines = (size > buf.length ? raw.replace(/^[^\n]*\n?/, "") : raw).trimEnd().split("\n");
			const bytes = Buffer.from(lines.slice(-20).join("\n"));
			const overflow = bytes.byteLength > 4_096;
			const slice = overflow ? bytes.subarray(bytes.byteLength - 4_096) : bytes;
			const tail = overflow ? slice.toString("utf8").replace(/^[^\n]*\n?/, "…\n") : slice.toString();
			return { tail, detail: lines.findLast((line) => /^\[limen [^\]]*\] (failed|stopped):/.test(line)) ?? "" };
		} finally {
			await handle.close();
		}
	} catch {
		return { tail: "", detail: "" };
	}
}
