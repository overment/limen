import { spawn } from "node:child_process";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { appendLimenLog, atomicWrite, textFile } from "../job/record.ts";
import { processAlive } from "../runtime/contain.ts";
import {
	type FinishReceipt,
	finalReceipts,
	parseFinishReceipt,
	parseFinishSelection,
	RECEIPT_MAX_BYTES,
} from "./finish-receipt.ts";
import type { PlantEvent } from "./finish-webhook.ts";

export const SENDER = fileURLToPath(new URL("../../bin/tony-finish-ping.sh", import.meta.url));
const LIMEN = fileURLToPath(new URL("../../bin/limen", import.meta.url));
// One try: a cold Node start on a loaded Mac (3.4 s seen) plus the sender's 10 s request limit, with room to spare.
const TRY_MS = 30_000;
// A deliverer sleeps only through a short backoff; after a longer one the next limen command, sweep or wake hook resends.
const WAIT_MS = 2 * 60_000;
const MAX_BACKOFF_MS = 10 * 60_000;
const GIVE_UP_MS = 24 * 60 * 60_000;
// The queue snapshot is gone after a final failure, so the job's result file carries the final message.
const MANUAL =
	"Manual finish-ping send: only after a final failure. Run bin/tony-finish-ping.sh with this job's finish-webhook-env as LIMEN_FINISH_WEBHOOK_ENV, its result file (when it has one) as LIMEN_FINISH_MESSAGE_FILE, and its label, state and branch.";

/** One queued ping. `limen` is the plant's `.limen` folder; `log` is the job folder whose log names each try, or "". */
type Queued = {
	readonly limen: string;
	readonly config: string;
	readonly event: PlantEvent;
	readonly id: string;
	readonly log: string;
	readonly since: string;
	readonly tries: number;
	readonly next: string;
	readonly history: readonly string[];
};
/** `final`: no resend can help (route or config); `retry`: the sender gave no answer; `targets`: the receipts decide. */
type Sent = { readonly result: string; readonly outcome: "final" | "retry" | "targets" };

