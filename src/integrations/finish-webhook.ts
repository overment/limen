import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, delimiter, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isTerminal, type TerminalState } from "../job/job.ts";
import { appendLimenLog, atomicWrite, textFile } from "../job/record.ts";
import { currentBranch, listWorktrees, ticketAuthor, workspaceRoot } from "../project/git.ts";
import { ticketPointers } from "../project/planning.ts";
import {
	finishEvent,
	GITHUB_AUTHOR,
	GITHUB_NOREPLY,
	parseFinishReceipt,
	parseFinishSelection,
	RECEIPT_MAX_BYTES,
} from "./finish-receipt.ts";

const SENDER = fileURLToPath(new URL("../../bin/tony-finish-ping.sh", import.meta.url));
// Leave time inside the detached wrapper's 5s termination grace to record the outcome.
const SEND_MS = 3_000;
const DELIVERY_MS = 4_000;
/** One plant webhook: what happened (`kind`), to what (`title`, `id`), where (`plant`), and why (`reason`). `status` is the sender's state argument. */
export type PlantEvent = {
	readonly kind: string;
	readonly status: string;
	readonly title: string;
	readonly id: string;
	readonly reason: string;
	readonly branch: string;
	readonly plant: string;
	readonly author?: string;
	readonly handoff?: string;
};
export function finishWebhookEnv(root: string, cwd: string, explicit = process.env.LIMEN_FINISH_WEBHOOK_ENV): string {
	if (explicit !== undefined) {
		return explicit.trim() ? resolve(cwd, explicit) : "";
	}
	const project = workspaceRoot(root) ? root : (listWorktrees(root)[0]?.path ?? root);
	const path = resolve(project, ".limen/finish-webhook.env");
	return existsSync(path) ? path : "";
}
export function captureFinishAuthor(cwd: string, task: string, workspace = false): string {
	if (workspace) {
		return "unavailable\nnon-Git workspace ticket";
	}
	const tickets = ticketPointers(task);
	const ticket = tickets.length === 1 ? tickets[0]?.path : undefined;
	if (!ticket) {
		return `unavailable\n${tickets.length ? "ambiguous Ticket: pointer" : "missing Ticket: pointer"}`;
	}
	try {
		const author = ticketAuthor(cwd, ticket);
		const login = GITHUB_NOREPLY.exec(author.email)?.[1];
		return login ? `@${login.toLowerCase()}\n${author.commit}` : `unavailable\nordinary email\n${author.commit}`;
	} catch (error) {
		const message = error instanceof Error ? error.message : "";
		const reason = AUTHOR_LOOKUP_REASONS.find(([needle]) => message.includes(needle))?.[1] ?? "lookup failed";
		return `unavailable\n${reason}`;
	}
}
const AUTHOR_LOOKUP_REASONS = [
	["shallow", "shallow history"],
	["not a committed file", "uncommitted ticket"],
	["must be a file inside", "ticket path outside repository"],
	["no creation author", "no creation author"],
] as const;
function senderResult(selection: string, code: number | null, signal: NodeJS.Signals | null): string {
	if (selection === "not sent: no author route") {
		return "skipped: not sent: no author route";
	}
	if (selection === "invalid author map") {
		return "failed: invalid author map; not sent";
	}
	if (code === 0) {
		return "accepted: sender exited 0 (owner wake unobserved)";
	}
	return `failed: sender ${signal ? "interrupted" : `exited ${code ?? "unknown"}`}`;
}
export async function deliverFinishWebhook(
	jobDir: string,
	shutdownDeadline = Number.POSITIVE_INFINITY,
	detail = "",
): Promise<void> {
	const config = await textFile(`${jobDir}/finish-webhook-env`);
	if (!config) {
		return;
	}
	const state = await textFile(`${jobDir}/state`);
	if (!isTerminal(state)) {
		return;
	}
	try {
		// Never reclaim: a crash after HTTP acceptance but before recording it is ambiguous.
		await writeFile(`${jobDir}/finish-webhook-attempt`, `${state} ${new Date().toISOString()}\n`, {
			flag: "wx",
			mode: 0o600,
			flush: true,
		});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			return;
		}
		throw error;
	}
	const manual =
		"Manual finish-ping retry: inspect finish-webhook-attempt and finish-webhook; use bin/tony-finish-ping.sh with this job's finish-webhook-env, label, state and branch. Acceptance is not proof of owner wake; an interrupted attempt may already have sent.";
	await atomicWrite(`${jobDir}/finish-webhook`, `attempting ${new Date().toISOString()}\n${manual}\n`);
	await appendLimenLog(
		jobDir,
		"finish webhook: attempting; inspect finish-webhook for status and manual finish-ping retry",
	);
	const deadline = Math.min(shutdownDeadline, Date.now() + DELIVERY_MS);
	// A done job's reason is its handoff's first text line, without Markdown markers; every other end names the finish detail, which is the failed gate.
	const summary =
		state === "done"
			? ((await textFile(`${jobDir}/result`))
					.split("\n")
					.map((line) => line.replace(/^[\s#>*-]+/, "").trim())
					.find(Boolean) ?? "")
			: "";
	const event: PlantEvent = {
		...(await jobFields(jobDir)),
		kind: terminalKind(state, detail),
		status: state,
		reason: summary || detail || state,
	};
	const timeoutMs = Math.min(SEND_MS, deadline - Date.now());
	let result = !isAbsolute(config)
		? "failed: config path is not absolute"
		: timeoutMs <= 0
			? "failed: no shutdown time remains; not sent"
			: await send(jobDir, config, event, finishEvent(jobDir), timeoutMs);
	const attempts: string[] = [];
	if (result.startsWith("failed: sender exceeded ")) {
		attempts.push(`attempt 1: ${result} ${new Date().toISOString()}`);
		await appendLimenLog(jobDir, `finish webhook: ${attempts[0]}`);
		if (deadline > Date.now()) {
			await atomicWrite(
				`${jobDir}/finish-webhook`,
				`attempting retry ${new Date().toISOString()}\n${attempts.join("\n")}\n${manual}\n`,
			);
			await appendLimenLog(jobDir, "finish webhook: attempting retry");
		}
		const remaining = Math.min(SEND_MS, deadline - Date.now());
		if (remaining > 0) {
			result = await send(jobDir, config, event, finishEvent(jobDir), remaining);
			attempts.push(`attempt 2: ${result} ${new Date().toISOString()}`);
			await appendLimenLog(jobDir, `finish webhook: ${attempts[1]}`);
		} else {
			attempts.push("retry: not retried; shutdown deadline reached");
			await appendLimenLog(jobDir, `finish webhook: ${attempts[1]}`);
		}
	}
	await atomicWrite(
		`${jobDir}/finish-webhook`,
		`${result} ${new Date().toISOString()}\n${attempts.length ? `${attempts.join("\n")}\n` : ""}${result.startsWith("skipped:") ? "" : `${manual}\n`}`,
	);
	await appendLimenLog(
		jobDir,
		`finish webhook: ${result}${result.startsWith("skipped:") ? "" : "; inspect finish-webhook for manual finish-ping retry"}`,
	);
}
/** Timeouts and stalled tools end a job as failed; the webhook names the gate that ended it. */
function terminalKind(state: TerminalState, detail: string): string {
	if (state === "failed" && detail.startsWith("timeout after ")) {
		return "job.timed-out";
	}
	if (state === "failed" && detail.startsWith("stalled tool ")) {
		return "job.stalled";
	}
	return `job.${state}`;
}
async function jobFields(jobDir: string): Promise<Omit<PlantEvent, "kind" | "status" | "reason">> {
	const [title, branch, author] = await Promise.all([
		textFile(`${jobDir}/label`),
		textFile(`${jobDir}/branch`),
		textFile(`${jobDir}/finish-webhook-author`),
	]);
	const login = author.split("\n")[0] ?? "";
	return {
		title,
		id: basename(jobDir),
		branch,
		plant: basename(resolve(jobDir, "../../..")),
		author: GITHUB_AUTHOR.test(login) ? login.toLowerCase() : "",
	};
}
/** A hosted stall pings once per advisory while the job still runs; a job that ends first sends only its terminal ping. */
export async function deliverJobStall(jobDir: string, line: string): Promise<void> {
	const config = await textFile(`${jobDir}/finish-webhook-env`);
	if (!config || (await textFile(`${jobDir}/state`)) !== "running") {
		return;
	}
	const handoff = "Job stalled while running. Next step: read the job, then steer it, stop it, or wait.";
	const result = await deliverEventWebhook(`${jobDir}/events/job.stalled.${Date.now()}`, config, {
		...(await jobFields(jobDir)),
		kind: "job.stalled",
		status: "stalled",
		reason: line,
		handoff,
	});
	if (result) {
		await appendLimenLog(jobDir, `stall webhook: ${result}`);
	}
}
/** A non-terminal event is claimed once by creating `dir`; its receipt stays beside the claim. Without config the claim records the skip. */
export async function deliverEventWebhook(dir: string, config: string, event: PlantEvent): Promise<string | undefined> {
	await mkdir(dirname(dir), { recursive: true });
	try {
		await mkdir(dir);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			return;
		}
		throw error;
	}
	const id = `limen-finish-${createHash("sha256").update(dir).digest("hex")}`;
	const result = !config
		? "skipped: no finish webhook config; not sent"
		: isAbsolute(config)
			? await send(dir, config, event, id, SEND_MS)
			: "failed: config path is not absolute";
	await atomicWrite(`${dir}/finish-webhook`, `${event.kind} ${result} ${new Date().toISOString()}\n`);
	return result;
}
/** `limen webhook test`: one synthetic event through the real sender, with its per-target lines on this terminal. */
export function sendTestPing(root: string, config: string): number {
	const at = new Date().toISOString();
	const event: PlantEvent = {
		kind: "webhook.test",
		status: "test",
		title: "limen webhook test",
		id: `webhook-test-${at}`,
		reason: `manual test ping from ${hostname()} at ${at}`,
		branch: plantBranch(root),
		plant: basename(root),
		handoff: "Test ping from limen webhook test. No action needed.",
	};
	const result = spawnSync(SENDER, [event.title, event.status, event.branch], {
		env: senderEnvironment(config, event),
		stdio: ["ignore", "inherit", "inherit"],
		timeout: 15_000,
	});
	return result.status ?? 1;
}
export function plantBranch(root: string): string {
	try {
		return currentBranch(root);
	} catch {
		// A detached plant root has no branch name; the payload still names HEAD.
		return "HEAD";
	}
}
/** A finished lead group step sends through the job sender once; its directory under the group cabinet is the receipt. */
export async function deliverLeadStepWebhook(
	stepDir: string,
	root: string,
	feature: string,
	step: "synthesis" | "close",
): Promise<void> {
	const config = finishWebhookEnv(root, root);
	if (!config) {
		return;
	}
	await mkdir(stepDir, { recursive: true });
	try {
		await writeFile(`${stepDir}/finish-webhook-attempt`, `done ${new Date().toISOString()}\n`, {
			flag: "wx",
			mode: 0o600,
			flush: true,
		});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			return;
		}
		throw error;
	}
	const name = basename(feature);
	const label = `${/^F\d+/.exec(name)?.[0] ?? name} lead ${step}`;
	const next = step === "close" ? "owner decision" : "owner decision on group/synthesis.md, or close the group";
	const handoff = `Lead step done: ${label}. Next step: ${next}.`;
	const login = captureFinishAuthor(root, `Ticket: ${feature}/ticket.md`).split("\n")[0] ?? "";
	const event: PlantEvent = {
		kind: "lead.step-done",
		status: "done",
		title: label,
		id: basename(stepDir),
		reason: step === "close" ? "group closed" : `${feature}/group/synthesis.md changed`,
		branch: plantBranch(root),
		plant: basename(root),
		author: login.startsWith("@") ? login : "",
		handoff,
	};
	const result = isAbsolute(config)
		? await send(stepDir, config, event, finishEvent(stepDir), SEND_MS)
		: "failed: config path is not absolute";
	await atomicWrite(`${stepDir}/finish-webhook`, `${result} ${new Date().toISOString()}\n`);
}
function senderEnvironment(config: string, event: PlantEvent): NodeJS.ProcessEnv {
	return {
		...process.env,
		PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}`,
		LIMEN_FINISH_WEBHOOK_ENV: config,
		LIMEN_FINISH_WEBHOOK_AUTHOR: event.author ?? "",
		// Undefined drops any inherited override, so a terminal job always sends the job handoff.
		LIMEN_FINISH_HANDOFF: event.handoff,
		LIMEN_FINISH_KIND: event.kind,
		LIMEN_FINISH_PLANT: event.plant,
		LIMEN_FINISH_ID: event.id,
		LIMEN_FINISH_REASON: event.reason,
	};
}
function send(receiptDir: string, config: string, event: PlantEvent, id: string, timeoutMs: number): Promise<string> {
	return new Promise((resolve) => {
		const child = spawn(SENDER, [event.title, event.status, event.branch], {
			env: { ...senderEnvironment(config, event), LIMEN_FINISH_EVENT: id },
			stdio: ["ignore", "ignore", "ignore", "pipe"],
			detached: true,
		});
		// Dedicated channel: never retain sender stdout/stderr or unvalidated bytes.
		let pending = "";
		let bytes = 0;
		let selection = "";
		const seen = new Map<number, string>();
		child.stdio[3]?.on("data", (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > RECEIPT_MAX_BYTES) {
				return;
			}
			pending += chunk.toString("utf8");
			const lines = pending.split("\n");
			pending = lines.pop() ?? "";
			for (const line of lines) {
				const routed = parseFinishSelection(line);
				if (routed && !selection) {
					selection = routed;
					writeFileSync(`${receiptDir}/finish-webhook-route`, `${routed}\n`, { mode: 0o600, flush: true });
					continue;
				}
				const receipt = parseFinishReceipt(line);
				if (
					!receipt ||
					(seen.has(receipt.target) && (seen.get(receipt.target) !== "pending" || receipt.transport === "pending"))
				) {
					continue;
				}
				seen.set(receipt.target, receipt.transport);
				appendFileSync(`${receiptDir}/finish-webhook-targets`, `${JSON.stringify(receipt)}\n`, {
					mode: 0o600,
					flush: true,
				});
			}
		});
		const timer = setTimeout(() => {
			if (child.pid) {
				try {
					process.kill(-child.pid, "SIGKILL");
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
						child.kill("SIGKILL");
					}
				}
			}
			finish(`failed: sender exceeded ${timeoutMs}ms; acceptance unknown`);
		}, timeoutMs);
		const finish = (result: string) => {
			clearTimeout(timer);
			resolve(result);
		};
		child.once("error", () => finish("failed: sender could not start"));
		child.once("close", (code, signal) => finish(senderResult(selection, code, signal)));
	});
}
