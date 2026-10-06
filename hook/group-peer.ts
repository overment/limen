import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { deliverLeadStepWebhook } from "../src/integrations/finish-webhook.ts";
import type { GroupIdentity, GroupRun } from "../src/job/group-cabinet.ts";
import { groupIdentity, groupPath, runs } from "../src/job/group-cabinet.ts";
import { acceptBatch, acceptTransport, observeBatch, releaseBatch } from "../src/job/group-events.ts";
import { SESSION_ID } from "../src/job/job.ts";
import { repoRoot } from "../src/project/git.ts";

type Content = { readonly type: string; readonly text?: string };
type Context = {
	readonly cwd: string;
	readonly agent?: { readonly kind: string };
	readonly sessionManager: { getSessionId(): string };
	readonly ui: { notify(text: string, level: string): void };
};
type Message = { readonly role?: string; readonly content?: string | readonly Content[]; readonly stopReason?: string };
type PiApi = {
	on(event: "session_start" | "session_shutdown", handler: (event: unknown, context: Context) => Promise<void>): void;
	on(
		event: "tool_result",
		handler: (
			event: { readonly content?: readonly Content[] },
			context: Context,
		) => Promise<{ content: Content[] } | undefined>,
	): void;
	on(
		event: "tool_call",
		handler: (event: { readonly toolName: string }, context: Context) => { block: boolean; reason: string } | undefined,
	): void;
	on(event: "before_subagent_spawn", handler: () => { block: boolean; reason: string } | undefined): void;
	on(
		event: "context",
		handler: (event: { readonly messages: readonly Message[] }, context: Context) => Promise<void>,
	): void;
	on(event: "message_end", handler: (event: { readonly message: Message }, context: Context) => Promise<void>): void;
	sendMessage(
		message: { customType: string; content: string; display: boolean; attribution: "agent" },
		options: { deliverAs: "followUp"; triggerTurn: boolean },
	): void | Promise<void>;
};