/** Writes the ping to disk before any send, lists it in the plant outbox, and starts its deliverer. */
export async function queuePing(
	limen: string,
	dir: string,
	config: string,
	event: PlantEvent,
	id: string,
	log = "",
): Promise<void> {
	const now = new Date().toISOString();
	const queued: Queued = { limen, config, event, id, log, since: now, tries: 0, next: now, history: [] };
	if (!isAbsolute(config)) {
		return record(dir, queued, `failed: config path is not absolute ${now}`);
	}
	await atomicWrite(`${dir}/finish-webhook-queue`, `${JSON.stringify(queued)}\n`);
	await mkdir(join(limen, "outbox"), { recursive: true });
	await atomicWrite(join(limen, "outbox", id), `${dir}\n`);
	await record(dir, queued, `queued ${now}`);
	startDeliverer(dir);
}
/** Starts a deliverer for every queued ping of this plant that is due and has no live deliverer. */
export async function resendQueuedPings(limen: string): Promise<void> {
	const outbox = join(limen, "outbox");
	for (const id of await readdir(outbox).catch(() => [] as string[])) {
		const dir = await textFile(join(outbox, id));
		const queued = dir ? await readQueue(dir) : undefined;
		if (!queued) {
			await rm(join(outbox, id), { force: true });
			continue;
		}
		if (Date.parse(queued.next) <= Date.now() && !(await leaseHeld(`${dir}/finish-webhook-lease`))) {
			startDeliverer(dir);
		}
	}
}
/** The next limen command resends the queued pings of the plant at or above `cwd`. */
export async function resendNearbyPings(cwd: string): Promise<void> {
	for (let dir = resolve(cwd); ; dir = dirname(dir)) {
		if (existsSync(join(dir, ".limen", "outbox"))) {
			return resendQueuedPings(join(dir, ".limen"));
		}
		if (dirname(dir) === dir) {
			return;
		}
	}
}
/** `limen webhook deliver`: tries one queued ping until it settles, the next backoff passes WAIT_MS, or another deliverer owns it. */
export async function deliverQueued(dir: string): Promise<void> {
	const lease = `${dir}/finish-webhook-lease`;
	if (!(await takeLease(lease))) {
		return;
	}
	try {
		for (;;) {
			const queued = await readQueue(dir);
			const wait = queued ? Date.parse(queued.next) - Date.now() : Number.POSITIVE_INFINITY;
			if (!queued || wait > WAIT_MS) {
				return;
			}
			await sleep(Math.max(0, wait));
			await tryOnce(dir, queued);
		}
	} finally {
		if ((await textFile(lease)) === String(process.pid)) {
			await rm(lease, { force: true });
		}
	}
}
async function leaseHeld(lease: string): Promise<boolean> {
	const pid = Number(await textFile(lease));
	return Number.isInteger(pid) && pid > 0 && processAlive(pid);
}
async function takeLease(lease: string): Promise<boolean> {
	for (const _ of [1, 2]) {
		try {
			await writeFile(lease, `${process.pid}\n`, { flag: "wx" });
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
				throw error;
			}
		}
		// A deliverer killed mid-try leaves its lease; a later one takes over. The receiver can drop a repeat by its key.
		if (await leaseHeld(lease)) {
			return false;
		}
		await rm(lease, { force: true });
	}
	return false;
}
async function readQueue(dir: string): Promise<Queued | undefined> {
	const text = await textFile(`${dir}/finish-webhook-queue`);
	return text ? (JSON.parse(text) as Queued) : undefined;
}
async function tryOnce(dir: string, queued: Queued): Promise<void> {
	const tries = queued.tries + 1;
	const targets = `${dir}/finish-webhook-targets`;
	const before = finalReceipts(await readFile(targets, "utf8").catch(() => ""));
	const sent = await send(
		dir,
		queued,
		[...before].filter(([, receipt]) => !open(receipt)).map(([target]) => target),
	);
	const tried = {
		...queued,
		tries,
		history: [...queued.history, `try ${tries}: ${sent.result} ${new Date().toISOString()}`].slice(-20),
	};
	const after = [...finalReceipts(await readFile(targets, "utf8").catch(() => "")).values()];
	if (sent.outcome === "final") {
		return settle(dir, tried, sent.result);
	}
	if (after.some(open) || (sent.outcome === "retry" && !after.length)) {
		if (Date.now() - Date.parse(queued.since) >= GIVE_UP_MS) {
			return settle(dir, tried, `failed: gave up after ${tries} tries in 24 h; last: ${sent.result}`);
		}
		const next = new Date(Date.now() + backoff(tries)).toISOString();
		await atomicWrite(`${dir}/finish-webhook-queue`, `${JSON.stringify({ ...tried, next })}\n`);
		return record(dir, tried, `queued: try ${tries} ${sent.result}; next try ${next}`);
	}
	await noteKeyRefusal(dir, queued, after);
	const refused = after
		.filter((receipt) => receipt.transport !== "accepted")
		.map(({ target, http, body }) => `target ${target} HTTP ${http}${body ? ` ${JSON.stringify(body)}` : ""}`);
	await settle(
		dir,
		tried,
		refused.length
			? `failed: ${refused.join(", ")}; not retried`
			: `accepted: every target accepted after ${tries} ${tries === 1 ? "try" : "tries"} (owner wake unobserved)`,
	);
}
/**
 * A 401 or 403 means a receiver refused the key. `.limen/webhook-rejected` names the newest such refusal of any ping,
 * also a coordinator's, until a later ping that every target accepts removes it; `limen status` shows it first.
 */
