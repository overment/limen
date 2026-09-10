import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listWorktrees, workspaceRoot } from "./git.ts";
import { appendLimenLog, atomicWrite, textFile } from "./wrapper.ts";

const SENDER = fileURLToPath(new URL("../bin/tony-finish-ping.sh", import.meta.url));
// Shorter than the detached wrapper's 5s termination grace, including a hung sender.
const SEND_MS = 3_000;
export function finishWebhookEnv(root: string, cwd: string, explicit = process.env.TONY_FINISH_WEBHOOK_ENV): string {
	if (explicit !== undefined) return explicit.trim() ? resolve(cwd, explicit) : "";
	const project = workspaceRoot(root) ? root : (listWorktrees(root)[0]?.path ?? root);
	const path = resolve(project, ".limen/finish-webhook.env");
	return existsSync(path) ? path : "";
}
export async function deliverFinishWebhook(jobDir: string, shutdownDeadline = Number.POSITIVE_INFINITY): Promise<void> {
	const config = await textFile(`${jobDir}/finish-webhook-env`);
	if (!config) return;
	const state = await textFile(`${jobDir}/state`);
	if (!["done", "failed", "stopped"].includes(state)) return;
	try {
		// Never reclaim: a crash after HTTP acceptance but before recording it is ambiguous.
		await writeFile(`${jobDir}/finish-webhook-attempt`, `${new Date().toISOString()}\n`, { flag: "wx", mode: 0o600, flush: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return;
		throw error;
	}
	const retry =
		"Manual finish-ping retry: inspect finish-webhook-attempt and finish-webhook; use bin/tony-finish-ping.sh with this job's finish-webhook-env, label, state and branch. Acceptance is not proof of owner wake; an interrupted attempt may already have sent.";
	await atomicWrite(`${jobDir}/finish-webhook`, `attempting ${new Date().toISOString()}\n${retry}\n`);
	await appendLimenLog(jobDir, "finish webhook: attempting; inspect finish-webhook for status and manual finish-ping retry");
	const label = await textFile(`${jobDir}/label`);
	const branch = await textFile(`${jobDir}/branch`);
	const timeoutMs = Math.min(SEND_MS, shutdownDeadline - Date.now());
	const result = !isAbsolute(config)
		? "failed: config path is not absolute"
		: timeoutMs <= 0
			? "failed: no shutdown time remains; not sent"
			: await send(config, label, state, branch, timeoutMs);
	await atomicWrite(`${jobDir}/finish-webhook`, `${result} ${new Date().toISOString()}\n${retry}\n`);
	await appendLimenLog(jobDir, `finish webhook: ${result}; inspect finish-webhook for manual finish-ping retry`);
}
function send(config: string, label: string, state: string, branch: string, timeoutMs: number): Promise<string> {
	return new Promise((resolve) => {
		const child = spawn(SENDER, [label, state, branch], {
			// Noninteractive PATH may omit Node even though Limen itself is running under it.
			env: { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}`, TONY_FINISH_WEBHOOK_ENV: config },
			stdio: "ignore",
			detached: true,
		});
		const timer = setTimeout(() => {
			if (child.pid) {
				try {
					process.kill(-child.pid, "SIGKILL");
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill("SIGKILL");
				}
			}
			finish(`failed: sender exceeded ${timeoutMs}ms; acceptance unknown`);
		}, timeoutMs);
		const finish = (result: string) => {
			clearTimeout(timer);
			resolve(result);
		};
		child.once("error", () => finish("failed: sender could not start"));
		child.once("exit", (code, signal) =>
			finish(code === 0 ? "accepted: sender exited 0 (owner wake unobserved)" : `failed: sender ${signal ? "interrupted" : `exited ${code ?? "unknown"}`}`),
		);
	});
}
