import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ticketPointers } from "../project/planning.ts";
import { producedNothing } from "./job.ts";
import { openChecks } from "./task-note.ts";
import { claimSlots, deliveryExists } from "./wake-delivery.ts";

function text(path: string): string {
	try {
		return readFileSync(path, "utf8").trim();
	} catch {
		return "";
	}
}
/**
 * How the job ended: stop reason, bounded commits, the whole final message, and undelivered steers. The coordinator
 * decides the next step from this, so the final message is never cut. A part whose file is absent is omitted; that
 * absence is information.
 */
export function jobEnding(job: string): string {
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
		sections.push(`Final message:\n${result}`);
	}
	try {
		const unseen = readdirSync(join(job, "steer", "inbox")).length;
		if (unseen) {
			sections.push(`${unseen} steer(s) never delivered`);
		}
	} catch {
		// Inbox may be absent; that is not an undelivered steer.
	}
	return sections.join("\n\n");
}
/**
 * How a completion wake travels. `fallback`: a busy coordinator's wake reaches another session. `instruction`: a route's
 * own landing words (the Herdr prompt to an OMP coordinator). `session`: the Pi session that receives the wake.
 */
type CompletionRoute = { readonly fallback?: boolean; readonly instruction?: string; readonly session?: string };
export function completionWake(
	job: string,
	label: string,
	state: string,
	id: string,
	branch: string,
	repo: string,
	route: CompletionRoute = {},
): string {
	const { fallback = false, instruction: routeInstruction } = route;
	const location = repo ? ` in repository ${repo}` : "";
	const machine = hostPhrase(job);
	const task = firstSentence(text(join(job, "task.md")));
	// A done job whose final "Note check" left items open is not a plain done; the lead says so and lists them.
	const open = state === "done" ? openChecks(job) : [];
	const shown = open.length ? "done with open checks" : state;
	const said = task
		? `Limen job ${JSON.stringify(label)}: ${task}\nis ${shown} (${id}) on branch ${branch}${location}${machine}.`
		: `Limen job ${JSON.stringify(label)} is ${shown} (${id}) on branch ${branch}${location}${machine}.`;
	const waited = missedStartNotice(job, route.session);
	// A start notice the session never got is its own paragraph after the lead, word for word.
	const lead = [said, waited, open.length ? `Open checks:\n${open.join("\n")}` : ""].filter(Boolean).join("\n\n");
	const empty = jobProducedNothing(job);
	const scout = state === "done" && !empty && text(join(job, "role")) === "scout";
	const facts = empty ? "It produced nothing (0 tool calls, no commits)." : "";
	let handoff = "The job failed or stopped; inspect the failure before deciding whether to resume work.";
	if (state === "done") {
		handoff = scout
			? "Scout done. Nothing to land: the final message is its evidence packet, leads and not facts."
			: "Job done. Next step: land it, or name the check that still blocks landing. Done does not mean that review passed.";
	}
	if (open.length && !scout) {
		handoff =
			"The worker left the checks above open. Decide for each before you land: continue the job, start a review, " +
			"or accept it and tell the user why.";
	}
	let instruction =
		"Inspect the job record, failure and log/session. A repair handoff states the observed failure with its evidence and names a cause only when you verified it. Resume focused fixes and re-review if appropriate; do not treat this failure as a new-spawn or release signal. Keep the user informed; ask only when genuine product ambiguity, a scope or risk tradeoff, or an irreversible action needs a human decision.";
	if (state === "done") {
		const land = open.length
			? "Then decide each open check, and land the work at the verified commit only after that."
			: "Then land the work at the verified commit.";
		// A route's own wording (the Herdr prompt to an OMP coordinator) replaces only the landing instruction.
		instruction =
			routeInstruction ??
			`Inspect the job record, branch diff and commits, log/session, and relevant checks. ${land} If a check blocks landing, name that check and resume a focused fix. ${keeperHint(job, id)} After it lands, continue with the next item on the board. Keep the user informed; ask only when genuine product ambiguity, a scope or risk tradeoff, or an irreversible action needs a human decision.`;
	}
	if (scout) {
		instruction =
			"Read the packet's top finding once at its path before you act on it, and treat an unlabeled finding as guessed. Then decide and make the change yourself, or put the packet in a worker handoff under `Helper packet (leads, not facts):`. Keep the user informed; ask only when a genuine product decision needs them.";
	}
	if (empty) {
		instruction =
			"Inspect the job record and log/session to understand why, then resume focused work if the ticket remains open. Keep the user informed; ask only when genuine product ambiguity, a scope or risk tradeoff, or an irreversible action needs a human decision.";
	}
	if (fallback) {
		instruction =
			"The subscribed coordinator is busy. Do not spawn, stop, steer, or land on behalf of another coordinator unless the human asks.";
	}
	return joinWake(lead, jobEnding(job), [facts, handoff].filter(Boolean).join("\n\n"), instruction);
}
/**
 * The first line of the job's start notice, when the job waited in the start queue and `session` never got that
 * notice: the job ended before the Pi hook delivered it. A start notice is news only while the job runs, so the
 * completion wake carries this line instead. A notice in flight (claimed) may have reached the session; it counts.
 */
function missedStartNotice(job: string, session: string | undefined): string {
	const slot = `_start.${session}`;
	if (!session || deliveryExists(job, slot) || claimSlots(job).includes(slot)) {
		return "";
	}
	return text(join(job, "start-notice")).split("\n", 1)[0] ?? "";
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
	const machine = hostPhrase(job);
	const task = firstSentence(text(join(job, "task.md")));
	const lead = task
		? `Limen job ${JSON.stringify(label)}: ${task}\nis still running (${id}) on branch ${branch}${location}${machine}: ${advisory}.`
		: `Limen job ${JSON.stringify(label)} is still running (${id}) on branch ${branch}${location}${machine}: ${advisory}.`;
	const instruction = fallback
		? "The subscribed coordinator is busy. Do not spawn, stop, or steer on this wake unless the human asks."
		: "Inspect the job record and continue the loop; steer; or open the tab and exit if you mean the session to end.";
	return joinWake(lead, jobEnding(job), "", instruction);
}
function hostPhrase(job: string): string {
	const host = text(join(job, "host"));
	return host ? ` on host ${host}` : "";
}
function joinWake(lead: string, ending: string, facts: string, instruction: string): string {
	const parts = [lead];
	if (ending) {
		parts.push(ending);
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
