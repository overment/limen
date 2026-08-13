type JobIdentity = { readonly id: string; readonly label: string; readonly branch: string };
export type Job = JobIdentity &
	(
		| {
				readonly phase: "running";
				readonly pid: number;
				readonly startedAt: Date;
				readonly lastOutputAt: Date;
		  }
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

export type JobView = {
	readonly elapsedMs: number;
	readonly silentMs: number;
	readonly toolCalls?: number;
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
	if (!input.id || !input.label || !input.branch) throw new Error("job id, label, and branch must not be empty");
	const identity = { id: input.id, label: input.label, branch: input.branch };
	switch (input.state) {
		case "running": {
			const pid = Number(input.pid);
			if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`running job ${input.id} has no valid pid`);
			return {
				...identity,
				phase: "running",
				pid,
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

export function parseDuration(value: string): number {
	const match = /^(\d+)(ms|s|m|h)$/.exec(value);
	if (!match) throw new Error(`invalid timeout ${JSON.stringify(value)}; use 500ms, 90s, 20m, or 2h`);
	const amount = Number(match[1]);
	const unit = match[2] as "ms" | "s" | "m" | "h";
	const multipliers = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 } as const;
	const milliseconds = amount * multipliers[unit];
	if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(milliseconds)) {
		throw new Error("timeout must be a positive safe integer");
	}
	if (milliseconds > 2_147_483_647) throw new Error("timeout exceeds Node's maximum timer duration");
	return milliseconds;
}

export function renderJob(job: Job, view: JobView): string {
	const facts = [
		`${PHASE_LABELS[job.phase]} ${job.label}`,
		`id ${job.id}`,
		`branch ${job.branch}`,
		`elapsed ${formatDuration(view.elapsedMs)}`,
		`silent ${formatDuration(view.silentMs)}`,
	];
	if (view.toolCalls !== undefined) facts.push(`tools ${view.toolCalls}`);
	if (job.phase === "running") facts.push(`pid ${job.pid}${view.processAlive === false ? " (not alive)" : ""}`);
	const blocks = [facts.join(" · ")];
	const detail = terminalDetail(job);
	if (detail) blocks.push(`  ${detail}`);
	if (view.diffstat) blocks.push(indent(`diff:\n${view.diffstat}`));
	if (view.logTail) blocks.push(indent(`log:\n${view.logTail}`));
	return blocks.join("\n");
}

function terminalDetail(job: Job): string {
	switch (job.phase) {
		case "running":
		case "done":
			return "";
		case "failed":
			return job.error;
		case "stopped":
			return job.reason;
		default: {
			const exhaustive: never = job;
			return exhaustive;
		}
	}
}

function formatDuration(milliseconds: number): string {
	const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
}

function indent(value: string): string {
	return value
		.split("\n")
		.map((line) => `  ${line}`)
		.join("\n");
}
