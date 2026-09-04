import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";

export type HerdrPlace = { readonly workspace: string; readonly tab: string; readonly pane: string; readonly mode: "watch" | "log" | "hosted" | "diff" };
export type HostedAgentStatus = "idle" | "working" | "blocked" | "done" | "unknown" | "missing";

export function herdrAvailable(): boolean {
	return process.env.HERDR_ENV === "1" && Boolean(herdrBinary());
}

export async function openWatchTab(input: { readonly jobDir: string; readonly label: string; readonly cwd: string; readonly logPath: string }): Promise<HerdrPlace | undefined> {
	if (process.env.HERDR_ENV !== "1") return;
	return createTab({ ...input, mode: "watch", follow: true, focus: false });
}

export async function openHostedTab(input: {
	readonly jobDir: string;
	readonly label: string;
	readonly cwd: string;
	readonly workspaceCwd?: string;
	readonly env: Readonly<Record<string, string>>;
}): Promise<HerdrPlace> {
	if (!herdrAvailable()) throw new Error("hosted spawn requires Herdr (HERDR_ENV=1); use an ordinary job instead");
	const place = await createTab({
		jobDir: input.jobDir,
		label: input.label,
		cwd: input.cwd,
		workspaceCwd: input.workspaceCwd ?? input.cwd,
		logPath: `${input.jobDir}/log`,
		mode: "hosted",
		follow: false,
		focus: false,
		env: input.env,
		shellOnly: true,
	});
	if (!place) throw new Error("herdr skipped opening the hosted tab");
	return place;
}

export function startHostedPi(input: {
	readonly place: HerdrPlace;
	readonly name: string;
	readonly args: readonly string[];
	readonly timeoutMs?: number;
	readonly coordinatorTab?: string;
	readonly stopped?: () => boolean;
	readonly log?: (message: string) => void;
}): string {
	const herdr = requireHerdr();
	const readyMs = input.timeoutMs ?? 5_000;
	assertHostedStartActive(input.stopped);
	waitForShell(herdr, input.place.pane, 60_000, input.stopped);
	assertHostedStartActive(input.stopped);
	// Herdr 0.8 will not start an agent in a background pane. Focus, start, then restore.
	call(herdr, ["tab", "focus", input.place.tab]);
	try {
		assertHostedStartActive(input.stopped);
		waitForShell(herdr, input.place.pane, 15_000, input.stopped);
		assertHostedStartActive(input.stopped);
		let failed: unknown;
		for (const attempt of [1, 2] as const) {
			assertHostedStartActive(input.stopped);
			input.log?.(`hosted agent start attempt ${attempt}`);
			try {
				const started = call(herdr, ["agent", "start", input.name, "--kind", "pi", "--pane", input.place.pane, "--timeout", String(readyMs), "--", ...input.args], readyMs + 250);
				return agentTarget(started) || input.place.pane;
			} catch (error) {
				failed = error;
				const paneShellFailure = error instanceof Error && error.message === `agent target pane ${input.place.pane} is not an available shell`;
				if (attempt === 1 && paneShellFailure) {
					input.log?.(`hosted agent start attempt 1 failed: ${error.message}; waiting for shell before attempt 2`);
					try {
						waitForShell(herdr, input.place.pane, 15_000, input.stopped);
					} catch (waitError) {
						failed = waitError;
						break;
					}
					continue;
				}
				break;
			}
		}
		const live = locateHostedAgent(input.place.pane);
		if (live) {
			input.log?.(`hosted agent ready after start warning: ${failed instanceof Error ? failed.message : String(failed)}`);
			return live;
		}
		throw failed;
	} finally {
		const coordinator = input.coordinatorTab?.trim();
		if (coordinator && coordinator !== input.place.tab) restoreCoordinatorFocus(herdr, input.place.tab, coordinator, input.log);
	}
}

function assertHostedStartActive(stopped?: () => boolean): void {
	if (stopped?.()) throw Object.assign(new Error("hosted start stopped by request"), { code: "hosted_start_stopped" });
}

