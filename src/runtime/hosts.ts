import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { groupLock } from "../job/group-cabinet.ts";
import { appendLimenLog, atomicWrite, textFile } from "../job/record.ts";
import { registeredProjects, seatDir } from "../project/seat.ts";
import { processAlive } from "./contain.ts";
import { type HostPlatform, probeScript, type RemoteHost, shellText } from "./host-shell.ts";
import { type Reading, readLoad, type StartGate, startGate } from "./start-queue.ts";

export type { HostPlatform, RemoteHost };

export type HostPool = {
	readonly overflow: boolean;
	readonly hosts: readonly RemoteHost[];
	readonly ignored: readonly string[];
};

const ALIAS = /^[a-z][a-z0-9-]{0,31}$/;
const SSH_TARGET = /^[A-Za-z0-9][A-Za-z0-9._@:%~-]*$/;
const SEGMENT = /^[A-Za-z0-9._-]+$/;

/** `LIMEN_HOSTS_FILE` or `<seat>/hosts.json`. Missing means no hosts: jobs stay on the seat. */
export function hostsFile(): string {
	return process.env.LIMEN_HOSTS_FILE?.trim() || join(seatDir(), "hosts.json");
}

export function loadHostPool(): HostPool {
	const path = hostsFile();
	if (!existsSync(path)) {
		return { overflow: false, hosts: [], ignored: [] };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		throw new Error(`${path} is not JSON`);
	}
	return parseHostPool(parsed, path);
}

/** True when this job might leave the seat: an explicit host, overflow, or a hosts file that must be reported. */
export function remoteLaunchPossible(engine: string, grouped: boolean): boolean {
	if (grouped || engine !== "pi") {
		return false;
	}
	if (process.env.LIMEN_HOST?.trim()) {
		return true;
	}
	if (!existsSync(hostsFile())) {
		return false;
	}
	try {
		return loadHostPool().overflow;
	} catch {
		return true;
	}
}

export function explicitHostName(): string {
	return process.env.LIMEN_HOST?.trim() ?? "";
}

/**
 * Refuses a remote launch that cannot be honest: groups stay on the seat, hosted tabs stay in Herdr, and only Pi
 * runs on a host. An unknown or disabled alias fails before a job record exists.
 */
export function validateRemoteLaunch(
	pool: HostPool,
	host: string | undefined,
	input: { readonly tab: boolean; readonly grouped: boolean; readonly engine: string },
): void {
	if (!host) {
		return;
	}
	if (input.grouped) {
		throw new Error("--host cannot join a group; the seat runs group members");
	}
	if (input.tab) {
		throw new Error("--host runs detached on the seat; omit --tab");
	}
	if (input.engine !== "pi") {
		throw new Error("--host runs Pi; omit it or pass --engine pi");
	}
	const found = pool.hosts.find((candidate) => candidate.alias === host);
	if (!found) {
		throw new Error(`--host ${host} is not in ${hostsFile()}`);
	}
	if (!found.enabled) {
		throw new Error(`--host ${host} is disabled`);
	}
}

/**
 * The host this job runs on, or undefined to stay on the seat. An explicit `LIMEN_HOST` is reserved even when the
 * seat's gate is open. Overflow runs only when that gate is closed and some enabled host is under its cap and its
 * own load clears the same gate.
 */
export async function assignedHost(jobDir: string, stop: AbortSignal): Promise<RemoteHost | undefined> {
	const pool = loadHostPool();
	if (pool.ignored.length > 0) {
		await appendLimenLog(jobDir, `hosts.json: ignored ${pool.ignored.join("; ")}`);
	}
	const explicit = explicitHostName();
	if (explicit) {
		return claimExplicit(jobDir, pool, explicit);
	}
	if (!pool.overflow || stop.aborted) {
		return undefined;
	}
	const gate = startGate().gate;
	if (!gate) {
		return undefined;
	}
	const reading = await readLoad(stop).catch(() => undefined);
	if (!reading || stop.aborted || readingClears(reading, gate)) {
		return undefined;
	}
	const chosen = await pickHost(pool.hosts, gate, stop);
	if (!chosen) {
		await appendLimenLog(jobDir, "remote hosts: none free; staying on the seat");
		return undefined;
	}
	return claim(jobDir, chosen, false);
}

