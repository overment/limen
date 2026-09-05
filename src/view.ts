import { formatDuration, type Job, type Pulse } from "./job.ts";

export type JobRecord = {
	readonly id: string;
	readonly invalid?: string;
	readonly job?: Job;
	readonly pulse?: Pulse;
	readonly toolCalls?: number;
	readonly changedFiles?: number;
	readonly producedNothing?: boolean;
	readonly lastTool?: string;
	readonly reason?: string;
	readonly elapsedMs?: number;
	readonly silentMs?: number;
	readonly ageMs?: number;
	readonly commitCount?: number;
	readonly repo?: string;
	readonly parent?: string;
	readonly candidate?: string;
	readonly hosted?: boolean;
	readonly advisory?: string;
	readonly stopReason?: string;
	readonly versions?: string;
	readonly commits?: string;
	readonly result?: string;
	readonly cleanup?: string;
	readonly diffstat?: string;
	readonly logTail?: string;
};
export type StateTally = { readonly total: number; readonly running: number; readonly done: number; readonly failed: number; readonly stopped: number; readonly invalid: number };
export type Paint = (style: "dim" | "bold" | "red" | "green" | "yellow", text: string) => string;

export function resolveView(forced: string | undefined, tty: boolean): "human" | "compact" {
	if (forced === "human" || forced === "compact") return forced;
	return tty ? "human" : "compact";
}
export function colorWanted(tty: boolean, noColor: string | undefined, term: string | undefined): boolean {
	return tty && !noColor && term !== "dumb";
}
export function paintWhen(color: boolean): Paint {
	const codes = { dim: "2", bold: "1", red: "31", green: "32", yellow: "33" } as const;
	return color ? (style, text) => `\u001b[${codes[style]}m${text}\u001b[0m` : (_style, text) => text;
}
export function jobSuffix(id: string): string {
	return clip(id.slice(id.lastIndexOf("-") + 1) || id, 12);
}
export function formatAge(milliseconds: number): string {
	const minutes = Math.floor(Math.max(0, milliseconds) / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 48) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}
