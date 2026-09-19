import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { basename } from "node:path";
import { inspectFinishTurns } from "./finish-turn.ts";
import { textFile } from "./wrapper.ts";

type FinishReceipt = { target: number; at: string; transport: "pending" | "accepted" | "rejected" | "unknown"; http: "none" | "1xx" | "2xx" | "3xx" | "4xx" | "5xx" };
const FINISH_SELECTION = /^(fan-out|mapped @[a-z\d](?:[a-z\d-]{0,37}[a-z\d])? -> \d+(?:, \d+)*|fallback \* -> \d+(?:, \d+)*|not sent: no author route|invalid author map)$/;
export function finishEvent(jobDir: string): string {
	return `limen-finish-${createHash("sha256").update(basename(jobDir)).digest("hex")}`;
}
export function parseFinishSelection(line: string): string | undefined {
	if (line.length > 256) return;
	try {
		const value = JSON.parse(line);
		if (!value || Object.keys(value).join() !== "selection" || typeof value.selection !== "string" || !FINISH_SELECTION.test(value.selection)) return;
		return value.selection;
	} catch {
		return;
	}
}
export function parseFinishReceipt(line: string): FinishReceipt | undefined {
	if (line.length > 256) return;
	try {
		const value = JSON.parse(line);
		if (!value || Object.keys(value).sort().join() !== "at,http,target,transport") return;
		const { target, at, transport, http } = value;
		if (
			!Number.isInteger(target) ||
			target < 1 ||
			target > 64 ||
			typeof at !== "string" ||
			!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(at) ||
			!Number.isFinite(Date.parse(at))
		)
			return;
		if (!["pending", "accepted", "rejected", "unknown"].includes(transport) || !["none", "1xx", "2xx", "3xx", "4xx", "5xx"].includes(http)) return;
		if (transport === "accepted" ? http !== "2xx" : transport === "rejected" ? !["1xx", "3xx", "4xx", "5xx"].includes(http) : http !== "none") return;
		return { target, at, transport, http };
	} catch {
		return;
	}
}
export async function inspectFinishWebhook(jobDir: string): Promise<string> {
	const configured = Boolean(await textFile(`${jobDir}/finish-webhook-env`));
	const lines = [`configured: ${configured ? "yes (selection recorded; validity not checked)" : "no"}`, `event: ${finishEvent(jobDir)}`];
	const [first, second, third] = (await textFile(`${jobDir}/finish-webhook-author`)).split("\n");
	const commit = second && /^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(second) ? second : third && /^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(third) ? third : "";
	if (first && /^@[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/.test(first)) lines.push(`author: ${first}${commit ? ` · commit ${commit}` : ""}`);
	else if (first === "unavailable" && second && /^[a-zA-Z0-9 :._-]{1,80}$/.test(second))
		lines.push(`author: unavailable · ${second}${third && commit === third ? ` · commit ${third}` : ""}`);
	else lines.push("author: unavailable · missing evidence");
	const route = await textFile(`${jobDir}/finish-webhook-route`);
	if (route && FINISH_SELECTION.test(route)) lines.push(`route: ${route}`);
	const targets = new Map<number, FinishReceipt>();
	const handle = await open(`${jobDir}/finish-webhook-targets`, "r").catch(() => undefined);
	if (handle) {
		try {
			const buffer = Buffer.alloc(32_768);
			const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
			for (const line of buffer.toString("utf8", 0, bytesRead).split("\n").slice(0, -1)) {
				const receipt = parseFinishReceipt(line);
				if (receipt && (!targets.has(receipt.target) || targets.get(receipt.target)?.transport === "pending")) targets.set(receipt.target, receipt);
			}
		} finally {
			await handle.close();
		}
	}
	if (!targets.size) lines.push("transport: unknown (no per-target evidence)");
	const turns = await inspectFinishTurns(finishEvent(jobDir));
	for (const ordinal of [...new Set([...targets.keys(), ...turns.keys()])].sort((a, b) => a - b)) {
		const target = targets.get(ordinal);
		const transport = target
			? `${target.transport === "pending" ? "unknown (attempt started; no result)" : target.transport} · HTTP ${target.http} · ${target.at}`
			: "unknown (no per-target evidence)";
		lines.push(`target ${ordinal}: transport ${transport} · bot-turn ${turns.get(ordinal) ?? "unobserved"}`);
	}
	lines.push(
		turns.size
			? `bot-turn: observed for ${turns.size} target(s) (operator-trusted exports; not origin authentication)`
			: "bot-turn: unobserved (no matching completed-turn export from an operator-trusted source)",
	);
	const aggregate = await textFile(`${jobDir}/finish-webhook`);
	if (aggregate) lines.push(`aggregate: ${aggregate}`);
	return lines.join("\n");
}