/** Enabled hosts under their cap whose probe clears `gate`, freest slot first, then idlest CPU, then alias. */
export function rankHosts(
	hosts: readonly RemoteHost[],
	running: Readonly<Record<string, number>>,
	readings: Readonly<Record<string, Reading | undefined>>,
	gate: Pick<StartGate, "cpuIdle" | "memoryFree">,
): RemoteHost | undefined {
	const ready = hosts.filter((host) => {
		if (!host.enabled || (running[host.alias] ?? 0) >= host.maxConcurrent) {
			return false;
		}
		const reading = readings[host.alias];
		return reading !== undefined && readingClears(reading, gate);
	});
	ready.sort((a, b) => {
		const free = (host: RemoteHost) => host.maxConcurrent - (running[host.alias] ?? 0);
		const idle = (host: RemoteHost) => readings[host.alias]?.cpuIdle ?? -1;
		return free(b) - free(a) || idle(b) - idle(a) || a.alias.localeCompare(b.alias);
	});
	return ready[0];
}

export function parseHostPool(parsed: unknown, path: string): HostPool {
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`${path} must be a JSON object`);
	}
	const body = parsed as Record<string, unknown>;
	const ignored: string[] = [];
	if (body.overflow !== undefined && typeof body.overflow !== "boolean") {
		throw new Error(`${path} overflow must be true or false`);
	}
	if (!Array.isArray(body.hosts)) {
		throw new Error(`${path} hosts must be an array`);
	}
	for (const key of Object.keys(body)) {
		if (key !== "overflow" && key !== "hosts") {
			ignored.push(key);
		}
	}
	const hosts = body.hosts.map((entry, index) => parseHost(entry, path, index, ignored));
	const aliases = new Set<string>();
	for (const host of hosts) {
		if (aliases.has(host.alias)) {
			throw new Error(`${path} lists ${host.alias} twice`);
		}
		aliases.add(host.alias);
	}
	return { overflow: body.overflow === true, hosts, ignored };
}

function parseHost(entry: unknown, path: string, index: number, ignored: string[]): RemoteHost {
	if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
		throw new Error(`${path} hosts[${index}] must be an object`);
	}
	const body = entry as Record<string, unknown>;
	const alias = requireString(body, "alias", path, index);
	if (!ALIAS.test(alias)) {
		throw new Error(`${path} hosts[${index}] alias must be a short lowercase name`);
	}
	const ssh = requireString(body, "ssh", path, index);
	if (!SSH_TARGET.test(ssh)) {
		throw new Error(`${path} host ${alias} ssh target has spaces or shell characters; use a Host alias`);
	}
	const platform = requireString(body, "platform", path, index);
	if (platform !== "darwin" && platform !== "windows-wsl") {
		throw new Error(`${path} host ${alias} platform must be darwin or windows-wsl`);
	}
	const root = posixPath(requireString(body, "root", path, index), path, alias, "root");
	const hook = posixPath(requireString(body, "hook", path, index), path, alias, "hook");
	const maxConcurrent = requireCount(body.maxConcurrent, path, alias);
	const enabled = body.enabled === undefined ? true : body.enabled;
	if (typeof enabled !== "boolean") {
		throw new Error(`${path} host ${alias} enabled must be true or false`);
	}
	const distro = body.distro === undefined ? "Ubuntu" : body.distro;
	if (typeof distro !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,40}$/.test(distro)) {
		throw new Error(`${path} host ${alias} distro must be a WSL distribution name`);
	}
	const pathPrefix = body.path === undefined ? "" : body.path;
	if (typeof pathPrefix !== "string" || /[\0\r\n]/.test(pathPrefix)) {
		throw new Error(`${path} host ${alias} path must be one line`);
	}
	for (const key of Object.keys(body)) {
		if (!["alias", "ssh", "platform", "root", "hook", "maxConcurrent", "enabled", "distro", "path"].includes(key)) {
			ignored.push(`${alias}.${key}`);
		}
	}
	return {
		alias,
		ssh,
		platform: platform as HostPlatform,
		root,
		hook,
		maxConcurrent,
		enabled,
		distro,
		path: pathPrefix,
	};
}