export function tallyStates(states: readonly string[]): StateTally {
	const tally = { total: states.length, running: 0, done: 0, failed: 0, stopped: 0, invalid: 0 };
	for (const state of states) {
		if (state === "running" || state === "done" || state === "failed" || state === "stopped") tally[state] += 1;
		else tally.invalid += 1;
	}
	return tally;
}
export function humanSnapshot(records: readonly JobRecord[], tally: StateTally, hint: boolean, paint: Paint): string {
	const width = Math.min(32, Math.max(12, ...records.map((record) => [...(record.job?.label ?? record.id)].length)));
	return [...records.map((record) => humanRow(record, width, paint)), cabinetLine(tally, hint, paint)].join("\n");
}
export function humanRow(record: JobRecord, labelWidth: number, paint: Paint): string {
	const job = record.job;
	if (record.invalid || !job) return `${paint("red", "!")} ${clip(record.id, labelWidth).padEnd(labelWidth)}  ${paint("red", record.invalid ?? "unreadable")}`;
	const label = clip(job.label, labelWidth).padEnd(labelWidth);
	const facts =
		job.phase === "running"
			? [...runningFacts(record, paint), ...(record.advisory ? [paint("yellow", "advisory")] : []), ...flags(record).map((flag) => paint("dim", flag))]
			: terminalFacts(record, paint);
	return `${glyph(record, paint)} ${job.phase === "running" ? paint("bold", label) : label}  ${paint("dim", jobSuffix(record.id).padEnd(12))}  ${facts.join(paint("dim", " · "))}`;
}
export function humanDetail(record: JobRecord, paint: Paint): string {
	const job = record.job;
	if (record.invalid || !job) {
		const tail = record.logTail ? `\n${indented(record.logTail, paint)}` : "";
		return `${paint("red", "!")} ${record.id}  ${paint("red", record.invalid ?? "unreadable")}${tail}`;
	}
	const lines = [[`${glyph(record, paint)} ${paint("bold", job.label)}`, job.phase, ...flags(record)].join(paint("dim", " · "))];
	const put = (key: string, value: string | undefined) => {
		if (value) lines.push(...keyed(key, value, paint));
	};
	put("id", emphasizeSuffix(record.id, paint));
	put("branch", job.branch);
	put("repo", record.repo);
	put("parent", record.parent);
	put("candidate", record.candidate);
	if (job.phase === "running") {
		put("up", runningFacts(record, paint).join(" · "));
		if (job.pid !== undefined) put("pid", `${job.pid}`);
		put("advisory", record.advisory);
	} else {
		put("ran", terminalRanLine(record, paint));
		put("reason", record.reason);
	}
	put("versions", record.versions);
	put("commits", record.commits);
	put("stop-reason", record.stopReason);
	put("result", record.result);
	put("diff", record.diffstat);
	put("cleanup", record.cleanup);
	put("log", renderLogTail(record.logTail ?? "", paint));
	return lines.join("\n");
}
export function renderLogTail(tail: string, paint: Paint): string {
	const kept: string[] = [];
	for (const line of tail.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed === "…") continue;
		const event = /^\[limen ([^\]]+)\] (.*)$/.exec(trimmed);
		if (event) kept.push(`${paint("dim", clock(event[1] ?? ""))} ${event[2] ?? ""}`);
		else if (!/^[a-z][a-z0-9_-]{0,19}$/.test(trimmed)) kept.push(paint("dim", trimmed));
	}
	return kept.join("\n");
}
function glyph(record: JobRecord, paint: Paint): string {
	if (record.invalid || !record.job) return paint("red", "!");
	if (record.job.phase === "running") return paint(record.pulse === "dead" ? "red" : "green", "●");
	if (record.job.phase === "done") return paint("green", "✓");
	if (record.job.phase === "failed") return paint("red", "✗");
	return paint("yellow", "■");
}
function runningFacts(record: JobRecord, paint: Paint): string[] {
	const facts = [formatDuration(record.elapsedMs ?? 0)];
	const pulse = record.pulse ?? "think";
	if (pulse === "dead") facts.push(paint("red", "dead"));
	else if (pulse === "starting") facts.push(paint("dim", "starting"));
	else facts.push(pulse === "tool" && record.lastTool ? clip(record.lastTool, 24) : pulse);
	if (record.toolCalls !== undefined) facts.push(`${record.toolCalls} tools`);
	if (record.changedFiles !== undefined) facts.push(`${record.changedFiles} files`);
	const silent = record.silentMs ?? 0;
	if (silent >= 300_000) facts.push(paint("red", `silent ${formatDuration(silent)}`));
	else if (silent >= 90_000) facts.push(paint("yellow", `silent ${formatDuration(silent)}`));
	return facts;
}
function terminalFacts(record: JobRecord, paint: Paint): string[] {
	const facts = record.ageMs === undefined ? [] : [paint("dim", formatAge(record.ageMs))];
	facts.push(formatDuration(record.elapsedMs ?? 0), ...workFacts(record, paint));
	if (record.reason) facts.push(clip(record.reason, 48));
	return [...facts, ...flags(record).map((flag) => paint("dim", flag))];
}
function terminalRanLine(record: JobRecord, paint: Paint): string {
	const facts = [formatDuration(record.elapsedMs ?? 0), ...workFacts(record, paint)];
	if (record.ageMs !== undefined) facts.push(`finished ${formatAge(record.ageMs)}`);
	return facts.join(" · ");
}
function workFacts(record: JobRecord, paint: Paint): string[] {
	if (record.producedNothing) return [paint("red", "nothing")];
	const facts = record.toolCalls === undefined ? [] : [`${record.toolCalls} ${record.toolCalls === 1 ? "tool" : "tools"}`];
	if (record.commitCount) facts.push(`${record.commitCount} ${record.commitCount === 1 ? "commit" : "commits"}`);
	return facts;
}
function flags(record: JobRecord): string[] {
	const out: string[] = [];
	if (record.candidate) out.push("review");
	if (record.parent) out.push("continue");
	if (record.hosted) out.push("hosted");
	if (record.repo) out.push(`repo ${record.repo}`);
	return out;
}
function cabinetLine(tally: StateTally, hint: boolean, paint: Paint): string {
	const parts = [paint("dim", `${tally.total} ${tally.total === 1 ? "job" : "jobs"}`)];
	for (const phase of ["running", "done", "failed", "stopped"] as const) if (tally[phase]) parts.push(paint("dim", `${tally[phase]} ${phase}`));
	if (tally.invalid) parts.push(paint("red", `${tally.invalid} invalid`));
	if (hint) parts.push(paint("dim", "limen jobs --all"));
	return parts.join(paint("dim", " · "));
}
function keyed(key: string, value: string, paint: Paint): string[] {
	const [first = "", ...rest] = value.split("\n");
	return [`  ${paint("dim", key.padEnd(11))} ${first}`, ...rest.map((line) => `  ${" ".repeat(11)} ${line}`)];
}
function emphasizeSuffix(id: string, paint: Paint): string {
	const cut = id.lastIndexOf("-") + 1;
	return cut > 0 && cut < id.length ? `${paint("dim", id.slice(0, cut))}${id.slice(cut)}` : id;
}
function indented(block: string, paint: Paint): string {
	return block
		.split("\n")
		.map((line) => `  ${paint("dim", line)}`)
		.join("\n");
}
function clock(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	const pad = (part: number) => `${part}`.padStart(2, "0");
	return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function clip(text: string, max: number): string {
	const points = [...text];
	return points.length > max ? `${points.slice(0, max - 1).join("")}…` : text;
}
