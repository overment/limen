import { randomBytes } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

type JobIdentity = { readonly id: string; readonly label: string; readonly branch: string };
export type Job = JobIdentity &
	(
		| { readonly phase: "running"; readonly pid?: number; readonly startedAt: Date; readonly lastOutputAt: Date }
		| { readonly phase: "done" }
		| { readonly phase: "failed"; readonly error: string }
		| { readonly phase: "stopped"; readonly reason: string }
	);
export type JobInput = {
	readonly id: string;
	readonly state: string;
	readonly label: string;
	readonly branch: string;
	readonly pid?: string;
	readonly startedAt: Date;
	readonly lastOutputAt: Date;
	readonly detail: string;
};
export type TerminalState = "done" | "failed" | "stopped";
export const TERMINAL_STATES: readonly TerminalState[] = ["done", "failed", "stopped"];
export const isTerminal = (state: string): state is TerminalState =>
	(TERMINAL_STATES as readonly string[]).includes(state);
/** A session ID that is safe as one path segment, for example under `notify/delivered/`. */
export const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export type Pulse = "starting" | "think" | "tool" | "wait" | "dead";
export type JobView = {
	readonly elapsedMs: number;
	readonly silentMs: number;
	readonly toolCalls?: number;
	readonly producedNothing?: boolean;
	readonly lastTool?: string;
	readonly pulse?: Pulse;
	readonly processAlive?: boolean;
	readonly diffstat: string;
	readonly logTail: string;
};
const PHASE_LABELS = {
	running: "RUNNING",
	done: "DONE",
	failed: "FAILED",
	stopped: "STOPPED",
} as const satisfies Record<Job["phase"], string>;
export function parseJob(input: JobInput): Job {
	if (!input.id || !input.label || !input.branch) {
		throw new Error("job id, label, and branch must not be empty");
	}
	const identity = { id: input.id, label: input.label, branch: input.branch };
	switch (input.state) {
		case "running": {
			const pid = Number(input.pid);
			const recorded = Number.isSafeInteger(pid) && pid > 0 ? { pid } : {};
			return {
				...identity,
				phase: "running",
				...recorded,
				startedAt: input.startedAt,
				lastOutputAt: input.lastOutputAt,
			};
		}
		case "done":
			return { ...identity, phase: "done" };
		case "failed":
			return { ...identity, phase: "failed", error: input.detail || "see log" };
		case "stopped":
			return { ...identity, phase: "stopped", reason: input.detail || "see log" };
		default:
			throw new Error(`job ${input.id} has unknown state ${JSON.stringify(input.state)}`);
	}
}
export function derivePulse(input: {
	readonly pid?: number;
	readonly alive: boolean;
	readonly activity?: string;
}): Pulse {
	if (input.pid === undefined) {
		return "starting";
	}
	if (!input.alive) {
		return "dead";
	}
	if (input.activity === "tool" || input.activity === "wait") {
		return input.activity;
	}
	return "think";
}
export function resolveJobId(
	query: string,
	ids: readonly string[],
	labels: Readonly<Record<string, string>> = {},
): string {
	const needle = query.trim();
	if (!needle) {
		throw new Error("job id required");
	}
	if (ids.includes(needle)) {
		return needle;
	}
	const matches = ids.filter((id) => {
		const label = labels[id] ?? "";
		return (
			label === needle ||
			(needle.length >= 3 &&
				(id.endsWith(needle) || id.endsWith(`-${needle}`) || label.toLowerCase().startsWith(needle.toLowerCase())))
		);
	});
	if (matches.length === 1) {
		return matches[0] ?? needle;
	}
	if (matches.length === 0) {
		throw new Error(`no job matches ${JSON.stringify(needle)}`);
	}
	throw new Error(`ambiguous job ${JSON.stringify(needle)}: ${matches.join(", ")}`);
}
export function makeJobId(label: string): string {
	const feature = /\bf\d{3,}\b/i.exec(label)?.[0] ?? "";
	const words = `${feature} ${label.replace(/\bf\d{3,}\b/gi, " ")}`.toLowerCase();
	const slug =
		words
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 32)
			.replace(/-$/, "") || "job";
	return `${new Date().toISOString().slice(0, 10)}-${slug}-${randomBytes(4).toString("hex")}`;
}
export function hostedAgentName(jobId: string): string {
	const hex = /[0-9a-f]{8}$/.exec(jobId)?.[0] ?? "";
	const feature = /(?:^|-)(f\d{3,})(?:-|$)/i.exec(jobId)?.[1]?.toLowerCase();
	if (feature && hex) {
		return `limen-${feature}-${hex}`;
	}
	const cut = jobId.slice(0, hex ? -9 : undefined).toLowerCase();
	const dashed = cut.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/[^a-z0-9_-]+/g, "-");
	const slug = dashed.replace(/^[^a-z]+/, "").slice(0, 17) || "job";
	return hex ? `limen-${slug}-${hex}` : `limen-${slug}`.slice(0, 32);
}
export function parseDuration(value: string): number {
	const match = /^(\d+)(ms|s|m|h)$/.exec(value);
	if (!match) {
		throw new Error(`invalid timeout ${JSON.stringify(value)}; use 500ms, 90s, 20m, or 2h`);
	}
	const amount = Number(match[1]);
	const unit = match[2] as "ms" | "s" | "m" | "h";
	const multipliers = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 } as const;
	const milliseconds = amount * multipliers[unit];
	if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(milliseconds)) {
		throw new Error("timeout must be a positive safe integer");
	}
	if (milliseconds > 2_147_483_647) {
		throw new Error("timeout exceeds Node's maximum timer duration");
	}
	return milliseconds;
}
export function producedNothing(toolCalls: number | undefined, commits: string | undefined): boolean {
	return toolCalls === 0 && commits === "";
}
/** Features whose folder is in spec/features/done/ or dropped/. */
export function closedFeatures(root: string): ReadonlySet<string> {
	const closed = new Set<string>();
	for (const lane of ["done", "dropped"]) {
		const laneDir = join(root, "spec", "features", lane);
		if (!existsSync(laneDir)) {
			continue;
		}
		for (const month of readdirSync(laneDir, { withFileTypes: true })) {
			if (!month.isDirectory()) {
				continue;
			}
			for (const entry of readdirSync(join(laneDir, month.name), { withFileTypes: true })) {
				const feature = /^(F\d+)-/i.exec(entry.name)?.[1];
				if (entry.isDirectory() && feature) {
					closed.add(feature.toUpperCase());
				}
			}
		}
	}
	return closed;
}
/**
 * The features a job names in its label or ID when every one is closed; none while any is open.
 * A label can name two features (`F100 follow-up for F099`); the job belongs to both, so closing one leaves it in place.
 */
