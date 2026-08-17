import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";

export type HerdrPlace = { readonly workspace: string; readonly tab: string; readonly pane: string; readonly mode: "watch" | "log" | "hosted" };
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

export function startHostedPi(input: { readonly place: HerdrPlace; readonly name: string; readonly args: readonly string[]; readonly timeoutMs?: number }): string {
	const herdr = requireHerdr();
	const readyMs = input.timeoutMs ?? 120_000;
	waitForShell(herdr, input.place.pane, Math.min(readyMs, 60_000));
	// Herdr 0.8.0: a --no-focus tab is not an available shell until it has been focused once.
	primeHostedTab(herdr, input.place.tab);
	try {
		const started = call(herdr, ["agent", "start", input.name, "--kind", "pi", "--pane", input.place.pane, "--timeout", String(readyMs), "--", ...input.args]);
		return agentTarget(started) || input.place.pane;
	} catch (error) {
		// Readiness can time out after pi is already interactive (slow model, outdated herdr-pi hook).
		const live = liveHostedTarget(input.place.pane, input.name);
		if (live) return live;
		throw error;
	}
}

/** True when a hosted agent is still present on the pane or under the given name. */
export function hostedAgentAlive(target: string): boolean {
	// Herdr `done` is unseen idle (tab never focused), not process exit. Only missing is gone.
	return hostedAgentStatus(target) !== "missing";
}

function liveHostedTarget(pane: string, name: string): string | undefined {
	for (const target of [pane, name]) {
		const status = hostedAgentStatus(target);
		if (status !== "missing") return target;
	}
	const herdr = herdrBinary();
	if (!herdr) return;
	try {
		const agents = asRecord(call(herdr, ["agent", "list"])).agents;
		if (Array.isArray(agents)) {
			for (const row of agents) {
				const agent = asRecord(row);
				if (agent.pane_id === pane || agent.name === name || agent.tab_id === pane) {
					return typeof agent.pane_id === "string" ? agent.pane_id : pane;
				}
			}
		}
	} catch {
		// Fall through to process probe.
	}
	try {
		const info = asRecord(asRecord(call(herdr, ["pane", "process-info", "--pane", pane])).process_info);
		const foreground = Array.isArray(info.foreground_processes) ? info.foreground_processes : [];
		const names = foreground.map((row) => String(asRecord(row).name ?? "").toLowerCase());
		// pi is often argv0 "node" or "pi"; treat non-shell foreground after a start attempt as live.
		if (names.some((n) => n === "pi" || n.includes("node") || n.includes("pi"))) return pane;
	} catch {
		// Missing.
	}
}

const SHELL_NAMES = new Set(["zsh", "bash", "sh", "fish", "nu", "pwsh", "powershell"]);
/** Pane must be at an interactive shell before `agent start`; new tabs often still run prompt hooks. */
function waitForShell(herdr: string, pane: string, timeoutMs: number): void {
	const deadline = Date.now() + timeoutMs;
	let last = "";
	while (Date.now() < deadline) {
		try {
			const info = asRecord(asRecord(call(herdr, ["pane", "process-info", "--pane", pane])).process_info);
			const foreground = Array.isArray(info.foreground_processes) ? info.foreground_processes : [];
			const names = foreground.map((row) => String(asRecord(row).name ?? ""));
			last = names.join(",") || "none";
			if (foreground.length === 1 && SHELL_NAMES.has(names[0] ?? "")) return;
		} catch (error) {
			last = error instanceof Error ? error.message : String(error);
		}
		spawnSync("sleep", ["0.2"], { stdio: "ignore" });
	}
	throw new Error(`hosted pane ${pane} did not become an idle shell (last: ${last})`);
}

function primeHostedTab(herdr: string, tab: string): void {
	const previous = process.env.HERDR_TAB_ID?.trim();
	call(herdr, ["tab", "focus", tab]);
	if (previous && previous !== tab) {
		try {
			call(herdr, ["tab", "focus", previous]);
		} catch {
			// Coordinator tab may have closed; the new tab staying focused is acceptable.
		}
	}
}

export function hostedAgentStatus(target: string): HostedAgentStatus {
	const herdr = herdrBinary();
	if (!herdr) return "missing";
	try {
		const status = asRecord(call(herdr, ["agent", "get", target])).agent_status;
		if (status === "idle" || status === "working" || status === "blocked" || status === "done" || status === "unknown") return status;
		return "unknown";
	} catch {
		return "missing";
	}
}

export function stopHostedAgent(target: string): void {
	const herdr = herdrBinary();
	if (!herdr) return;
	try {
		call(herdr, ["agent", "send-keys", target, "C-c"]);
	} catch {
		// Best-effort; supervisor finalizes when the agent disappears.
	}
}

export async function renameJobTab(jobDir: string, state: "done" | "failed" | "stopped"): Promise<void> {
	const place = await readPlace(jobDir);
	if (!place) return;
	const herdr = herdrBinary();
	if (!herdr) return skip(jobDir, "herdr is not available");
	try {
		call(herdr, ["tab", "rename", place.tab, `${(await text(`${jobDir}/label`)) || basename(jobDir)} · ${state}`]);
	} catch (error) {
		await skip(jobDir, error instanceof Error ? error.message : String(error));
	}
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
		if (!new RegExp(`^${feature}(?:\\b|[- ])`, "i").test(await text(`${jobDir}/label`))) continue;
		const place = await readPlace(jobDir);
		if (!place || place.tab === coordinator) continue;
		try {
			call(herdr, ["tab", "close", place.tab]);
			closed += 1;
		} catch (error) {
			await skip(jobDir, error instanceof Error ? error.message : String(error));
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
		await recordPlace(input.jobDir, place);
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

function call(herdr: string, args: readonly string[]): unknown {
	const result = spawnSync(herdr, args, { encoding: "utf8", timeout: 180_000 });
	if (result.error) throw result.error;
	if (result.status !== 0) {
		const raw = result.stderr.trim() || result.stdout.trim() || `herdr ${args[0]} failed`;
		try {
			const err = asRecord(asRecord(JSON.parse(raw)).error).message;
			if (typeof err === "string" && err) throw new Error(err);
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

async function recordPlace(jobDir: string, place: HerdrPlace): Promise<void> {
	await mkdir(`${jobDir}/herdr`, { recursive: true });
	await Promise.all((["workspace", "tab", "pane", "mode"] as const).map((name) => writeFile(`${jobDir}/herdr/${name}`, `${place[name]}\n`)));
}

async function readPlace(jobDir: string): Promise<HerdrPlace | undefined> {
	const [workspace, tab, pane, mode] = await Promise.all((["workspace", "tab", "pane", "mode"] as const).map((name) => text(`${jobDir}/herdr/${name}`)));
	if (!workspace || !tab || !pane || (mode !== "watch" && mode !== "log" && mode !== "hosted")) return;
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
