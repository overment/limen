import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { jobMembership, leadHookLive } from "../job/group-cabinet.ts";
import { isTerminal } from "../job/job.ts";
import { appendLimenLog, atomicWrite, textFile } from "../job/record.ts";
import { completionWake, groupLeadWake, keeperHint } from "../job/wake-text.ts";
import { herdrBinary } from "./herdr.ts";

const PROMPT_MS = 15_000;
const ATTEMPTS = 2;

/**
 * Start a turn on the Herdr pane that spawned this job. Only jobs whose coordinator had no Pi session record
 * `origin-pane`; Pi coordinators keep their in-process wake. A group member's finish travels as a group event instead,
 * except a team coordinator's finish while the lead's group hook is not running: then this wakes the lead pane.
 * Claimed once per job by `notify/herdr-prompt`, which keeps one line per attempt. Two unsuccessful attempts stop
 * automatic delivery; recovery is then deliberate. `notify/delivered/_herdr` is written only when Herdr observed the
 * pane working after submission.
 */
export async function promptCoordinator(jobDir: string, shutdownDeadline = Number.POSITIVE_INFINITY): Promise<void> {
	const pane = await textFile(`${jobDir}/origin-pane`);
	const message = await wakeMessage(jobDir, pane);
	const herdr = herdrBinary();
	if (!message || !pane || !herdr || shutdownDeadline - Date.now() < 1_000) {
		return;
	}
	await mkdir(`${jobDir}/notify`, { recursive: true });
	try {
		await writeFile(`${jobDir}/notify/herdr-prompt`, `attempting ${pane} ${new Date().toISOString()}\n`, {
			flag: "wx",
			flush: true,
		});
	} catch {
		return; // Another finalizer already owns this wake.
	}
	const lines: string[] = [];
	for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
		const budget = Math.min(PROMPT_MS, shutdownDeadline - Date.now());
		if (budget < 1_000) {
			lines.push("no shutdown budget for another attempt; inspect the job and wake the coordinator deliberately");
			break;
		}
		const wait = String(Math.max(budget - 2_000, 1_000));
		const outcome = await run(
			herdr,
			["agent", "prompt", pane, message, "--wait", "--until", "working", "--until", "blocked", "--timeout", wait],
			budget,
		);
		const result = outcome.ok
			? `turn observed on ${pane}`
			: /agent_prompt_stalled/.test(outcome.detail)
				? `submitted to ${pane}; no turn observed`
				: `failed on ${pane}: ${outcome.detail}`;
		lines.push(`attempt ${attempt}: ${result} ${new Date().toISOString()}`);
		await appendLimenLog(jobDir, `coordinator wake via Herdr: attempt ${attempt}: ${result}`);
		if (outcome.ok) {
			await mkdir(`${jobDir}/notify/delivered`, { recursive: true });
			await writeFile(`${jobDir}/notify/delivered/_herdr`, `${new Date().toISOString()}\n`, {
				flag: "wx",
				flush: true,
			}).catch(() => {});
			break;
		}
		if (attempt < ATTEMPTS) {
			await atomicWrite(`${jobDir}/notify/herdr-prompt`, `attempting ${pane}\n${lines.join("\n")}\n`);
		} else {
			lines.push(
				`automatic delivery stopped after ${ATTEMPTS} unsuccessful attempts; inspect the job and wake the coordinator deliberately`,
			);
		}
	}
	await atomicWrite(`${jobDir}/notify/herdr-prompt`, `${lines.join("\n")}\n`);
}

async function wakeMessage(jobDir: string, pane: string): Promise<string | undefined> {
	const [label = "", state = "", branch = "", repo = ""] = await Promise.all(
		["label", "state", "branch", "repo"].map((name) => textFile(`${jobDir}/${name}`)),
	);
	const id = jobDir.split("/").at(-1) ?? "";
	const membership = await jobMembership(jobDir);
	if (!membership) {
		const keeper = state === "done" ? ` ${keeperHint(jobDir, id)}` : "";
		const instruction = `Start with \`limen jobs ${id}\`. Inspect its diff, commits, final message, and checks before landing. If a check blocks landing, name that check and resume a focused fix.${keeper} Keep the user informed; ask only when a genuine product decision needs them.`;
		return completionWake(jobDir, label || id, state, id, branch, repo, false, instruction);
	}
	const { run, member } = membership;
	if (member?.role !== "coordinator") {
		return;
	}
	if (await leadHookLive(run.root, run.lead)) {
		await appendLimenLog(
			jobDir,
			`coordinator wake via Herdr: not sent; the lead group hook for session ${run.lead} is live and group events carry this finish`,
		);
		return;
	}
	await appendLimenLog(
		jobDir,
		pane
			? `lead group hook for session ${run.lead} is not running; waking the lead pane ${pane} through Herdr`
			: `lead group hook for session ${run.lead} is not running and no lead pane is recorded; the lead was not woken`,
	);
	const coordinators = run.members.filter((entry) => entry.role === "coordinator");
	const states = await Promise.all(coordinators.map((entry) => textFile(`${run.root}/.limen/jobs/${entry.id}/state`)));
	const finished = states.filter(isTerminal).length;
	return groupLeadWake(jobDir, label || id, state, id, branch, {
		group: run.id,
		feature: run.feature,
		lead: run.lead,
		team: member.team,
		finished,
		total: coordinators.length,
	});
}

function run(
	binary: string,
	args: readonly string[],
	timeout: number,
): Promise<{ readonly ok: boolean; readonly detail: string }> {
	const { promise, resolve } = Promise.withResolvers<{ readonly ok: boolean; readonly detail: string }>();
	execFile(binary, args, { encoding: "utf8", timeout }, (error, stdout, stderr) => {
		// error.message repeats the full argv, wake text included; the receipt keeps Herdr's own first line instead.
		const said = `${stderr || ""}${stdout || ""}`.trim().split("\n")[0] ?? "";
		const detail = error?.killed
			? `herdr exceeded ${timeout}ms`
			: said || (error ? `herdr exited ${error.code ?? "abnormally"}` : "");
		resolve({ ok: !error, detail });
	});
	return promise;
}