export function closedJobFeatures(label: string, id: string, closed: ReadonlySet<string>): readonly string[] {
	const named = [...new Set(`${label}\n${id}`.match(/\bF\d+\b/gi)?.map((feature) => feature.toUpperCase()))];
	return named.every((feature) => closed.has(feature)) ? named : [];
}
export function renderJob(job: Job, view: JobView): string {
	const facts = [
		`${PHASE_LABELS[job.phase]} ${job.label}`,
		`id ${job.id}`,
		`branch ${job.branch}`,
		`elapsed ${formatDuration(view.elapsedMs)}`,
		`silent ${formatDuration(view.silentMs)}`,
	];
	if (view.pulse) {
		facts.push(view.pulse);
	}
	if (view.toolCalls !== undefined) {
		facts.push(`tools ${view.toolCalls}`);
	}
	if (view.producedNothing) {
		facts.push("produced nothing (0 tool calls, no commits)");
	}
	if (view.lastTool) {
		facts.push(view.lastTool);
	}
	if (job.phase === "running" && job.pid !== undefined) {
		facts.push(`pid ${job.pid}${view.processAlive === false ? " (not alive)" : ""}`);
	}
	const blocks = [facts.join(" · ")];
	const detail = terminalDetail(job);
	if (detail) {
		blocks.push(`  ${detail}`);
	}
	if (view.diffstat) {
		blocks.push(indent(`diff:\n${view.diffstat}`));
	}
	if (view.logTail) {
		blocks.push(indent(`log:\n${view.logTail}`));
	}
	return blocks.join("\n");
}
function terminalDetail(job: Job): string {
	if (job.phase === "failed") {
		return job.error;
	}
	if (job.phase === "stopped") {
		return job.reason;
	}
	return "";
}
export function formatDuration(milliseconds: number): string {
	const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
	if (seconds < 60) {
		return `${seconds}s`;
	}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `${minutes}m`;
	}
	return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
}
function indent(value: string): string {
	return value
		.split("\n")
		.map((line) => `  ${line}`)
		.join("\n");
}
