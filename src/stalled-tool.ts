import { execFile } from "node:child_process";
import { processInfo, type JobProcess } from "./contain.ts";

const DEFAULT_TOOL_STALL_MS = 3 * 60_000;
const PROCESS_SAMPLE_MS = 2_000;
export function toolStallMs(): number {
	const configured = Number(process.env.LIMEN_TOOL_STALL_MS);
	return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TOOL_STALL_MS;
}

type Row = { pid: number; ppid: number; cpu: number; state: string };
type Sample = { children: Row[]; cpu: number };
function cpuSeconds(value: string): number {
	const parts = value.split(":");
	if (parts.length < 2 || parts.length > 3) return Number.NaN;
	const first = parts[0].split("-");
	if (first.length > 2) return Number.NaN;
	const numbers = [...first, ...parts.slice(1)].map(Number);
	if (numbers.some((n) => !Number.isFinite(n) || n < 0)) return Number.NaN;
	const days = first.length === 2 ? numbers.shift() ?? 0 : 0;
	return days * 86400 + numbers.reduce((total, n) => total * 60 + n, 0);
}
function processRows(): Promise<Row[]> {
	const { promise, resolve, reject } = Promise.withResolvers<Row[]>();
	const scanner = execFile("ps", ["-Ao", "pid=,ppid=,time=,stat="], { timeout: PROCESS_SAMPLE_MS, maxBuffer: 1024 * 1024 }, (error, stdout) => {
		if (error) return reject(error);
		const rows: Row[] = [];
		for (const line of stdout.split("\n")) {
			const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s*$/.exec(line);
			if (!match || Number(match[1]) === scanner.pid) continue;
			const cpu = cpuSeconds(match[3]);
			if (!Number.isFinite(cpu)) return reject(new Error("unreadable process CPU time"));
			rows.push({ pid: Number(match[1]), ppid: Number(match[2]), cpu, state: match[4] });
		}
		resolve(rows);
	});
	return promise;
}

async function sampleTree(pid: number, born: string): Promise<Sample | undefined> {
	const before = await processInfo(pid);
	if (before.kind !== "present" || before.process.born !== born) return;
	const rows = await processRows();
	const root = rows.find((row) => row.pid === pid && !row.state.startsWith("Z"));
	if (!root) return;
	const byParent = new Map<number, Row[]>();
	for (const row of rows) {
		if (row.state.startsWith("Z")) continue;
		const siblings = byParent.get(row.ppid);
		if (siblings) siblings.push(row);
		else byParent.set(row.ppid, [row]);
	}
	const children: Row[] = [];
	const seen = new Set([pid]);
	for (let index = 0; index <= children.length; index += 1) {
		const parent = index === 0 ? pid : children[index - 1]?.pid;
		if (parent === undefined) continue;
		for (const row of byParent.get(parent) ?? []) {
			if (seen.has(row.pid)) continue;
			seen.add(row.pid);
			children.push(row);
		}
	}
	const after = await processInfo(pid);
	if (after.kind !== "present" || after.process.born !== born) return;
	return { children, cpu: root.cpu + children.reduce((total, row) => total + row.cpu, 0) };
}

export type ToolStallWatch = { tool: string; born: string; started: number; hadChild?: boolean; lastSampleAt?: number; previous?: Sample };
/** A pending tool needs an observed child and unchanged cumulative CPU time; a vanished child stays evidence after its exit. */
export async function observeToolStall(watch: ToolStallWatch, pid: number, tool: string, now = Date.now(), windowMs = toolStallMs()): Promise<"stalled" | "uncertain" | undefined> {
	if (!tool) {
		watch.tool = "";
		watch.previous = undefined;
		watch.hadChild = false;
		return;
	}
	const identity = await processInfo(pid);
	if (identity.kind !== "present") {
		watch.previous = undefined;
		watch.started = now;
		return "uncertain";
	}
	if (watch.tool !== tool || watch.born !== identity.process.born) {
		watch.tool = tool;
		watch.born = identity.process.born;
		watch.started = now;
		watch.previous = undefined;
		watch.hadChild = false;
	}
	let current: Sample | undefined;
	try {
		current = await sampleTree(pid, watch.born);
	} catch {
		watch.previous = undefined;
		watch.started = now;
		return "uncertain";
	}
	if (!current) {
		watch.previous = undefined;
		watch.started = now;
		return "uncertain";
	}
	const previous = watch.previous;
	watch.previous = current;
	if (current.children.length > 0) watch.hadChild = true;
	const stableChildren =
		previous &&
		watch.hadChild &&
		current.children.length === previous.children.length &&
		current.children.every((row) => previous.children.some((prior) => prior.pid === row.pid && prior.ppid === row.ppid && row.cpu === prior.cpu));
	if (!previous || !stableChildren || current.cpu !== previous.cpu) watch.started = now;
	if (previous && stableChildren && current.cpu === previous.cpu && now - watch.started >= windowMs) return "stalled";
}

/** Capture only descendants still connected to the verified root, with individual birth identities. */
export async function ownedToolDescendants(pid: number, born: string): Promise<JobProcess[] | undefined> {
	const sample = await sampleTree(pid, born).catch(() => undefined);
	if (!sample) return;
	const captured = await Promise.all(sample.children.map(async (row) => {
		const result = await processInfo(row.pid);
		return result.kind === "present" && result.process.ppid === row.ppid ? result.process : undefined;
	}));
	if (captured.some((child) => !child)) return;
	return captured as JobProcess[];
}

export async function signalOwnedProcess(pid: number, born: string, signal: NodeJS.Signals): Promise<boolean> {
	const info = await processInfo(pid);
	if (info.kind !== "present" || info.process.born !== born) return false;
	try {
		process.kill(pid, signal);
		return true;
	} catch {
		return false;
	}
}
