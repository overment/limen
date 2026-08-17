import { open, readdir, readFile, stat } from "node:fs/promises";
import { limenRoot, liveDiffstat, workspaceRepository } from "../git.ts";
import { hostedAgentStatus } from "../herdr.ts";
import { derivePulse, type Pulse, parseJob, renderJob } from "../job.ts";
import { resolveJob } from "../lookup.ts";
import { processGroupAlive } from "../proc.ts";

export async function jobsCommand(args: readonly string[], cwd: string): Promise<void> {
	const selection = select(args);
	const root = limenRoot(cwd),
		jobsRoot = `${root}/.limen/jobs`;
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
		console.log(await renderJobDirectory(root, jobsRoot, id, true));
		return;
	}
	const order = await orderedJobs(ids, jobsRoot);
	if (selection === "all") {
		console.log((await Promise.all(order.map(([id]) => renderJobDirectory(root, jobsRoot, id, true)))).join("\n\n"));
		return;
	}
	const running = order.filter(([, state]) => state === "running");
	const rendered = await Promise.all(running.map(([id]) => renderJobDirectory(root, jobsRoot, id, false)));
	const summary = rendered.length ? rendered.join("\n") : "no running jobs";
	console.log(
		selection === "snapshot" && order.length > running.length
			? `${summary}\n${order.length - running.length} terminal ${order.length - running.length === 1 ? "job" : "jobs"} hidden · use limen jobs --all or limen jobs <id> for detail`
			: summary,
	);
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
async function renderJobDirectory(root: string, jobsRoot: string, id: string, detailed: boolean): Promise<string> {
	const jobDir = `${jobsRoot}/${id}`;
	const [state = "", label = "", branch = "", repo = "", pid, started = "", finished = "", toolCalls, lastTool, activity, hosted] = await Promise.all(
		"state label branch repo pid started-at finished-at tool-calls last-tool activity hosted".split(" ").map((field) => text(`${jobDir}/${field}`)),
	);
	const agent = await text(`${jobDir}/herdr/agent`);
	const [taskStat, logStat] = await Promise.all([optionalStat(`${jobDir}/task.md`), optionalStat(`${jobDir}/log`)]);
	const cleanup = detailed ? await text(`${jobDir}/cleanup`) : "";
	if (!taskStat || !logStat) return `INVALID ${id} · missing task.md or log`;
	const log = detailed ? await readLog(`${jobDir}/log`) : { tail: "", detail: "" };
	const display = (value: string) => (detailed || value.length <= 160 ? value : `${value.slice(0, 159)}…`);
	try {
		const startedAt = recordedDate(started, taskStat.mtime, "started-at");
		const job = parseJob({ id, state, label: display(label || id), branch: display(branch), ...(pid ? { pid } : {}), startedAt, lastOutputAt: logStat.mtime, detail: log.detail });
		const observedAt = job.phase === "running" ? Date.now() : recordedDate(finished, new Date(), "finished-at").getTime();
		const processAlive = job.phase === "running" && job.pid !== undefined && processGroupAlive(job.pid);
		const agentStatus = job.phase === "running" && hosted && agent ? hostedAgentStatus(agent) : undefined;
		const hostedAlive = agentStatus !== undefined && agentStatus !== "missing";
		const alive = hosted ? hostedAlive || processAlive : processAlive;
		const pulse: Pulse | undefined =
			job.phase === "running"
				? hosted
					? !alive
						? "dead"
						: activity === "tool" || activity === "wait"
							? activity
							: agentStatus === "working"
								? "think"
								: "wait"
					: derivePulse({ alive: processAlive, ...(job.pid !== undefined ? { pid: job.pid } : {}), ...(activity ? { activity } : {}) })
				: undefined;
		const rendered = renderJob(job, {
			elapsedMs: observedAt - startedAt.getTime(),
			silentMs: observedAt - logStat.mtimeMs,
			...(toolCalls ? { toolCalls: recordedCount(toolCalls) } : {}),
			...(lastTool ? { lastTool: display(lastTool) } : {}),
			...(job.phase === "running" && pulse ? { pulse, processAlive: alive } : {}),
			diffstat: detailed ? liveDiffstat(repo ? workspaceRepository(root, repo) : root, branch) : "",
			logTail: log.tail,
		});
		const blocks = [rendered];
		if (repo) blocks.push(`  repo ${display(repo)}`);
		if (hosted) blocks.push("  hosted (weaker guarantees)");
		if (cleanup)
			blocks.push(
				`  cleanup:\n${cleanup
					.split("\n")
					.map((line) => `    ${line}`)
					.join("\n")}`,
			);
		return blocks.join("\n");
	} catch (error: unknown) {
		return `INVALID ${id} · ${error instanceof Error ? error.message : String(error)}${log.tail ? `\n  log:\n${log.tail}` : ""}`;
	}
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
function recordedCount(value: string): number {
	const count = Number(value);
	if (!Number.isSafeInteger(count) || count < 0) throw new Error(`invalid tool-calls ${JSON.stringify(value.slice(0, 160))}`);
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
			return { tail, detail: lines.findLast((line) => line.startsWith("[limen ") || line.startsWith("[control ")) ?? "" };
		} finally {
			await handle.close();
		}
	} catch {
		return { tail: "", detail: "" };
	}
}
