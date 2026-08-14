import { open, readdir, readFile, stat } from "node:fs/promises";
import { liveDiffstat, repoRoot } from "../git.ts";
import { derivePulse, parseJob, renderJob } from "../job.ts";
import { processGroupAlive } from "../proc.ts";
export async function jobsCommand(_args: readonly string[], cwd: string): Promise<void> {
	const root = repoRoot(cwd);
	const jobsRoot = `${root}/.limen/jobs`;
	const entries = await readdir(jobsRoot, { withFileTypes: true }).catch((error: unknown) => {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return [];
		throw error;
	});
	const ids = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	if (ids.length === 0) {
		console.log("no jobs");
		return;
	}
	const order = await Promise.all(ids.map(async (id) => [id, await text(`${jobsRoot}/${id}/state`), (await text(`${jobsRoot}/${id}/started-at`)) || id] as const));
	order.sort((a, b) => Number(b[1] === "running") - Number(a[1] === "running") || b[2].localeCompare(a[2]));
	const rendered = [];
	for (const [id] of order) rendered.push(await renderJobDirectory(root, jobsRoot, id));
	console.log(rendered.join("\n\n"));
}
async function renderJobDirectory(root: string, jobsRoot: string, id: string): Promise<string> {
	const jobDir = `${jobsRoot}/${id}`;
	const [state, label, branch, pid, started, finished, toolCalls, lastTool, activity, taskStat, logStat, log] = await Promise.all([
		text(`${jobDir}/state`),
		text(`${jobDir}/label`),
		text(`${jobDir}/branch`),
		text(`${jobDir}/pid`),
		text(`${jobDir}/started-at`),
		text(`${jobDir}/finished-at`),
		text(`${jobDir}/tool-calls`),
		text(`${jobDir}/last-tool`),
		text(`${jobDir}/activity`),
		optionalStat(`${jobDir}/task.md`),
		optionalStat(`${jobDir}/log`),
		readLog(`${jobDir}/log`),
	]);
	if (!taskStat || !logStat) return `INVALID ${id} · missing task.md or log`;
	try {
		const startedAt = recordedDate(started, taskStat.mtime, "started-at");
		const job = parseJob({
			id,
			state,
			label: label || id,
			branch,
			...(pid ? { pid } : {}),
			startedAt,
			lastOutputAt: logStat.mtime,
			detail: log.detail,
		});
		const observedAt = job.phase === "running" ? Date.now() : recordedDate(finished, new Date(), "finished-at").getTime();
		const processAlive = job.phase === "running" && job.pid !== undefined && processGroupAlive(job.pid);
		return renderJob(job, {
			elapsedMs: observedAt - startedAt.getTime(),
			silentMs: observedAt - logStat.mtimeMs,
			...(toolCalls ? { toolCalls: recordedCount(toolCalls) } : {}),
			...(lastTool ? { lastTool } : {}),
			...(job.phase === "running"
				? {
						pulse: derivePulse({
							alive: processAlive,
							...(job.pid !== undefined ? { pid: job.pid } : {}),
							...(activity ? { activity } : {}),
						}),
						...(job.pid !== undefined ? { processAlive } : {}),
					}
				: {}),
			diffstat: liveDiffstat(root, branch),
			logTail: log.tail,
		});
	} catch (error: unknown) {
		return `INVALID ${id} · ${error instanceof Error ? error.message : String(error)}${log.tail ? `\n  log:\n${log.tail}` : ""}`;
	}
}
function text(path: string): Promise<string> {
	return readFile(path, "utf8").then(
		(value) => value.trim(),
		() => "",
	);
}
function optionalStat(path: string) {
	return stat(path).then(
		(value) => value,
		() => undefined,
	);
}
function recordedDate(value: string, fallback: Date, name: string): Date {
	if (!value) return fallback;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) throw new Error(`invalid ${name} ${JSON.stringify(value)}`);
	return date;
}
function recordedCount(value: string): number {
	const count = Number(value);
	if (!Number.isSafeInteger(count) || count < 0) throw new Error(`invalid tool-calls ${JSON.stringify(value)}`);
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
			return {
				tail,
				detail: lines.findLast((line) => line.startsWith("[limen ") || line.startsWith("[control ")) ?? "",
			};
		} finally {
			await handle.close();
		}
	} catch {
		return { tail: "", detail: "" };
	}
}
