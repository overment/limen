import { open, readdir, readFile, stat } from "node:fs/promises";
import { processGroupAlive } from "../contain.ts";
import { limenRoot, liveDiffstat, workspaceRepository } from "../git.ts";
import { hostedAgentStatus } from "../herdr.ts";
import { derivePulse, parseJob, producedNothing, renderJob } from "../job.ts";
import { resolveJob } from "../lookup.ts";
import { confirmDeadJobs } from "../reap.ts";
import { colorWanted, humanDetail, humanSnapshot, type JobRecord, paintWhen, resolveView, tallyStates } from "../view.ts";

export async function jobsCommand(args: readonly string[], cwd: string): Promise<void> {
	const selection = select(args);
	const tty = process.stdout.isTTY === true;
	const human = resolveView(process.env.LIMEN_VIEW, tty) === "human";
	const paint = paintWhen(human && colorWanted(tty, process.env.NO_COLOR, process.env.TERM));
	const root = limenRoot(cwd),
		jobsRoot = `${root}/.limen/jobs`;
	await confirmDeadJobs(jobsRoot);
	const entries = await readdir(jobsRoot, { withFileTypes: true }).catch((error: unknown) => {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return [];
		throw error;
	});
	const ids = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	if (ids.length === 0) {
		console.log("no jobs");
		return;
	}
	if (typeof selection === "object") {
		const { id } = await resolveJob(cwd, selection.detail);
		const loaded = await renderJobDirectory(root, jobsRoot, id, true, human);
		console.log(human ? humanDetail(loaded.record, paint) : loaded.compact);
		return;
	}
	const order = await orderedJobs(ids, jobsRoot);
	if (human) {
		const running = order.filter(([, state]) => state === "running");
		const terminal = order.filter(([, state]) => state !== "running");
		const shown = selection === "all" ? order : selection === "running" ? running : [...running, ...terminal.slice(0, 6)];
		if (shown.length === 0) {
			console.log("no running jobs");
			return;
		}
		const records = await Promise.all(shown.map(async ([id]) => (await renderJobDirectory(root, jobsRoot, id, false, true)).record));
		console.log(humanSnapshot(records, tallyStates(order.map(([, state]) => state)), selection === "snapshot" && terminal.length > 6, paint));
		return;
	}
	if (selection === "all") {
		console.log((await Promise.all(order.map(async ([id]) => (await renderJobDirectory(root, jobsRoot, id, true)).compact))).join("\n\n"));
		return;
	}
	const running = order.filter(([, state]) => state === "running");
	const rendered = await Promise.all(running.map(async ([id]) => (await renderJobDirectory(root, jobsRoot, id, false)).compact));
	if (selection !== "snapshot") {
		console.log(rendered.length ? rendered.join("\n") : "no running jobs");
		return;
	}
	const terminal = order.filter(([, state]) => state !== "running");
	const observed = await Promise.all(terminal.map(async (entry) => ({ entry, empty: !entry[1] || (await jobProducedNothing(`${jobsRoot}/${entry[0]}`)) })));
	const empty = observed.filter(({ empty }) => empty).map(({ entry }) => entry);
	const emptyRendered = await Promise.all(empty.map(async ([id]) => (await renderJobDirectory(root, jobsRoot, id, false)).compact));
	const summary = [...rendered, ...emptyRendered].join("\n") || "no running jobs";
	const hiddenCount = terminal.length - empty.length;
	console.log(hiddenCount ? `${summary}\n${hiddenCount} terminal ${hiddenCount === 1 ? "job" : "jobs"} hidden · use limen jobs --all or limen jobs <id> for detail` : summary);
}
function select(args: readonly string[]) {
	if (args.length > 1) throw new Error("jobs accepts no argument, --running, --active, --all, or one job id, suffix, or label");
	const arg = args[0];
	if (!arg) return "snapshot";
	if (arg === "--running" || arg === "--active") return "running";
	if (arg === "--all") return "all";
	if (arg.startsWith("--")) throw new Error(`unknown jobs option ${JSON.stringify(arg)}`);
	return { detail: arg };
}
async function orderedJobs(ids: readonly string[], jobsRoot: string): Promise<ReadonlyArray<readonly [string, string, string]>> {
	const order = await Promise.all(ids.map(async (id) => [id, await text(`${jobsRoot}/${id}/state`), (await text(`${jobsRoot}/${id}/started-at`)) || id] as const));
	return order.sort((a, b) => Number(b[1] === "running") - Number(a[1] === "running") || b[2].localeCompare(a[2]));
}
async function renderJobDirectory(root: string, jobsRoot: string, id: string, detailed: boolean, human = false): Promise<{ compact: string; record: JobRecord }> {
	const jobDir = `${jobsRoot}/${id}`;
	const [
		state = "",
		label = "",
		branch = "",
		repo = "",
		pid,
		started = "",
		finished = "",
		toolCalls,
		lastTool,
		activity,
		hosted,
		candidate = "",
		advisory = "",
		parent = "",
		engine = "",
		changedFilesText,
	] = await Promise.all(
		"state label branch repo pid started-at finished-at tool-calls last-tool activity hosted candidate advisory parent engine changed-files"
			.split(" ")
			.map((field) => text(`${jobDir}/${field}`)),
	);
	if (!state) return { compact: `ORPHAN ${id} · no state`, record: { id, invalid: "orphan · no state" } };
	const agent = await text(`${jobDir}/herdr/agent`);
	const [commits, commitsStat] = await Promise.all([text(`${jobDir}/commits`), optionalStat(`${jobDir}/commits`)]);
	const [result, stopReason, versions] = detailed ? await Promise.all([text(`${jobDir}/result`), text(`${jobDir}/stop-reason`), text(`${jobDir}/versions`)]) : ["", "", ""];
	const [taskStat, logStat] = await Promise.all([optionalStat(`${jobDir}/task.md`), optionalStat(`${jobDir}/log`)]);
	const cleanup = detailed ? await text(`${jobDir}/cleanup`) : "";
	if (!taskStat || !logStat) return { compact: `INVALID ${id} · missing task.md or log`, record: { id, invalid: "missing task.md or log" } };
	const log = detailed || human ? await readLog(`${jobDir}/log`) : { tail: "", detail: "" };
	const display = (value: string) => (detailed || value.length <= 160 ? value : `${value.slice(0, 159)}…`);
	try {
		const startedAt = recordedDate(started, taskStat.mtime, "started-at");
		const job = parseJob({
			id,
			state,
			label: display(label || id),
			branch: display(branch),
			...(pid ? { pid } : {}),
			startedAt,
			lastOutputAt: logStat.mtime,
			detail: detailed ? log.detail : "",
		});
		const observedAt = job.phase === "running" ? Date.now() : recordedDate(finished, new Date(), "finished-at").getTime();
		const processAlive = job.phase === "running" && job.pid !== undefined && processGroupAlive(job.pid);
		const agentStatus = job.phase === "running" && hosted && agent ? hostedAgentStatus(agent) : undefined;
		const hostedAlive = agentStatus !== undefined && agentStatus !== "missing";
		const alive = hosted ? hostedAlive || processAlive : processAlive;
		const pulse = job.phase === "running" ? derivePulse({ alive, ...(job.pid !== undefined ? { pid: job.pid } : {}), ...(activity ? { activity } : {}) }) : undefined;
		const recordedTools = toolCalls ? recordedCount(toolCalls) : undefined;
		const liveFiles = job.phase === "running" && changedFilesText ? { changedFiles: recordedCount(changedFilesText, "changed-files") } : {};
		const empty = job.phase !== "running" && producedNothing(recordedTools, commitsStat ? commits : undefined);
		const diffstat = detailed ? liveDiffstat(repo ? workspaceRepository(root, repo) : root, branch) : "";
		const rendered = renderJob(job, {
			elapsedMs: observedAt - startedAt.getTime(),
			silentMs: observedAt - logStat.mtimeMs,
			...(recordedTools !== undefined ? { toolCalls: recordedTools } : {}),
			...liveFiles,
			...(empty ? { producedNothing: true } : {}),
			...(lastTool ? { lastTool: display(lastTool) } : {}),
			...(job.phase === "running" && pulse ? { pulse, processAlive: alive } : {}),
			diffstat,
			logTail: log.tail,
		});
		const blocks = [rendered];
		if (repo) blocks.push(`  repo ${display(repo)}`);
		if (parent) blocks.push(`  parent ${display(parent)}`);
		if (candidate) blocks.push(`  candidate ${display(candidate)}`);
		if (engine && engine !== "pi") blocks.push(`  engine ${display(engine)}`);
		if (hosted) blocks.push("  hosted (weaker guarantees)");
		if (job.phase === "running" && advisory) blocks.push(`  advisory ${display(advisory)}`);
		if (stopReason) blocks.push(indented("stop-reason", stopReason));
		if (versions) blocks.push(indented("versions", versions));
		if (detailed && commits) blocks.push(indented("commits", commits));
		if (result) blocks.push(indented("result", result));
		if (cleanup)
			blocks.push(
				`  cleanup:\n${cleanup
					.split("\n")
					.map((line) => `    ${line}`)
					.join("\n")}`,
			);
		const reason = log.detail.replace(/^\[limen [^\]]*\]\s*/, "").replace(/^(failed|stopped):\s*/, "");
		const record: JobRecord = {
			id,
			job,
			...(pulse ? { pulse } : {}),
			...(recordedTools !== undefined ? { toolCalls: recordedTools } : {}),
			...liveFiles,
			...(empty ? { producedNothing: true } : {}),
			...(lastTool ? { lastTool: display(lastTool) } : {}),
			...((job.phase === "failed" || job.phase === "stopped") && reason && reason !== "see log" ? { reason } : {}),
			elapsedMs: observedAt - startedAt.getTime(),
			silentMs: observedAt - logStat.mtimeMs,
			...(job.phase !== "running" ? { ageMs: Date.now() - observedAt } : {}),
			...(commitsStat ? { commitCount: commits.split("\n").filter((line) => line.trim()).length } : {}),
			...(repo ? { repo } : {}),
			...(parent ? { parent } : {}),
			...(candidate ? { candidate } : {}),
			...(hosted ? { hosted: true } : {}),
			...(job.phase === "running" && advisory ? { advisory } : {}),
			...(stopReason ? { stopReason } : {}),
			...(versions ? { versions } : {}),
			...(detailed && commits ? { commits } : {}),
			...(result ? { result } : {}),
			...(cleanup ? { cleanup } : {}),
			...(diffstat ? { diffstat } : {}),
			...(log.tail ? { logTail: log.tail } : {}),
		};
		return { compact: blocks.join("\n"), record };
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			compact: `INVALID ${id} · ${message}${log.tail ? `\n  log:\n${log.tail}` : ""}`,
			record: { id, invalid: message, ...(log.tail ? { logTail: log.tail } : {}) },
		};
	}
}
async function jobProducedNothing(jobDir: string): Promise<boolean> {
	const [toolCalls, commits, commitsStat] = await Promise.all([text(`${jobDir}/tool-calls`), text(`${jobDir}/commits`), optionalStat(`${jobDir}/commits`)]);
	if (!toolCalls || !commitsStat) return false;
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
function text(path: string): Promise<string> {
	return readFile(path, "utf8")
		.then((value) => value.trim())
		.catch(() => "");
}
function optionalStat(path: string) {
	return stat(path).catch(() => undefined);
}
function recordedDate(value: string, fallback: Date, name: string): Date {
	if (!value) return fallback;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) throw new Error(`invalid ${name} ${JSON.stringify(value.slice(0, 160))}`);
	return date;
}
function recordedCount(value: string, name = "tool-calls"): number {
	const count = Number(value);
	if (!Number.isSafeInteger(count) || count < 0) throw new Error(`invalid ${name} ${JSON.stringify(value.slice(0, 160))}`);
	return count;
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
			return { tail, detail: lines.findLast((line) => line.startsWith("[limen ")) ?? "" };
		} finally {
			await handle.close();
		}
	} catch {
		return { tail: "", detail: "" };
	}
}