function requireString(body: Record<string, unknown>, key: string, path: string, index: number): string {
	const value = body[key];
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${path} hosts[${index}] ${key} must be a non-empty string`);
	}
	return value.trim();
}

function posixPath(value: string, path: string, alias: string, key: string): string {
	if (!value.startsWith("/") || value.includes("\0") || /[\r\n]/.test(value)) {
		throw new Error(`${path} host ${alias} ${key} must be an absolute POSIX path`);
	}
	return value.replace(/\/+$/, "") || "/";
}

function requireCount(value: unknown, path: string, alias: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		throw new Error(`${path} host ${alias} maxConcurrent must be a whole number of at least 1`);
	}
	return value;
}

function readingClears(reading: Reading, gate: Pick<StartGate, "cpuIdle" | "memoryFree">): boolean {
	return (reading.cpuIdle ?? 100) >= gate.cpuIdle && (reading.memoryFree ?? 100) >= gate.memoryFree;
}

async function claimExplicit(jobDir: string, pool: HostPool, alias: string): Promise<RemoteHost> {
	const host = pool.hosts.find((candidate) => candidate.alias === alias);
	if (!host) {
		throw new Error(`--host ${alias} is not in ${hostsFile()}`);
	}
	if (!host.enabled) {
		throw new Error(`--host ${alias} is disabled`);
	}
	const claimed = await claim(jobDir, host, true);
	if (!claimed) {
		throw new Error(`--host ${alias} is disabled`);
	}
	return claimed;
}

async function pickHost(
	hosts: readonly RemoteHost[],
	gate: StartGate,
	stop: AbortSignal,
): Promise<RemoteHost | undefined> {
	const enabled = hosts.filter((host) => host.enabled);
	const running: Record<string, number> = {};
	for (const host of enabled) {
		running[host.alias] = await runningOnHost(host.alias);
	}
	const readings: Record<string, Reading | undefined> = {};
	for (const host of enabled) {
		if (stop.aborted || (running[host.alias] ?? 0) >= host.maxConcurrent) {
			continue;
		}
		readings[host.alias] = await probeHost(host, stop);
	}
	return rankHosts(enabled, running, readings, gate);
}

/** Live seat jobs already reserved on this host. `except` is the job taking a slot, so it does not count itself. */
export async function runningOnHost(alias: string, except?: string): Promise<number> {
	const roots = new Set(registeredProjects());
	const context = process.env.LIMEN_CONTEXT_ROOT;
	if (context) {
		roots.add(context);
	}
	let count = 0;
	for (const root of roots) {
		const jobs = join(root, ".limen", "jobs");
		for (const id of await readdir(jobs).catch(() => [] as string[])) {
			const dir = join(jobs, id);
			if (dir === except || (await textFile(join(dir, "host"))) !== alias) {
				continue;
			}
			if (await hostJobLive(dir)) {
				count += 1;
			}
		}
	}
	return count;
}

async function claim(jobDir: string, host: RemoteHost, explicit: boolean): Promise<RemoteHost | undefined> {
	return groupLock(join(seatDir(), "host-claims"), async () => {
		const running = await runningOnHost(host.alias, jobDir);
		if (running >= host.maxConcurrent) {
			if (explicit) {
				throw new Error(`--host ${host.alias} is running ${running} of ${host.maxConcurrent} jobs`);
			}
			return undefined;
		}
		await atomicWrite(`${jobDir}/host`, `${host.alias}\n`);
		return host;
	});
}

export async function probeHost(host: RemoteHost, stop: AbortSignal): Promise<Reading | undefined> {
	const fixed = process.env.LIMEN_HOST_READING?.trim();
	const sample = Number(process.env.LIMEN_HOST_PROBE_MS);
	const script = probeScript(Number.isFinite(sample) ? sample : 400, fixed || undefined);
	const result = await shellText(host, script, 20_000, stop);
	if (result.code !== 0) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(result.stdout) as Partial<Reading>;
		return { cpuIdle: percent(parsed.cpuIdle), memoryFree: percent(parsed.memoryFree) };
	} catch {
		return undefined;
	}
}

function percent(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : undefined;
}

async function hostJobLive(jobDir: string): Promise<boolean> {
	if ((await textFile(`${jobDir}/state`)) !== "running") {
		return false;
	}
	const pid = Number(await textFile(`${jobDir}/pid`));
	if (!Number.isSafeInteger(pid) || pid <= 0) {
		return true;
	}
	return processAlive(pid);
}

export function assertJobSegment(jobId: string): void {
	if (!SEGMENT.test(jobId)) {
		throw new Error(`job id ${jobId} is not a single path segment`);
	}
}
