import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ticketPointers } from "../project/planning.ts";
import { producedNothing } from "./job.ts";

function text(path: string): string {
	try {
		return readFileSync(path, "utf8").trim();
	} catch {
		return "";
	}
}
/** Bounded commits and final-message excerpts; either is omitted when its file is absent — that absence is information. */
function handoffExcerpt(job: string): string {
	const sections: string[] = [];
	const stop = text(join(job, "stop-reason"));
	if (stop) {
		sections.push(`Stop reason: ${stop}`);
	}
	const commits = existsSync(join(job, "commits")) ? text(join(job, "commits")) : undefined;
	if (commits !== undefined) {
		const lines = commits.split("\n").filter(Boolean);
		sections.push(
			lines.length
				? `Commits:\n${lines.slice(0, 10).join("\n")}${lines.length > 10 ? `\n… ${lines.length - 10} more` : ""}`
				: "Commits: none",
		);
	}
	const result = text(join(job, "result"));
	if (result) {
		const head = result.split("\n").slice(0, 15).join("\n").slice(0, 1200);
		sections.push(`Final message:\n${head}${head.length < result.length ? "\n… (full text in the job record)" : ""}`);
	}
	try {
		const unseen = readdirSync(join(job, "steer", "inbox")).length;
		if (unseen) {
			sections.push(`${unseen} steer(s) never delivered`);
		}
	} catch {
		// Inbox may be absent; that is not an undelivered steer.
	}
	return sections.length ? `\n\n${sections.join("\n\n")}` : "";
}
export function completionWake(
	job: string,
	label: string,
	state: string,
	id: string,
	branch: string,
	repo: string,
	fallback: boolean,
	routeInstruction?: string,
): string {
	const location = repo ? ` in repository ${repo}` : "";
	const task = firstSentence(text(join(job, "task.md")));
	const lead = task
		? `Limen job ${JSON.stringify(label)}: ${task}\nis ${state} (${id}) on branch ${branch}${location}.`
		: `Limen job ${JSON.stringify(label)} is ${state} (${id}) on branch ${branch}${location}.`;
	const empty = jobProducedNothing(job);
	const facts = empty ? "It produced nothing (0 tool calls, no commits)." : "";
	const handoff =
		state === "done"
			? "Job done. Next step: land it, or name the check that still blocks landing. Done does not mean that review passed."
			: "The job failed or stopped; inspect the failure before deciding whether to resume work.";
	let instruction =
		"Inspect the job record, failure and log/session. Resume focused fixes and re-review if appropriate; do not treat this failure as a new-spawn or release signal. Keep the user informed; ask only when genuine product ambiguity, a scope or risk tradeoff, or an irreversible action needs a human decision.";
	if (state === "done") {
		instruction = `Inspect the job record, branch diff and commits, log/session, and relevant checks. Then land the work at the verified commit. If a check blocks landing, name that check and resume a focused fix. ${keeperHint(job, id)} After it lands, continue with the next item on the board. Keep the user informed; ask only when genuine product ambiguity, a scope or risk tradeoff, or an irreversible action needs a human decision.`;
	}
	if (empty) {
		instruction =
			"Inspect the job record and log/session to understand why, then resume focused work if the ticket remains open. Keep the user informed; ask only when genuine product ambiguity, a scope or risk tradeoff, or an irreversible action needs a human decision.";
	}
	if (fallback) {
		instruction =
			"The subscribed coordinator is busy. Do not spawn, stop, steer, or land on behalf of another coordinator unless the human asks.";
	}
	return joinWake(
		lead,
		handoffExcerpt(job),
		[facts, handoff].filter(Boolean).join("\n\n"),
		routeInstruction ?? instruction,
	);
}
/** The done-wake sentence that sends spec work to the keeper; the ticket comes from the job task's first `Ticket:` pointer (keeper follows a moved one). */
export function keeperHint(job: string, id: string): string {
	// A keeper always changes a ticket; sending it to another keeper would loop.
	if (text(join(job, "role")) === "keeper") {
		return "This is the spec keeper: land it, since it carries the work and the spec fixes. If it made no commit, land the original job.";
	}
	const ticket = ticketPointers(text(join(job, "task.md")))[0]?.path ?? "<ticket>";
	return `If it added, moved or changed a ticket, start limen keeper ${ticket} --job ${id} --engine <engine> --provider <provider> --model <model> --thinking <level> and land the keeper job instead.`;
}
export type LeadFallback = {
	readonly group: string;
	readonly feature: string;
	readonly lead: string;
	readonly team: string;
	readonly finished: number;
	readonly total: number;
};
/** A team coordinator's finish for a lead whose group hook is not running: the group events that normally carry it cannot reach the pane. */
export function groupLeadWake(
	job: string,
	label: string,
	state: string,
	id: string,
	branch: string,
	fallback: LeadFallback,
): string {
	// A member's task opens with the shared group contract, not its own aim; the team and the group name it instead.
	const lead = `Limen job ${JSON.stringify(label)} is ${state} (${id}) on branch ${branch}. It is the ${fallback.team} coordinator of group ${fallback.group} for ${fallback.feature}.`;
	const facts = `${fallback.finished} of ${fallback.total} team coordinators are finished. This wake comes through Herdr because the lead group hook (hook/group-peer.ts) is not running for lead session ${fallback.lead}, so group events do not reach this pane.`;
	const instruction = `Run \`limen group status ${fallback.group}\` and read this team's result. When every team is finished, write the synthesis. To receive group events again, reload this pane with the Limen package hooks, including hook/group-peer.ts, and resume lead session ${fallback.lead}. Do not write .limen/group-leads by hand. Keep the user informed; ask only when a genuine product decision needs them.`;
	return joinWake(lead, handoffExcerpt(job), facts, instruction);
}
export function advisoryWake(
	job: string,
	label: string,
	id: string,
	branch: string,
	repo: string,
	advisory: string,
	fallback: boolean,
): string {
	const location = repo ? ` in repository ${repo}` : "";
	const task = firstSentence(text(join(job, "task.md")));
	const lead = task
		? `Limen job ${JSON.stringify(label)}: ${task}\nis still running (${id}) on branch ${branch}${location}: ${advisory}.`
		: `Limen job ${JSON.stringify(label)} is still running (${id}) on branch ${branch}${location}: ${advisory}.`;
	const instruction = fallback
		? "The subscribed coordinator is busy. Do not spawn, stop, or steer on this wake unless the human asks."
		: "Inspect the job record and continue the loop; steer; or open the tab and exit if you mean the session to end.";
	return joinWake(lead, handoffExcerpt(job), "", instruction);
}
function joinWake(lead: string, excerpt: string, facts: string, instruction: string): string {
	const parts = [lead];
	if (excerpt) {
		parts.push(excerpt.trim());
	}
	if (facts) {
		parts.push(facts);
	}
	parts.push(instruction);
	return parts.join("\n\n");
}
function firstSentence(body: string): string {
	const paragraph = body.trim().split(/\n\n/, 1)[0]?.replaceAll("\n", " ").trim() ?? "";
	if (!paragraph) {
		return "";
	}
	const cut = paragraph.search(/[.!?](?:\s|$)/);
	const sentence = (cut === -1 ? paragraph : paragraph.slice(0, cut + 1)).trim();
	return sentence.length > 240 ? `${sentence.slice(0, 239)}…` : sentence;
}
function jobProducedNothing(job: string): boolean {
	const commits = existsSync(join(job, "commits")) ? text(join(job, "commits")) : undefined;
	return producedNothing(recordedToolCalls(job), commits);
}
function recordedToolCalls(job: string): number | undefined {
	const value = text(join(job, "tool-calls"));
	if (!value) {
		return undefined;
	}
	const count = Number(value);
	return Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}
