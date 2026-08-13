import { readdir, readFile, stat } from "node:fs/promises";
import { liveDiffstat, repoRoot } from "../git.ts";
import { parseJob, renderJob } from "../job.ts";
import { processGroupAlive } from "../proc.ts";

export async function jobsCommand(_args: readonly string[], cwd: string): Promise<void> {
	const root = repoRoot(cwd);
	const jobsRoot = `${root}/.control/jobs`;
	const entries = await readdir(jobsRoot, { withFileTypes: true }).catch((error: unknown) => {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return [];
		throw error;
	});
	const ids = entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort()
		.reverse();
	if (ids.length === 0) {
		console.log("no jobs");
		return;
	}
	const rendered: string[] = [];
	for (const id of ids) rendered.push(await renderJobDirectory(root, jobsRoot, id));
	console.log(rendered.join("\n\n"));
}

async function renderJobDirectory(root: string, jobsRoot: string, id: string): Promise<string> {
	const jobDir = `${jobsRoot}/${id}`;
	const [state, label, branch, pid, log, started, finished, toolCalls, taskStat, logStat] = await Promise.all([
		text(`${jobDir}/state`),
		text(`${jobDir}/label`),
		text(`${jobDir}/branch`),
		text(`${jobDir}/pid`),
		text(`${jobDir}/log`),
		text(`${jobDir}/started-at`),
		text(`${jobDir}/finished-at`),
		text(`${jobDir}/tool-calls`),
		optionalStat(`${jobDir}/task.md`),
		optionalStat(`${jobDir}/log`),
	]);
	if (!taskStat || !logStat) return `INVALID ${id} · missing task.md or log`;
	const detail = [...log.split("\n")].reverse().find((line) => line.startsWith("[control ")) ?? "";
	const tail = tailText(log, 20, 4_096);
	return Promise.resolve()
		.then(() => {
			const startedAt = recordedDate(started, taskStat.mtime, "started-at");
			const job = parseJob({
				id,
				state,
				label: label || id,
				branch,
				...(pid ? { pid } : {}),
				startedAt,
				lastOutputAt: logStat.mtime,
				detail,
			});
			const observedAt =
				job.phase === "running" ? Date.now() : recordedDate(finished, new Date(), "finished-at").getTime();
			return renderJob(job, {
				elapsedMs: observedAt - startedAt.getTime(),
				silentMs: observedAt - logStat.mtimeMs,
				...(toolCalls ? { toolCalls: recordedCount(toolCalls) } : {}),
				...(job.phase === "running" ? { processAlive: processGroupAlive(job.pid) } : {}),
				diffstat: liveDiffstat(root, branch),
				logTail: tail,
			});
		})
		.then(
			(value) => value,
			(error: unknown) =>
				`INVALID ${id} · ${error instanceof Error ? error.message : String(error)}${tail ? `\n  log:\n${tail}` : ""}`,
		);
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

function tailText(value: string, maxLines: number, maxBytes: number): string {
	const lines = value.trimEnd().split("\n").slice(-maxLines).join("\n");
	const bytes = Buffer.from(lines);
	return bytes.byteLength <= maxBytes
		? lines
		: bytes
				.subarray(bytes.byteLength - maxBytes)
				.toString("utf8")
				.replace(/^[^\n]*\n?/, "…\n");
}