async function noteKeyRefusal(dir: string, queued: Queued, receipts: readonly FinishReceipt[]): Promise<void> {
	const marker = join(queued.limen, "webhook-rejected");
	const denied = receipts.find((receipt) => receipt.transport === "rejected" && /^40[13]$/.test(receipt.http));
	if (denied) {
		const receipt = relative(dirname(queued.limen), dir);
		const at = new Date().toISOString();
		return atomicWrite(
			marker,
			`target ${denied.target} HTTP ${denied.http} for ${queued.event.kind} at ${at}; ${receipt}\n`,
		);
	}
	if (receipts.every((receipt) => receipt.transport === "accepted")) {
		await rm(marker, { force: true });
	}
}
/** Not answered yet, or answered with a code a later try can change: 408, 429 or 5xx. */
function open(receipt: FinishReceipt): boolean {
	return (
		receipt.transport === "pending" ||
		receipt.transport === "unknown" ||
		(receipt.transport === "rejected" && /^(408|429|5\d\d|5xx)$/.test(receipt.http))
	);
}
/** Five seconds, then three times longer each try, up to ten minutes. */
function backoff(tries: number): number {
	const base = Number(process.env.LIMEN_WEBHOOK_RETRY_MS) > 0 ? Number(process.env.LIMEN_WEBHOOK_RETRY_MS) : 5_000;
	return Math.min(base * 3 ** (tries - 1), MAX_BACKOFF_MS);
}
async function settle(dir: string, queued: Queued, result: string): Promise<void> {
	const manual = result.startsWith("failed:") && dir === queued.log ? [MANUAL] : [];
	await record(dir, { ...queued, history: [...queued.history, ...manual] }, `${result} ${new Date().toISOString()}`);
	await rm(`${dir}/finish-webhook-queue`, { force: true });
	await rm(join(queued.limen, "outbox", queued.id), { force: true });
}
/** `finish-webhook`: the current standing first, then one line per try. */
async function record(dir: string, queued: Queued, line: string): Promise<void> {
	await atomicWrite(`${dir}/finish-webhook`, `${[line, ...queued.history].join("\n")}\n`);
	if (queued.log) {
		await appendLimenLog(queued.log, `${queued.event.kind} webhook: ${line}`);
	}
}
function startDeliverer(dir: string): void {
	const child = spawn(LIMEN, ["webhook", "deliver", dir], {
		detached: true,
		stdio: "ignore",
		// A deliverer started by a job wrapper or supervisor must not run that job again.
		env: {
			...process.env,
			LIMEN_INTERNAL_RUN: undefined,
			LIMEN_INTERNAL_HOSTED: undefined,
			PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}`,
		},
	});
	// A deliverer that cannot start leaves the ping queued for the next limen command, sweep or wake hook.
	child.once("error", () => {});
	child.unref();
}
export function senderEnvironment(config: string, event: PlantEvent, queue?: string): NodeJS.ProcessEnv {
	return {
		...process.env,
		PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}`,
		LIMEN_FINISH_WEBHOOK_ENV: config,
		LIMEN_FINISH_WEBHOOK_AUTHOR: event.author ?? "",
		// Queued reports stay in the file: argv and environment values have OS size limits.
		LIMEN_FINISH_HANDOFF: queue ? undefined : event.handoff,
		LIMEN_FINISH_QUEUE: queue,
		LIMEN_FINISH_MESSAGE_FILE: undefined,
		LIMEN_FINISH_KIND: event.kind,
		LIMEN_FINISH_PLANT: event.plant,
		LIMEN_FINISH_ID: event.id,
		LIMEN_FINISH_REASON: event.reason,
		...(event.host ? { LIMEN_FINISH_HOST: event.host } : {}),
	};
}
function senderResult(selection: string, code: number | null, signal: NodeJS.Signals | null, answered: boolean): Sent {
	if (selection === "not sent: no author route") {
		return { result: "skipped: not sent: no author route", outcome: "final" };
	}
	if (selection === "invalid author map") {
		return { result: "failed: invalid author map; not sent", outcome: "final" };
	}
	if (code === 0) {
		return { result: "accepted: sender exited 0 (owner wake unobserved)", outcome: "targets" };
	}
	// A sender that refused its config before any target sends nothing on a later try either.
	return {
		result: `failed: sender ${signal ? "interrupted" : `exited ${code ?? "unknown"}`}`,
		outcome: answered ? "targets" : signal ? "retry" : "final",
	};
}
function send(dir: string, queued: Queued, skip: readonly number[]): Promise<Sent> {
	const { promise, resolve } = Promise.withResolvers<Sent>();
	const child = spawn(SENDER, [queued.event.title, queued.event.status, queued.event.branch], {
		env: {
			...senderEnvironment(queued.config, queued.event, `${dir}/finish-webhook-queue`),
			LIMEN_FINISH_EVENT: queued.id,
			LIMEN_FINISH_WEBHOOK_SKIP: skip.join(","),
		},
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
				writeFileSync(`${dir}/finish-webhook-route`, `${routed}\n`, { mode: 0o600, flush: true });
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
			appendFileSync(`${dir}/finish-webhook-targets`, `${JSON.stringify(receipt)}\n`, { mode: 0o600, flush: true });
		}
	});
	const finish = (sent: Sent) => {
		clearTimeout(timer);
		resolve(sent);
	};
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
		finish({ result: `failed: sender exceeded ${TRY_MS}ms; acceptance unknown`, outcome: "retry" });
	}, TRY_MS);
	child.once("error", () => finish({ result: "failed: sender could not start", outcome: "retry" }));
	child.once("close", (code, signal) => finish(senderResult(selection, code, signal, seen.size > 0)));
	return promise;
}
