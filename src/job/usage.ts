import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** What a job's own assistant turns recorded: the routes that answered and their token totals. */
export type SessionUsage = {
	readonly served: readonly string[];
	readonly turns: number;
	readonly input: number;
	readonly output: number;
	readonly cacheRead: number;
	readonly cacheWrite: number;
};

const COUNTED = ["input", "output", "cacheRead", "cacheWrite"] as const;

/**
 * Sums the assistant messages in the job's session transcripts written at or after `since`, so a continuation does
 * not count the parent turns it copied. Undefined until the job has an assistant turn.
 */
export function readSessionUsage(jobDir: string, since: number): SessionUsage | undefined {
	const session = join(jobDir, "session");
	let files: string[];
	try {
		files = readdirSync(session).filter((name) => name.endsWith(".jsonl"));
	} catch {
		return undefined;
	}
	const served = new Set<string>();
	const totals = { turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	for (const file of files) {
		for (const line of readFileSync(join(session, file), "utf8").split("\n")) {
			const turn = assistantTurn(line, since);
			if (!turn) {
				continue;
			}
			totals.turns += 1;
			served.add(turn.provider ? `${turn.provider}/${turn.model}` : turn.model);
			for (const key of COUNTED) {
				totals[key] += turn.usage[key];
			}
		}
	}
	return totals.turns ? { served: [...served], ...totals } : undefined;
}

/**
 * The served route, with the requested model beside it when a turn ran another one. A bare requested id matches any
 * provider prefix. This informs; it never blocks.
 */
export function modelLine(requested: string, usage: SessionUsage | undefined): string {
	if (!usage) {
		return requested ? `requested ${requested}; no turn yet` : "";
	}
	const served = usage.served.join(" + ");
	if (!requested || usage.served.every((route) => route === requested || route.endsWith(`/${requested}`))) {
		return served;
	}
	return `served ${served} · requested ${requested}`;
}

export function tokenLine(usage: SessionUsage): string {
	const count = (value: number) => value.toLocaleString("en-US");
	return [
		`${usage.turns} turns`,
		`input ${count(usage.input)}`,
		`output ${count(usage.output)}`,
		`cache read ${count(usage.cacheRead)}`,
		`cache write ${count(usage.cacheWrite)}`,
	].join(" · ");
}

type Turn = { provider: string; model: string; usage: Record<(typeof COUNTED)[number], number> };

function assistantTurn(line: string, since: number): Turn | undefined {
	if (!line.includes('"assistant"')) {
		return undefined;
	}
	let entry: unknown;
	try {
		entry = JSON.parse(line);
	} catch {
		return undefined;
	}
	const { type, timestamp, message } = (entry ?? {}) as { type?: unknown; timestamp?: unknown; message?: unknown };
	const { role, provider, model, usage } = (message ?? {}) as Record<string, unknown>;
	if (type !== "message" || role !== "assistant" || typeof model !== "string") {
		return undefined;
	}
	if (typeof timestamp === "string" && Date.parse(timestamp) < since) {
		return undefined;
	}
	const counts = (usage ?? {}) as Record<string, unknown>;
	const number = (key: string) => (typeof counts[key] === "number" ? (counts[key] as number) : 0);
	return {
		provider: typeof provider === "string" ? provider : "",
		model,
		usage: {
			input: number("input"),
			output: number("output"),
			cacheRead: number("cacheRead"),
			cacheWrite: number("cacheWrite"),
		},
	};
}
