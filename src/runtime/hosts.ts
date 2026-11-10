import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { groupLock } from "../job/group-cabinet.ts";
import { appendLimenLog, atomicWrite, textFile } from "../job/record.ts";
import { registeredProjects, seatDir } from "../project/seat.ts";
import { processAlive } from "./contain.ts";
import { ENGINES, engineRoute } from "./engine.ts";
import {
	type HostClone,
	type HostPlatform,
	hostEngineScript,
	originProbeScript,
	probeScript,
	type RemoteHost,
	shellText,
} from "./host-shell.ts";
import { type Reading, readLoad, type StartGate, startGate } from "./start-queue.ts";

export type { HostPlatform, RemoteHost };

export type HostPool = {
	readonly overflow: boolean;
	/** Delete `limen/<id>` on origin after a host job fast-forwards. */
	readonly pruneBranches: boolean;
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
		return { overflow: false, pruneBranches: false, hosts: [], ignored: [] };
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
	const project = jobProject();
	const explicit = explicitHostName();
	if (explicit) {
		return claimExplicit(jobDir, pool, explicit, project);
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
	return overflowHost(jobDir, pool.hosts, project, gate, stop);
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
	if (body.pruneBranches !== undefined && typeof body.pruneBranches !== "boolean") {
		throw new Error(`${path} pruneBranches must be true or false`);
	}
	if (!Array.isArray(body.hosts)) {
		throw new Error(`${path} hosts must be an array`);
	}
	for (const key of Object.keys(body)) {
		if (key !== "overflow" && key !== "hosts" && key !== "pruneBranches") {
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
	return { overflow: body.overflow === true, pruneBranches: body.pruneBranches === true, hosts, ignored };
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
	const { shorthand, clones } = parseClones(body, path, alias);
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
	const model = body.model === undefined ? "" : body.model;
	if (typeof model !== "string" || (model !== "" && !/^[A-Za-z0-9._:@+/-]{1,160}$/.test(model))) {
		throw new Error(`${path} host ${alias} model must be a model id`);
	}
	for (const key of Object.keys(body)) {
		if (
			![
				"alias",
				"ssh",
				"platform",
				"root",
				"roots",
				"hook",
				"maxConcurrent",
				"enabled",
				"distro",
				"path",
				"model",
			].includes(key)
		) {
			ignored.push(`${alias}.${key}`);
		}
	}
	return {
		alias,
		ssh,
		platform: platform as HostPlatform,
		root: shorthand,
		shorthand,
		clones,
		hook,
		maxConcurrent,
		enabled,
		distro,
		path: pathPrefix,
		model,
	};
}

/** The named host. Throws when the alias is missing; a disabled host is still returned so the caller can say why. */
export function hostByAlias(pool: HostPool, alias: string): RemoteHost {
	const host = pool.hosts.find((candidate) => candidate.alias === alias);
	if (!host) {
		throw new Error(`--host ${alias} is not in ${hostsFile()}`);
	}
	return host;
}

/** Pi and, when the model is bridged, the Claude bridge, on the host. The seat's PATH is not consulted. */
export async function assertHostEngine(host: RemoteHost, model?: string, provider?: string): Promise<void> {
	const bridged = engineRoute(ENGINES.pi, provider, model).bridged;
	const result = await shellText(host, hostEngineScript(host, bridged), 25_000);
	if (result.code === 0) {
		return;
	}
	const detail = `${result.stdout}\n${result.stderr}`
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line && !line.startsWith("pi ok"));
	throw new Error(`host ${host.alias}: ${detail || "Pi check failed"}`);
}

/**
 * Refuses `--host` when this host has no clone of `project`. The message names the project's origin and the clones
 * the host does have. Spawn and continue call this before a job record exists.
 */
export async function assertHostProject(host: RemoteHost, project: string): Promise<void> {
	const origin = localOrigin(project);
	if (!origin) {
		throw new Error(`--host ${host.alias}: ${project} has no origin remote`);
	}
	const located = await locateRoot(host, origin);
	if (!located.path) {
		throw new Error(located.note);
	}
}

/** The clone of `origin` on this host, if the shorthand or a `roots` entry matches. */
export async function matchProjectRoot(host: RemoteHost, origin: string): Promise<string | undefined> {
	return (await locateRoot(host, origin)).path;
}

/**
 * `owner/repo` for a GitHub-style remote or a two-segment name. A local path stays as written, without a trailing
 * `.git`, so two checkouts of one bare repo still match.
 */
export function originKey(value: string): string {
	const stripped = value
		.trim()
		.replace(/\.git$/i, "")
		.replace(/\/+$/, "");
	if (stripped.startsWith("/") || stripped.startsWith("file:")) {
		return stripped;
	}
	if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(stripped)) {
		return stripped.toLowerCase();
	}
	const url = httpish(stripped);
	if (url) {
		return url;
	}
	const scp = /^(?:[^@\s/]+@)?[^:\s/]+:([^/\s]+)\/([^/\s]+)$/.exec(stripped);
	if (scp?.[1] && scp[2]) {
		return `${scp[1]}/${scp[2]}`.toLowerCase();
	}
	return stripped.toLowerCase();
}

/** The host's model when spawn or continue did not pass `--model`. */
export function hostModel(alias: string | undefined): string | undefined {
	if (!alias) {
		return undefined;
	}
	const model = hostByAlias(loadHostPool(), alias).model;
	return model || undefined;
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

async function claimExplicit(jobDir: string, pool: HostPool, alias: string, project: string): Promise<RemoteHost> {
	const host = pool.hosts.find((candidate) => candidate.alias === alias);
	if (!host) {
		throw new Error(`--host ${alias} is not in ${hostsFile()}`);
	}
	if (!host.enabled) {
		throw new Error(`--host ${alias} is disabled`);
	}
	const bound = await bindProject(host, project);
	const claimed = await claim(jobDir, bound, true);
	if (!claimed) {
		throw new Error(`--host ${alias} is disabled`);
	}
	return claimed;
}

async function overflowHost(
	jobDir: string,
	hosts: readonly RemoteHost[],
	project: string,
	gate: StartGate,
	stop: AbortSignal,
): Promise<RemoteHost | undefined> {
	const origin = project ? localOrigin(project) : undefined;
	if (!origin) {
		await appendLimenLog(jobDir, "remote hosts: this project has no origin; staying on the seat");
		return undefined;
	}
	const eligible: RemoteHost[] = [];
	for (const host of hosts) {
		if (!host.enabled || stop.aborted) {
			continue;
		}
		const located = await locateRoot(host, origin);
		if (located.path) {
			eligible.push({ ...host, root: located.path });
		}
	}
	if (eligible.length === 0) {
		await appendLimenLog(jobDir, `remote hosts: none have a clone of ${originKey(origin)}; staying on the seat`);
		return undefined;
	}
	const chosen = await pickHost(eligible, gate, stop);
	if (!chosen) {
		await appendLimenLog(jobDir, "remote hosts: none free; staying on the seat");
		return undefined;
	}
	return claim(jobDir, chosen, false);
}

async function bindProject(host: RemoteHost, project: string): Promise<RemoteHost> {
	const origin = project ? localOrigin(project) : undefined;
	if (!origin) {
		throw new Error(`--host ${host.alias}: ${project || "this project"} has no origin remote`);
	}
	const located = await locateRoot(host, origin);
	if (!located.path) {
		throw new Error(located.note);
	}
	return { ...host, root: located.path };
}

type Located =
	| { readonly path: string; readonly note?: undefined }
	| { readonly path?: undefined; readonly note: string };

const cloneOrigins = new Map<string, string | undefined>();

async function locateRoot(host: RemoteHost, origin: string): Promise<Located> {
	const want = originKey(origin);
	for (const clone of host.clones) {
		if (originKey(clone.key) === want) {
			return { path: clone.path };
		}
	}
	const notes = host.clones.map((clone) => originKey(clone.key));
	if (host.shorthand) {
		const found = await readCloneOrigin(host, host.shorthand);
		if (found && originKey(found) === want) {
			return { path: host.shorthand };
		}
		notes.push(found ? `${originKey(found)} at ${host.shorthand}` : `${host.shorthand} origin unreadable`);
	}
	const have = notes.length > 0 ? `; this host has ${notes.join(", ")}` : "";
	return { note: `--host ${host.alias} has no root for ${want}${have}` };
}

async function readCloneOrigin(host: RemoteHost, path: string): Promise<string | undefined> {
	const cacheKey = `${host.ssh}\0${path}`;
	if (cloneOrigins.has(cacheKey)) {
		return cloneOrigins.get(cacheKey);
	}
	const result = await shellText(host, originProbeScript(path), 20_000);
	const line = result.stdout
		.split("\n")
		.map((item) => item.trim())
		.find((item) => item && item !== "missing");
	const origin = result.code === 0 ? line : undefined;
	cloneOrigins.set(cacheKey, origin);
	return origin;
}

function jobProject(): string {
	return process.env.LIMEN_WORKTREE?.trim() || process.env.LIMEN_CONTEXT_ROOT?.trim() || "";
}

function localOrigin(cwd: string): string | undefined {
	if (!cwd) {
		return undefined;
	}
	const result = spawnSync("git", ["remote", "get-url", "origin"], { cwd, encoding: "utf8" });
	const url = result.stdout?.trim();
	return result.status === 0 && url ? url : undefined;
}

function httpish(value: string): string | undefined {
	try {
		const url = new URL(value);
		if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "ssh:" && url.protocol !== "git:") {
			return undefined;
		}
		const parts = url.pathname.split("/").filter(Boolean);
		const owner = parts.at(-2);
		const repo = parts.at(-1);
		return owner && repo ? `${owner}/${repo}`.toLowerCase() : undefined;
	} catch {
		return undefined;
	}
}

function parseClones(
	body: Record<string, unknown>,
	path: string,
	alias: string,
): { shorthand: string; clones: HostClone[] } {
	const shorthand = parseShorthand(body, path, alias);
	const clones = parseRootMap(body.roots, path, alias);
	if (!shorthand && clones.length === 0) {
		throw new Error(`${path} host ${alias} needs root or roots`);
	}
	const seen = new Set<string>();
	const paths = new Set<string>(shorthand ? [shorthand] : []);
	for (const clone of clones) {
		const key = originKey(clone.key);
		if (seen.has(key)) {
			throw new Error(`${path} host ${alias} lists ${clone.key} twice`);
		}
		seen.add(key);
		if (paths.has(clone.path)) {
			throw new Error(`${path} host ${alias} lists ${clone.path} twice`);
		}
		paths.add(clone.path);
	}
	return { shorthand, clones };
}

function parseShorthand(body: Record<string, unknown>, path: string, alias: string): string {
	if (body.root === undefined) {
		return "";
	}
	if (typeof body.root !== "string" || !body.root.trim()) {
		throw new Error(`${path} host ${alias} root must be an absolute POSIX path`);
	}
	return posixPath(body.root.trim(), path, alias, "root");
}

function parseRootMap(value: unknown, path: string, alias: string): HostClone[] {
	if (value === undefined) {
		return [];
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${path} host ${alias} roots must be an object`);
	}
	const clones: HostClone[] = [];
	for (const [rawKey, rawPath] of Object.entries(value)) {
		const key = rawKey.trim();
		if (!key || /[\0\r\n\s]/.test(key)) {
			throw new Error(`${path} host ${alias} roots key must be an origin url or owner/repo`);
		}
		if (typeof rawPath !== "string" || !rawPath.trim()) {
			throw new Error(`${path} host ${alias} roots ${key} must be an absolute POSIX path`);
		}
		clones.push({ key, path: posixPath(rawPath.trim(), path, alias, "roots") });
	}
	return clones;
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