/** Give the coordinator its tab back only when the human has not already focused elsewhere during the start window. */
function restoreCoordinatorFocus(herdr: string, jobTab: string, coordinatorTab: string, log?: (message: string) => void): void {
	let focused: boolean | undefined;
	try {
		const row = asRecord(asRecord(call(herdr, ["tab", "get", jobTab])).tab);
		focused = typeof row.focused === "boolean" ? row.focused : undefined;
	} catch (error) {
		log?.(`focus check failed after hosted start: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (focused === false) {
		log?.("focus restore skipped: another tab took focus during hosted start");
		return;
	}
	try {
		call(herdr, ["tab", "focus", coordinatorTab]);
		log?.(`coordinator tab restored${focused === undefined ? " (focus state unknown)" : ""}`);
	} catch (error) {
		log?.(`focus restore failed: ${error instanceof Error ? error.message : String(error)}; the job tab keeps focus`);
	}
}

/** True when a hosted agent is still present on the pane or under the given name. */
export function hostedAgentAlive(target: string): boolean {
	// Herdr `done` is unseen idle (tab never focused), not process exit. Only missing is gone.
	return hostedAgentStatus(target) !== "missing";
}

/** Hosted jobs end when the session ends or the agent is gone. Herdr idle/done is unseen background, not completion. */
export function hostedTerminalReason(status: HostedAgentStatus, sessionEnded: boolean): "hosted session ended" | "hosted agent ended" | undefined {
	if (sessionEnded) return "hosted session ended";
	if (status === "missing") return "hosted agent ended";
}

/** Live target for a hosted job whose recorded target stopped resolving cleanly: the agent found under a moved pane ID, or an unclassifiable but present process on the recorded pane. Undefined means genuinely gone. */
export function locateHostedAgent(target: string, agentName = ""): string | undefined {
	if (hostedAgentStatus(target) !== "missing") return target;
	const herdr = herdrBinary();
	if (!herdr) return;
	try {
		const agents = asRecord(call(herdr, ["agent", "list"])).agents;
		if (Array.isArray(agents)) {
			for (const row of agents) {
				const agent = asRecord(row);
				if (agent.pane_id === target) return target;
				const name = String(asRecord(agent.agent).name ?? agent.name ?? "");
				const rowPane = typeof agent.pane_id === "string" ? agent.pane_id : undefined;
				if (agentName && rowPane && (name === agentName || name.startsWith(`${agentName}-`))) return rowPane;
			}
		}
	} catch {
		// Fall through to process probe.
	}
	try {
		const info = asRecord(asRecord(call(herdr, ["pane", "process-info", "--pane", target])).process_info);
		const foreground = Array.isArray(info.foreground_processes) ? info.foreground_processes : [];
		const names = foreground.map((row) => String(asRecord(row).name ?? "").toLowerCase());
		if (names.some((n) => n === "pi" || n === "node")) return target;
	} catch {
		// Missing.
	}
}

const SHELL_NAMES = new Set(["zsh", "bash", "sh", "fish", "nu", "pwsh", "powershell"]);
/** Pane must be at an interactive shell before `agent start`; new tabs often still run prompt hooks. */
function waitForShell(herdr: string, pane: string, timeoutMs: number, stopped?: () => boolean): void {
	const deadline = Date.now() + timeoutMs;
	let last = "";
	while (Date.now() < deadline) {
		assertHostedStartActive(stopped);
		try {
			const info = asRecord(asRecord(call(herdr, ["pane", "process-info", "--pane", pane])).process_info);
			const foreground = Array.isArray(info.foreground_processes) ? info.foreground_processes : [];
			const only = asRecord(foreground[0]);
			const name = String(only.name ?? "")
				.replace(/^-/, "")
				.toLowerCase();
			const pid = Number(only.pid);
			last = name || "none";
			const aligned = !Number.isFinite(pid) || [info.shell_pid, info.foreground_process_group_id].every((value) => !Number.isFinite(Number(value)) || Number(value) === pid);
			if (foreground.length === 1 && SHELL_NAMES.has(name) && aligned) return;
		} catch (error) {
			last = error instanceof Error ? error.message : String(error);
		}
		spawnSync("sleep", ["0.2"], { stdio: "ignore" });
	}
	throw new Error(`hosted pane ${pane} did not become an idle shell (last: ${last})`);
}

const lastHostedStatus = new Map<string, HostedAgentStatus>();
const lastHostedFault = new Map<string, string>();

export function hostedAgentStatus(target: string): HostedAgentStatus {
	const herdr = herdrBinary();
	if (!herdr) return noteHostedFault(target, "herdr_unavailable");
	try {
		const row = asRecord(call(herdr, ["agent", "get", target]));
		const raw = asRecord(row.agent).agent_status ?? row.agent_status;
		const status = raw === "idle" || raw === "working" || raw === "blocked" || raw === "done" || raw === "unknown" ? raw : "unknown";
		lastHostedStatus.set(target, status);
		lastHostedFault.delete(target);
		return status;
	} catch (error) {
		const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && error.code ? error.code : "herdr_error";
		if (code === "agent_not_found" || code === "target_not_found") {
			lastHostedStatus.delete(target);
			lastHostedFault.delete(target);
			return "missing";
		}
		return noteHostedFault(target, code);
	}
}

function noteHostedFault(target: string, code: string): HostedAgentStatus {
	if (lastHostedFault.get(target) !== code) {
		lastHostedFault.set(target, code);
		const jobDir = process.env.LIMEN_JOB_DIR?.trim();
		if (jobDir) void appendFile(`${jobDir}/log`, `[limen ${new Date().toISOString()}] herdr agent get failed: ${code}\n`);
	}
	return lastHostedStatus.get(target) ?? "unknown";
}

export function stopHostedAgent(target: string): void {
	const herdr = herdrBinary();
	if (!herdr) return;
	try {
		call(herdr, ["agent", "send-keys", target, "ctrl+c"]);
		spawnSync("sleep", ["0.2"], { stdio: "ignore" });
		call(herdr, ["agent", "send-keys", target, "ctrl+c"]);
	} catch {
		// Best-effort; supervisor finalizes when the agent disappears.
	}
}

/** Make a hosted stall visible without depending on a coordinator session. */
export function reportHostedStall(input: { readonly pane: string; readonly label: string; readonly duration: string; readonly notify: boolean }): void {
	const herdr = herdrBinary();
	if (!herdr) return;
	const stalled = `⚠ stalled ${input.duration}`;
	if (input.pane) {
		advisoryCall(herdr, [
			"pane",
			"report-metadata",
			input.pane,
			"--source",
			"limen",
			"--display-agent",
			stalled,
			"--state-label",
			`idle=${stalled}`,
			"--state-label",
			`done=${stalled}`,
			"--state-label",
			`blocked=${stalled}`,
		]);
	}
	if (input.notify) advisoryCall(herdr, ["notification", "show", `limen: ${input.label} stalled`, "--body", stalled, "--sound", "request"]);
}

/** Restore the role description installed by the hosted hook after a stall recovers. */
export function restoreHostedPane(pane: string, role: "worker" | "reviewer"): void {
	const herdr = herdrBinary();
	if (!herdr) return;
	advisoryCall(herdr, ["pane", "report-metadata", pane, "--source", "limen", "--display-agent", `limen ${role}`, "--clear-state-labels"]);
}

/** Terminal jobs leave no open tabs: close the recorded place. Job files and `limen open` remain the record. */
export async function settleJobTab(jobDir: string): Promise<void> {
	const place = await readPlace(jobDir);
	if (!place) return;
	const herdr = herdrBinary();
	if (!herdr) return skip(jobDir, "herdr is not available");
	try {
		const child = spawn(herdr, ["tab", "close", place.tab], { detached: true, stdio: "ignore" });
		child.unref();
	} catch (error) {
		await skip(jobDir, error instanceof Error ? error.message : String(error));
	}
}

export async function openDiffTab(input: {
	readonly jobDir: string;
	readonly label: string;
	readonly cwd: string;
	readonly workspaceCwd: string;
	readonly hunk: string;
	readonly args: readonly string[];
}): Promise<string> {
	const herdr = requireHerdr();
	const recorded = await readPlace(input.jobDir, "diff");
	if (recorded && tabExists(herdr, recorded.tab)) {
		call(herdr, ["tab", "focus", recorded.tab]);
		return `focused ${input.label} diff`;
	}
	const place = await createTab({
		jobDir: input.jobDir,
		label: `${input.label} · diff`,
		cwd: input.cwd,
		workspaceCwd: input.workspaceCwd,
		logPath: `${input.jobDir}/log`,
		mode: "diff",
		follow: false,
		focus: true,
		herdr,
		shellOnly: true,
		record: "diff",
	});
	if (!place) throw new Error("herdr skipped opening the diff tab");
	call(herdr, ["pane", "run", place.pane, input.hunk, ...input.args]);
	return `opened ${input.label} diff`;
}

export async function openJobPlace(input: { readonly jobDir: string; readonly cwd: string; readonly running: boolean }): Promise<string> {
	const herdr = herdrBinary();
	if (!herdr) throw new Error("herdr is not available");
	const label = (await text(`${input.jobDir}/label`)) || basename(input.jobDir);
	const recorded = await readPlace(input.jobDir);
	const hosted = Boolean(await text(`${input.jobDir}/hosted`));
	try {
		if (recorded && tabExists(herdr, recorded.tab)) {
			call(herdr, ["tab", "focus", recorded.tab]);
			return `focused ${label}`;
		}
	} catch (error) {
		await skip(input.jobDir, error instanceof Error ? error.message : String(error));
	}
	// Hosted agents die with their tab; reopen is always a log view, never a resurrection.
	const state = (await text(`${input.jobDir}/state`)) || "done";
	const watch = input.running && !hosted;
	const place = await createTab({
		jobDir: input.jobDir,
		label: input.running ? label : `${label} · ${state}`,
		cwd: input.cwd,
		logPath: `${input.jobDir}/log`,
		mode: watch ? "watch" : "log",
		follow: watch,
		focus: true,
		herdr,
	});
	if (!place) throw new Error("herdr skipped");
	return `opened ${label}`;
}

export async function closeFeatureTabs(input: { readonly root: string; readonly feature: string }): Promise<string> {
	const feature = /(?:^|\/)(F\d+)/i.exec(input.feature.trim())?.[1]?.toUpperCase();
	if (!feature) throw new Error("close requires a feature like F012");
	if (!(await terminalFeature(input.root, feature))) throw new Error(`${feature} is not in done/ or dropped/; leftover tabs stay`);
	const herdr = herdrBinary();
	if (!herdr) throw new Error("herdr is not available");
	const coordinator = process.env.HERDR_TAB_ID?.trim();
	const entries = await readdir(`${input.root}/.limen/jobs`, { withFileTypes: true }).catch(() => []);
	let closed = 0;
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const jobDir = `${input.root}/.limen/jobs/${entry.name}`;
		if (!new RegExp(`\\b${feature}\\b`, "i").test(`${await text(`${jobDir}/label`)}\n${entry.name}`)) continue;
		const places = await Promise.all([readPlace(jobDir), readPlace(jobDir, "diff")]);
		for (const place of places) {
			if (!place || place.tab === coordinator) continue;
			try {
				call(herdr, ["tab", "close", place.tab]);
				closed += 1;
			} catch (error) {
				await skip(jobDir, error instanceof Error ? error.message : String(error));
			}
		}
	}
	return `closed ${closed} leftover tab${closed === 1 ? "" : "s"} for ${feature}`;
}

async function createTab(input: {
	readonly jobDir: string;
	readonly label: string;
	readonly cwd: string;
	readonly workspaceCwd?: string;
	readonly logPath: string;
	readonly mode: HerdrPlace["mode"];
	readonly follow: boolean;
	readonly focus: boolean;
	readonly herdr?: string;
	readonly env?: Readonly<Record<string, string>>;
	readonly shellOnly?: boolean;
	readonly record?: "diff";
}): Promise<HerdrPlace | undefined> {
	const herdr = input.herdr ?? herdrBinary();
	if (!herdr) {
		await skip(input.jobDir, "herdr is not available");
		return;
	}
	try {
		const workspace = ensureWorkspace(herdr, input.workspaceCwd ?? input.cwd);
		const envArgs = Object.entries(input.env ?? {}).flatMap(([key, value]) => ["--env", `${key}=${value}`]);
		const created = call(herdr, ["tab", "create", "--workspace", workspace, "--label", input.label, "--cwd", input.cwd, ...envArgs, input.focus ? "--focus" : "--no-focus"]);
		const place: HerdrPlace = { workspace, tab: id(created, "tab", "tab_id"), pane: id(created, "root_pane", "pane_id"), mode: input.mode };
		await recordPlace(input.jobDir, place, input.record);
		if (!input.shellOnly) {
			call(herdr, input.follow ? ["pane", "run", place.pane, "tail", "-f", input.logPath] : ["pane", "run", place.pane, "tail", "-n", "+1", input.logPath]);
		}
		return place;
	} catch (error) {
		await skip(input.jobDir, error instanceof Error ? error.message : String(error));
	}
}

function herdrBinary(): string | undefined {
	const override = process.env.LIMEN_HERDR?.trim();
	if (override === "0") return;
	if (override) return existsSync(override) ? override : undefined;
	for (const dir of (process.env.PATH ?? "").split(":")) {
		const candidate = `${dir}/herdr`;
		if (dir && existsSync(candidate)) return candidate;
	}
}

function requireHerdr(): string {
	const herdr = herdrBinary();
	if (!herdr) throw new Error("herdr is not available");
	return herdr;
}

function ensureWorkspace(herdr: string, cwd: string): string {
	const name = basename(cwd);
	const listed = asRecord(call(herdr, ["workspace", "list"])).workspaces;
	if (Array.isArray(listed)) {
		for (const item of listed) {
			const row = asRecord(item);
			if (row.label === name && typeof row.workspace_id === "string") return row.workspace_id;
		}
	}
	return id(call(herdr, ["workspace", "create", "--cwd", cwd, "--label", name, "--no-focus"]), "workspace", "workspace_id");
}

function tabExists(herdr: string, tab: string): boolean {
	try {
		return Boolean(id(call(herdr, ["tab", "get", tab]), "tab", "tab_id"));
	} catch {
		return false;
	}
}

function advisoryCall(herdr: string, args: readonly string[]): void {
	// These surfaces are additive. A slow or unavailable daemon must not stall supervision.
	spawnSync(herdr, args, { stdio: "ignore", timeout: 2_000 });
}

function call(herdr: string, args: readonly string[], timeout = 180_000): unknown {
	const result = spawnSync(herdr, args, { encoding: "utf8", timeout });
	if (result.error) throw result.error;
	if (result.status !== 0) {
		const raw = result.stderr.trim() || result.stdout.trim() || `herdr ${args[0]} failed`;
		try {
			const err = asRecord(asRecord(JSON.parse(raw)).error);
			const message = typeof err.message === "string" && err.message ? err.message : raw;
			const code = typeof err.code === "string" && err.code ? err.code : undefined;
			throw Object.assign(new Error(message), code ? { code } : {});
		} catch (error) {
			if (error instanceof Error && error.message !== raw) throw error;
		}
		throw new Error(raw);
	}
	const parsed: unknown = JSON.parse(result.stdout || "{}");
	return asRecord(parsed).result ?? parsed;
}

function id(result: unknown, object: string, field: string): string {
	const value = asRecord(asRecord(result)[object])[field];
	if (typeof value !== "string" || !value) throw new Error(`herdr response missing ${object}.${field}`);
	return value;
}

function agentTarget(result: unknown): string | undefined {
	const row = asRecord(result);
	const agent = asRecord(row.agent);
	for (const key of ["pane_id", "name", "agent_id", "target"] as const) {
		const value = agent[key] ?? row[key];
		if (typeof value === "string" && value) return value;
	}
	const pane = asRecord(row.pane).pane_id;
	if (typeof pane === "string" && pane) return pane;
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

async function recordPlace(jobDir: string, place: HerdrPlace, record?: "diff"): Promise<void> {
	const directory = record ? `${jobDir}/herdr/${record}` : `${jobDir}/herdr`;
	await mkdir(directory, { recursive: true });
	await Promise.all((["workspace", "tab", "pane", "mode"] as const).map((name) => writeFile(`${directory}/${name}`, `${place[name]}\n`)));
}

async function readPlace(jobDir: string, record?: "diff"): Promise<HerdrPlace | undefined> {
	const directory = record ? `${jobDir}/herdr/${record}` : `${jobDir}/herdr`;
	const [workspace, tab, pane, mode] = await Promise.all((["workspace", "tab", "pane", "mode"] as const).map((name) => text(`${directory}/${name}`)));
	if (!workspace || !tab || !pane || (mode !== "watch" && mode !== "log" && mode !== "hosted" && mode !== "diff")) return;
	return { workspace, tab, pane, mode };
}

async function terminalFeature(root: string, feature: string): Promise<boolean> {
	for (const lane of ["done", "dropped"] as const) {
		const months = await readdir(`${root}/spec/features/${lane}`, { withFileTypes: true }).catch(() => []);
		for (const month of months) {
			if (!month.isDirectory()) continue;
			const names = await readdir(`${root}/spec/features/${lane}/${month.name}`, { withFileTypes: true }).catch(() => []);
			if (names.some((entry) => entry.isDirectory() && entry.name.toUpperCase().startsWith(`${feature}-`))) return true;
		}
	}
	return false;
}

function text(path: string): Promise<string> {
	return readFile(path, "utf8").then(
		(value) => value.trim(),
		() => "",
	);
}

function skip(jobDir: string, message: string): Promise<void> {
	return appendFile(`${jobDir}/log`, `[limen ${new Date().toISOString()}] herdr skipped: ${message}\n`);
}