/** Peer data stays in tool/custom messages. Never use owner steering for group delivery. */
export default function groupPeer(pi: PiApi): void {
	let leadRoot: string | undefined;
	let leadSession: string | undefined;
	let timer: NodeJS.Timeout | undefined;
	let sweeping = false;
	const observed = new Map<string, { identity: GroupIdentity; token: string }>();
	const leased = new Map<string, { identity: GroupIdentity; token: string }>();
	const seenTokens = new Set<string>();
	// What the lead's groups looked like at the last turn end; a turn's group step is the difference.
	const seenSynthesis = new Map<string, string>();
	const seenClosed = new Set<string>();
	const identities = async (context: Context): Promise<GroupIdentity[]> => {
		if (context.agent?.kind === "sub") {
			return [];
		}
		const member = await groupIdentity(context.cwd);
		if (member) {
			return [member];
		}
		if (!leadRoot || !leadSession) {
			return [];
		}
		return (await runs(leadRoot))
			.filter((run) => !run.closed && run.lead === leadSession)
			.map((run) => ({ run, recipient: `lead-${leadSession}` }));
	};
	const leadSteps = async (): Promise<{ run: GroupRun; step: "synthesis" | "close"; receipt: string }[]> => {
		if (!leadRoot || !leadSession || process.env.LIMEN_COORDINATOR !== "1" || process.env.LIMEN_JOB === "1") {
			return [];
		}
		const mine = (await runs(leadRoot)).filter((run) => run.lead === leadSession);
		const steps: { run: GroupRun; step: "synthesis" | "close"; receipt: string }[] = [];
		for (const run of mine) {
			if (!run.closed || seenClosed.has(run.id)) {
				continue;
			}
			seenClosed.add(run.id);
			steps.push({ run, step: "close", receipt: `${run.id}-close` });
		}
		// A feature folder may hold several runs; its synthesis belongs to the newest one. A synthesis older than that run is not its step.
		for (const run of new Map(mine.map((run) => [run.feature, run])).values()) {
			const path = `${run.root}/${run.feature}/group/synthesis.md`;
			const [text, info] = await Promise.all([
				readFile(path).catch(() => undefined),
				stat(path).catch(() => undefined),
			]);
			const hash =
				text && info && info.mtimeMs >= run.startedAt
					? createHash("sha256").update(text).digest("hex").slice(0, 16)
					: "";
			const before = seenSynthesis.get(run.feature);
			seenSynthesis.set(run.feature, hash);
			if (hash && hash !== before && !run.closed) {
				steps.push({ run, step: "synthesis", receipt: `${run.id}-synthesis-${hash}` });
			}
		}
		return steps;
	};
	pi.on("session_start", async (_event, context) => {
		if (process.env.LIMEN_JOB === "1" || context.agent?.kind === "sub") {
			return;
		}
		try {
			leadRoot = repoRoot(context.cwd);
		} catch {
			return;
		}
		leadSession = context.sessionManager.getSessionId();
		if (!SESSION_ID.test(leadSession)) {
			return;
		}
		const registration = `${leadRoot}/.limen/group-leads/${leadSession}`;
		await mkdir(`${leadRoot}/.limen/group-leads`, { recursive: true });
		await writeFile(registration, `${process.pid}\n`, { flush: true });
		await leadSteps();
		const deliver = async () => {
			for (const identity of await identities(context)) {
				if ([...leased.values()].some((entry) => entry.identity.run.id === identity.run.id)) {
					continue;
				}
				const batch = await acceptBatch(identity, Date.now(), "skip");
				if (!batch) {
					continue;
				}
				leased.set(batch.token, { identity, token: batch.token });
				try {
					// nextTurn parks idle Pi messages even with triggerTurn; followUp wakes idle leads without steering busy ones.
					await pi.sendMessage(
						{ customType: "limen-group-progress", content: batch.text, display: true, attribution: "agent" },
						{ deliverAs: "followUp", triggerTurn: true },
					);
					await acceptTransport(identity, batch.token);
				} catch (error) {
					await releaseBatch(identity, batch.token);
					leased.delete(batch.token);
					throw error;
				}
			}
		};
		const sweep = () => {
			if (sweeping) {
				return;
			}
			sweeping = true;
			void deliver()
				// The registration's mtime is the heartbeat that `group start` and the finish path read; only a completed sweep refreshes it.
				// A removed registration stays removed: its absence is the signal that this pane is not the lead.
				.then(() => utimes(registration, new Date(), new Date()).catch(() => {}))
				.catch((error: unknown) => context.ui.notify(`group delivery requires inspection: ${String(error)}`, "warning"))
				.finally(() => {
					sweeping = false;
				});
		};
		timer = setInterval(sweep, 1_000);
		timer.unref();
	});
	pi.on("tool_call", (event) =>
		process.env.LIMEN_GROUP_ID && event.toolName === "task"
			? { block: true, reason: "group helpers must use the recorded limen worker allowance, not built-in subagents" }
			: undefined,
	);
	pi.on("before_subagent_spawn", () =>
		process.env.LIMEN_GROUP_ID
			? { block: true, reason: "group members cannot bypass their recorded launch allowance with built-in subagents" }
			: undefined,
	);
	pi.on("tool_result", async (event, context) => {
		const patches = [...(event.content ?? [])];
		for (const identity of await identities(context)) {
			const batch = await acceptBatch(identity, Date.now(), "skip");
			if (!batch) {
				continue;
			}
			leased.set(batch.token, { identity, token: batch.token });
			patches.push({ type: "text", text: batch.text });
		}
		if (patches.length !== (event.content?.length ?? 0)) {
			return { content: patches };
		}
	});
	pi.on("context", async (event, context) => {
		const current = await identities(context);
		for (const message of event.messages) {
			if (message.role !== "toolResult" && message.role !== "custom") {
				continue;
			}
			const text =
				typeof message.content === "string"
					? message.content
					: (message.content ?? []).map((part) => part.text ?? "").join("\n");
			for (const match of text.matchAll(/\[limen-group-delivery:([a-f0-9-]+)\]/g)) {
				const token = match[1];
				if (!token || seenTokens.has(token)) {
					continue;
				}
				for (const identity of current) {
					await observeBatch(identity, token, false);
					observed.set(`${identity.run.id}:${token}`, { identity, token });
				}
				seenTokens.add(token);
			}
		}
	});
	pi.on("message_end", async (event, context) => {
		if (event.message.role === "toolResult" || event.message.role === "custom") {
			const text =
				typeof event.message.content === "string"
					? event.message.content
					: (event.message.content ?? []).map((part) => part.text ?? "").join("\n");
			for (const match of text.matchAll(/\[limen-group-delivery:([a-f0-9-]+)\]/g)) {
				if (match[1]) {
					for (const identity of await identities(context)) {
						await acceptTransport(identity, match[1]);
					}
				}
			}
			return;
		}
		if (event.message.role !== "assistant") {
			return;
		}
		const failed = event.message.stopReason === "error" || event.message.stopReason === "aborted";
		for (const entry of observed.values()) {
			if (failed) {
				await releaseBatch(entry.identity, entry.token);
			} else {
				await observeBatch(entry.identity, entry.token, true);
			}
			leased.delete(entry.token);
		}
		observed.clear();
		// A failed or mid-tool message leaves the marks alone, so the next finished turn still sends its group step.
		if (failed || event.message.stopReason === "toolUse") {
			return;
		}
		for (const { run, step, receipt } of await leadSteps()) {
			await deliverLeadStepWebhook(`${groupPath(run)}/lead-steps/${receipt}`, run.root, run.feature, step).catch(
				(error: unknown) =>
					context.ui.notify(`lead step finish webhook requires inspection: ${String(error)}`, "warning"),
			);
		}
	});
	pi.on("session_shutdown", async () => {
		clearInterval(timer);
		for (const entry of leased.values()) {
			await releaseBatch(entry.identity, entry.token);
		}
		leased.clear();
		observed.clear();
		if (leadRoot && leadSession) {
			await rm(`${leadRoot}/.limen/group-leads/${leadSession}`, { force: true });
		}
	});
}
