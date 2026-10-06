import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { herdrAvailable } from "../integrations/herdr.ts";
import type { GroupIdentity, GroupMember, GroupRun } from "../job/group-cabinet.ts";
import {
	groupIdentity,
	groupLock,
	groupPath,
	leadHookLive,
	leadSession,
	memberLive,
	readRun,
	runs,
	saveJson,
	teamRoute,
} from "../job/group-cabinet.ts";
import { acceptBatch, acceptTransport, groupEvents, publishEvent, syncLifecycle } from "../job/group-events.ts";
import { parseDuration, SESSION_ID } from "../job/job.ts";
import { cleanWorktree, commitHasFile, headCommit, repoRoot } from "../project/git.ts";
import { type PlanningSource, planningSource, privatePlanningFile } from "../project/planning.ts";
import { type EngineProfile, preflightEngine, resolveSpawnEngine } from "../runtime/engine.ts";
import { normalizeWorkerExtensions } from "../runtime/worker-extensions.ts";
import { parseFlags } from "./flags.ts";
import { spawnCommand } from "./spawn.ts";
import { stopCommand } from "./stop.ts";

const WAIT_CAP_MS = 20_000;
const WRAP_UP_RESERVE_MS = 60_000;

type GroupStartOptions = {
	readonly flags: ReadonlyMap<string, string>;
	readonly teamModels: Record<string, { provider: string; model: string }>;
	readonly extensions: readonly string[];
	readonly teamSelections: Readonly<Record<string, readonly string[]>>;
	readonly newRun: boolean;
	readonly mode: GroupRun["mode"];
};
const VALUE_FLAGS = [
	"teams",
	"workers-per-team",
	"timeout",
	"worker-timeout",
	"engine",
	"provider",
	"model",
	"thinking",
	"worker-thinking",
] as const;
const GROUP_SETTINGS = "run limen group start FEATURE with the settings in docs/groups.md";
const INVALID_START = `invalid or repeated group start argument; ${GROUP_SETTINGS}`;
const INVALID_TEAM_MODEL =
	"invalid --team-model; run limen group start FEATURE --team-model team-N=provider/model with the other group settings";
const BOTH_MODES =
	"choose either hosted tabs or detached jobs, not both; run limen group start FEATURE with one of --tab or --detached";

function parseGroupStartArgs(args: readonly string[]): GroupStartOptions {
	const { values } = parseFlags(
		args.slice(1),
		{
			teams: { type: "string" },
			"workers-per-team": { type: "string" },
			timeout: { type: "string" },
			"worker-timeout": { type: "string" },
			engine: { type: "string" },
			provider: { type: "string" },
			model: { type: "string" },
			thinking: { type: "string" },
			"worker-thinking": { type: "string" },
			extension: { type: "string", multiple: true },
			"team-extension": { type: "string", multiple: true },
			"team-model": { type: "string", multiple: true },
			"new-run": { type: "boolean" },
			tab: { type: "boolean" },
			detached: { type: "boolean" },
		} as const,
		{
			// Every word after the feature is a flag; a known one with a bad value reads as invalid, not unknown.
			unknown: (word, next) =>
				word && next && !next.startsWith("--") ? `unknown group flag ${word}; ${GROUP_SETTINGS}` : INVALID_START,
			missing: (flag) => {
				if (flag === "--team-model") {
					return INVALID_TEAM_MODEL;
				}
				return flag === "--extension" || flag === "--team-extension" ? `${flag} requires a value` : INVALID_START;
			},
			repeated: (flag) => {
				if (flag === "--new-run") {
					return undefined;
				}
				return flag === "--tab" || flag === "--detached" ? BOTH_MODES : INVALID_START;
			},
			positionals: false,
			endOfFlags: false,
		},
	);
	const flags = new Map<string, string>();
	for (const name of VALUE_FLAGS) {
		const value = values[name];
		if (value) {
			flags.set(`--${name}`, value);
		}
	}
	const teamSelections = teamExtensionPaths(values["team-extension"] ?? []);
	const teamModels = teamModelRoutes(values["team-model"] ?? []);
	if (values.tab && values.detached) {
		throw new Error(BOTH_MODES);
	}
	let mode: GroupRun["mode"] = "auto";
	if (values.tab) {
		mode = "tab";
	}
	if (values.detached) {
		mode = "detached";
	}
	return { flags, teamModels, extensions: values.extension ?? [], teamSelections, newRun: !!values["new-run"], mode };
}
function teamExtensionPaths(values: readonly string[]): Record<string, string[]> {
	const paths: Record<string, string[]> = {};
	for (const value of values) {
		const selection = /^(team-[1-9]\d*)=(.+)$/.exec(value);
		if (!selection?.[1] || !selection[2]) {
			throw new Error("invalid --team-extension; use team-N=PATH");
		}
		paths[selection[1]] = [...(paths[selection[1]] ?? []), selection[2]];
	}
	return paths;
}
function teamModelRoutes(values: readonly string[]): Record<string, { provider: string; model: string }> {
	const routes: Record<string, { provider: string; model: string }> = {};
	for (const value of values) {
		const route = /^(team-[1-9]\d*)=([^/\s]+)\/(\S+)$/.exec(value);
		if (!route?.[1] || !route[2] || !route[3]) {
			throw new Error(INVALID_TEAM_MODEL);
		}
		if (routes[route[1]]) {
			throw new Error(
				`${route[1]} model supplied twice; run limen group start FEATURE with one --team-model for that team`,
			);
		}
		routes[route[1]] = { provider: route[2], model: route[3] };
	}
	return routes;
}
type GroupSettings = {
	readonly teams: string[];
	readonly workersPerTeam: number;
	readonly timeout: number;
	readonly workerTimeoutMs: number;
	readonly profile: EngineProfile;
	readonly provider: string;
	readonly model: string;
	readonly thinking: string;
	readonly workerThinking: string;
};
type GroupActivation = {
	readonly feature: string;
	readonly source: PlanningSource;
	readonly lead: string;
	readonly settings: GroupSettings;
	readonly options: GroupStartOptions;
};
export async function startGroup(args: readonly string[], cwd: string): Promise<GroupRun> {
	if (process.env.LIMEN_GROUP_ID || process.env.LIMEN_JOB === "1") {
		throw new Error(
			"only the owner-facing lead may start a group: run limen group start from the plant's interactive Herdr coordinator pane (LIMEN_COORDINATOR=1) with hook/group-peer.ts loaded — a hosted limen job (LIMEN_JOB=1) cannot register as lead or start groups",
		);
	}
	const featureArgument = args[0];
	if (!featureArgument || featureArgument.startsWith("--")) {
		throw new Error(
			"group start has no feature directory; run limen group start spec/features/active/FEATURE with the settings in docs/groups.md",
		);
	}
	const options = parseGroupStartArgs(args);
	// Deliberately ignore inherited LIMEN_CONTEXT_ROOT for new activation.
	const root = repoRoot(cwd);
	const feature = groupFeature(root, cwd, featureArgument);
	const source = await groupPlanningSource(root, feature, featureArgument, options.newRun);
	const lead = await liveGroupLead(root);
	const settings = groupSettings(options);
	await checkGroupPacket(root, feature, settings.teams, source);
	const activated = await activateGroup(root, cwd, { feature, source, lead, settings, options });
	if (activated.created) {
		await spawnTeamCoordinators(root, activated.run);
	}
	return readRun(root, activated.run.id);
}
function groupFeature(root: string, cwd: string, featureArgument: string): string {
	const feature = relative(root, resolve(cwd, featureArgument));
	if (feature.startsWith("..") || !feature.startsWith("spec/features/")) {
		throw new Error(
			"feature must be inside this repository's spec/features; run limen group start spec/features/active/FEATURE with the group settings",
		);
	}
	return feature;
}
/** A repeated start resumes the prior run, so it keeps that run's planning source. */
async function groupPlanningSource(
	root: string,
	feature: string,
	featureArgument: string,
	newRun: boolean,
): Promise<PlanningSource> {
	const priorRun = newRun ? undefined : (await runs(root)).filter((run) => run.feature === feature).at(-1);
	const source = priorRun ? (priorRun.planningSource ?? "committed") : planningSource(root);
	if (source === "private" && featureArgument.split(/[\\/]/).includes("..")) {
		throw new Error(
			"private planning feature path must not contain '..'; run limen group start spec/features/active/FEATURE from the project root",
		);
	}
	return source;
}
/** The interactive coordinator registered as lead, whose group-peer hook is alive. */
async function liveGroupLead(root: string): Promise<string> {
	const lead = (await leadSession(root)) ?? "";
	if (!SESSION_ID.test(lead)) {
		throw new Error(
			"group start requires the interactive Herdr coordinator pane (LIMEN_COORDINATOR=1) with hook/group-peer.ts loaded and registered under .limen/group-leads — reload that pane after updating the package; a hosted limen job never registers as lead",
		);
	}
	if (!(await leadHookLive(root, lead))) {
		throw new Error(
			`group lead hook is not running in this pane: .limen/group-leads/${lead} names no live process refreshed by hook/group-peer.ts in the last 30 seconds. Reload this interactive Herdr coordinator (LIMEN_COORDINATOR=1) with the Limen package hooks, including hook/group-peer.ts, and retry. Do not write .limen/group-leads by hand: without the hook, team results never reach this pane — and do not spawn a hosted job as lead`,
		);
	}
	return lead;
}
function groupSetting(flags: ReadonlyMap<string, string>, key: string): string {
	const value = flags.get(key);
	if (!value) {
		throw new Error(
			`group start is missing ${key}; run limen group start FEATURE ${key} VALUE with the other group settings`,
		);
	}
	return value;
}
function groupCount(flags: ReadonlyMap<string, string>, key: string): number {
	const value = groupSetting(flags, key);
	if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
		throw new Error(
			`${key} must be a positive integer; run limen group start FEATURE ${key} N with the other group settings`,
		);
	}
	return Number(value);
}
/** The roster, deadlines, engine route and reasoning levels, checked in the order a missing setting is reported. */
function groupSettings({ flags, teamModels, mode }: GroupStartOptions): GroupSettings {
	const teams = Array.from({ length: groupCount(flags, "--teams") }, (_, index) => `team-${index + 1}`);
	for (const team of Object.keys(teamModels)) {
		if (!teams.includes(team)) {
			throw new Error(
				`--team-model names ${team}, which is not in the roster; run limen group start FEATURE with a team from --teams`,
			);
		}
	}
	const workersPerTeam = groupCount(flags, "--workers-per-team");
	const timeout = parseDuration(groupSetting(flags, "--timeout"));
	const workerTimeoutMs = parseDuration(groupSetting(flags, "--worker-timeout"));
	const profile = resolveSpawnEngine(groupSetting(flags, "--engine"));
	const provider = groupSetting(flags, "--provider");
	const model = groupSetting(flags, "--model");
	const thinking = groupSetting(flags, "--thinking");
	const workerThinking = groupSetting(flags, "--worker-thinking");
	for (const level of [thinking, workerThinking]) {
		if (!["off", "minimal", "low", "medium", "high", "xhigh"].includes(level)) {
			throw new Error(
				"unsupported group reasoning level; run limen group start FEATURE with --thinking and --worker-thinking set to off, minimal, low, medium, high, or xhigh",
			);
		}
	}
	if (timeout <= WRAP_UP_RESERVE_MS || workerTimeoutMs <= 0) {
		throw new Error(
			`group timeout must leave a ${WRAP_UP_RESERVE_MS / 1000}-second wrap-up reserve; run limen group start FEATURE with --timeout above 1m and a positive --worker-timeout`,
		);
	}
	if (mode === "tab" && !herdrAvailable()) {
		throw new Error(
			"hosted group requires Herdr; run limen group start FEATURE --detached with the other group settings, or return to Herdr",
		);
	}
	return { teams, workersPerTeam, timeout, workerTimeoutMs, profile, provider, model, thinking, workerThinking };
}
/** Check the packet before activation: readable inside the canonical root when private, committed at HEAD otherwise. */
async function checkGroupPacket(
	root: string,
	feature: string,
	teams: readonly string[],
	source: PlanningSource,
): Promise<void> {
	for (const path of [
		`${feature}/ticket.md`,
		`${feature}/group/brief.md`,
		...teams.map((team) => `${feature}/group/teams/${team}.md`),
	]) {
		if (source === "private") {
			await privatePlanningFile(root, path);
			continue;
		}
		await readFile(`${root}/${path}`, "utf8").catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") {
				throw new Error(
					`group packet is missing ${path}; create it, then run limen group start ${feature} with the group settings`,
				);
			}
			throw error;
		});
		if (!commitHasFile(root, headCommit(root), path)) {
			throw new Error(`group packet ${path} is not committed; run git add ${path} and commit before starting`);
		}
	}
}
/** Under the cabinet lock: resume the feature's last run, or write a new run once every prior run has ended. */
async function activateGroup(
	root: string,
	cwd: string,
	activation: GroupActivation,
): Promise<{ run: GroupRun; created: boolean }> {
	const { feature, options, settings } = activation;
	return groupLock(`${root}/.limen/groups`, async () => {
		const previous = (await runs(root)).filter((run) => run.feature === feature);
		if (!options.newRun && previous.length) {
			return { run: previous.at(-1) as GroupRun, created: false };
		}
		await assertPriorRunsEnded(root, previous);
		for (const team of Object.keys(options.teamSelections)) {
			if (!settings.teams.includes(team)) {
				throw new Error(`--team-extension names ${team}, which is not in the roster`);
			}
		}
		const teamExtensions = await teamExtensionPathsByTeam(settings, options, cwd);
		preflightEngine(settings.profile, settings.model, settings.provider);
		const run = newGroupRun(root, activation, teamExtensions);
		await mkdir(groupPath(run));
		await saveJson(`${groupPath(run)}/run.json`, run);
		return { run, created: true };
	});
}
async function assertPriorRunsEnded(root: string, previous: readonly GroupRun[]): Promise<void> {
	for (const prior of previous) {
		if (!prior.stopped && !prior.closed) {
			throw new Error(
				`group ${prior.feature} (${prior.id}) is still open; run limen group stop ${prior.id} before starting a new run`,
			);
		}
		for (const member of prior.members) {
			if (await memberLive(root, member)) {
				throw new Error(
					`group ${prior.feature} (${prior.id}) still has a live job or no job record yet for ${member.team} ${member.role} (${member.id}); run limen group status ${prior.id}`,
				);
			}
		}
	}
}
async function teamExtensionPathsByTeam(
	settings: GroupSettings,
	options: GroupStartOptions,
	cwd: string,
): Promise<Record<string, string[]>> {
	const teamExtensions: Record<string, string[]> = {};
	for (const team of settings.teams) {
		teamExtensions[team] = await normalizeWorkerExtensions(
			[...options.extensions, ...(options.teamSelections[team] ?? [])],
			cwd,
			settings.profile.id,
		);
	}
	return teamExtensions;
}
function newGroupRun(
	root: string,
	{ feature, source, lead, settings, options }: GroupActivation,
	teamExtensions: Record<string, string[]>,
): GroupRun {
	return {
		id: randomUUID(),
		root,
		feature,
		planningSource: source,
		lead,
		startedAt: Date.now(),
		teams: settings.teams,
		workersPerTeam: settings.workersPerTeam,
		engine: settings.profile.id,
		provider: settings.provider,
		model: settings.model,
		thinking: settings.thinking,
		workerThinking: settings.workerThinking,
		deadline: Date.now() + settings.timeout,
		workerTimeoutMs: settings.workerTimeoutMs,
		reserveMs: WRAP_UP_RESERVE_MS,
		stopped: false,
		closed: false,
		mode: options.mode,
		members: [],
		teamModels: options.teamModels,
		teamExtensions,
	};
}
/** One coordinator job per team of a new run. A failed launch is recorded and ends the start. */
async function spawnTeamCoordinators(root: string, run: GroupRun): Promise<void> {
	const ticket = run.planningSource === "private" ? `${root}/${run.feature}/ticket.md` : `${run.feature}/ticket.md`;
	const featureName = run.feature.split("/").at(-1) ?? run.feature;
	const featureLabel = /^F\d+/i.exec(featureName)?.[0]?.toUpperCase() ?? featureName;
	for (const team of run.teams) {
		try {
			await spawnCommand(
				[
					`Pursue the feature with your team. Ticket: ${ticket}`,
					"--label",
					`${team} coordinator · ${featureLabel}`,
					"--engine",
					run.engine,
					"--provider",
					teamRoute(run, team).provider,
					"--model",
					teamRoute(run, team).model,
					"--thinking",
					run.thinking,
					...(run.mode === "auto" ? [] : [`--${run.mode}`]),
				],
				root,
				{ run, team },
			);
		} catch (error) {
			await saveJson(`${groupPath(run)}/activation-error.json`, {
				team,
				error: error instanceof Error ? error.message : String(error),
			});
			throw new Error(
				`group ${run.feature} (${run.id}) started only part of its roster: ${error instanceof Error ? error.message : String(error)}; run limen group stop ${run.id} before starting a new run`,
			);
		}
	}
}
export async function waitGroup(identity: GroupIdentity, requestedMs = WAIT_CAP_MS): Promise<string> {
	const until = Date.now() + Math.max(0, Math.min(WAIT_CAP_MS, requestedMs));
	while (true) {
		const run = await readRun(identity.run.root, identity.run.id);
		if (run.stopped || run.closed) {
			return "group stopped or closed; preserve work and return to the lead";
		}
		if (Date.now() >= (identity.member?.deadline ?? run.deadline)) {
			return "group member deadline expired";
		}
		const batch = await acceptBatch(identity, Date.now(), "skip");
		if (batch) {
			return batch.text;
		}
		if (Date.now() >= until) {
			return "group wait timed out normally; re-enter bounded wait while your collaboration or children remain live";
		}
		await delay(Math.min(100, until - Date.now()));
	}
}
export async function groupCommand(args: readonly string[], cwd: string): Promise<void> {
	// Bound the actual CLI process even if a cabinet lock or filesystem operation stalls.
	if (args[0] !== "wait") {
		await runGroupCommand(args, cwd);
		return;
	}
	const cap = setTimeout(() => {
		console.log(
			`group wait timed out normally after the ${WAIT_CAP_MS / 1000}-second CLI cap; inspect any uncertain delivery receipt before retrying`,
		);
		process.exit(0);
	}, WAIT_CAP_MS);
	cap.unref();
	try {
		await runGroupCommand(args, cwd);
	} finally {
		clearTimeout(cap);
	}
}
async function runGroupCommand(args: readonly string[], cwd: string): Promise<void> {
	const [command, ...rest] = args;
	if (!command || !["start", "status", "publish", "wait", "stop", "close"].includes(command)) {
		throw new Error(
			`${command ? `unknown group command ${JSON.stringify(command)}` : "no group command supplied"}; run limen group status GROUP-ID`,
		);
	}
	if (command === "start") {
		console.log((await startGroup(rest, cwd)).id);
		return;
	}
	const explicit = process.env.LIMEN_GROUP_ID ? undefined : rest.shift();
	const identity = await groupIdentity(cwd, explicit);
	if (!identity) {
		throw new Error("no group selected; run limen group status GROUP-ID from the lead pane");
	}
	if (command === "publish") {
		await publishGroupFinding(identity, rest);
		return;
	}
	if (command === "wait") {
		await printGroupWait(identity, rest);
		return;
	}
	if (command === "status") {
		await printGroupStatus(identity, rest);
		return;
	}
	if (identity.member) {
		throw new Error(`only the group lead may ${command}; run limen group status to inspect your group's members`);
	}
	if (command === "stop") {
		await stopGroup(identity);
		return;
	}
	if (command === "close") {
		await closeGroup(identity);
	}
}
async function publishGroupFinding(identity: GroupIdentity, rest: string[]): Promise<void> {
	let target: string | undefined;
	if (rest[0] === "--team") {
		rest.shift();
		target = rest.shift();
		if (!target) {
			throw new Error("group publish --team has no team name; run limen group publish --team team-N 'Finding: …'");
		}
	}
	console.log((await publishEvent(identity, rest.join(" "), "finding", target)).id);
}
async function printGroupWait(identity: GroupIdentity, rest: readonly string[]): Promise<void> {
	if (rest.length > 2 || (rest.length && rest[0] !== "--timeout")) {
		throw new Error("invalid group wait arguments; run limen group wait --timeout 5s");
	}
	const output = await waitGroup(identity, rest[1] ? parseDuration(rest[1]) : WAIT_CAP_MS);
	console.log(output);
	const token = /\[limen-group-delivery:([a-f0-9-]+)\]/.exec(output)?.[1];
	if (token) {
		await acceptTransport(identity, token);
	}
}
async function printGroupStatus(identity: GroupIdentity, rest: readonly string[]): Promise<void> {
	if (rest.length && (rest.length !== 1 || rest[0] !== "--json")) {
		throw new Error(`invalid group status arguments; run limen group status ${identity.run.id} --json`);
	}
	await syncLifecycle(identity.run, "skip");
	const run = await readRun(identity.run.root, identity.run.id);
	const members = await Promise.all(
		run.members.map(async (member) => ({
			...member,
			state:
				(
					await readFile(`${run.root}/.limen/jobs/${member.id}/state`, "utf8").catch(() => "no job record yet")
				).trim() || "no job record yet",
		})),
	);
	if (rest[0] === "--json") {
		console.log(
			JSON.stringify({ ...run, members, events: await groupEvents(run), receipts: await allReceipts(run) }, null, 2),
		);
		return;
	}
	console.log(`Group ${run.feature} (${run.id})`);
	console.log(
		`Deadline: ${new Date(run.deadline).toLocaleString()} · ${Math.max(0, Math.ceil((run.deadline - Date.now()) / 60_000))} minutes left`,
	);
	console.log(`Stopped: ${run.stopped ? "yes" : "no"} · Closed: ${run.closed ? "yes" : "no"}`);
	for (const member of members) {
		console.log(`${member.team} ${member.role} (${member.id}): ${member.state}`);
	}
}
/** Blocks new launches, then stops every live member job. Throws with the members that could not be stopped. */
async function stopGroup(identity: GroupIdentity): Promise<void> {
	await groupLock(groupPath(identity.run), async () => {
		const run = await readRun(identity.run.root, identity.run.id);
		run.stopped = true;
		await saveJson(`${groupPath(run)}/run.json`, run);
	});
	const run = await groupLock(
		`${groupPath(identity.run)}/launch`,
		() => readRun(identity.run.root, identity.run.id),
		"wait",
	);
	const failures: string[] = [];
	for (const member of run.members) {
		await stopReservedSlot(run, member);
		const failure = await stopMemberJob(run, member);
		if (failure) {
			failures.push(failure);
		}
	}
	await saveJson(`${groupPath(run)}/stop-report.json`, { at: Date.now(), failures });
	if (failures.length) {
		throw new Error(
			`group ${run.feature} (${run.id}) blocked new launches but some jobs could not be stopped:\n${failures.join("\n")}\nRun limen group status ${run.id}`,
		);
	}
	console.log("group stopped; recovery work and unread events retained until close");
}
async function stopReservedSlot(run: GroupRun, member: GroupMember): Promise<void> {
	const dir = `${run.root}/.limen/jobs/${member.id}`;
	if (await readFile(`${dir}/state`, "utf8").catch(() => "")) {
		return;
	}
	// The launch lock has drained: a reserved slot without a published state cannot launch later.
	await mkdir(dir, { recursive: true });
	await writeFile(`${dir}/group`, `${run.id}\n`);
	await writeFile(`${dir}/team`, `${member.team}\n`);
	await writeFile(`${dir}/state`, "stopped\n");
	await writeFile(`${dir}/finished-at`, `${new Date().toISOString()}\n`);
}
/** Stops a live member job and waits up to 6 s for it to end. Returns why it is not confirmed stopped. */
async function stopMemberJob(run: GroupRun, member: GroupMember): Promise<string | undefined> {
	if (!(await memberLive(run.root, member))) {
		return;
	}
	try {
		await stopCommand([member.id, "group stopped by lead"], run.root);
		const until = Date.now() + 6_000;
		while ((await memberLive(run.root, member)) && Date.now() < until) {
			await delay(100);
		}
		if (await memberLive(run.root, member)) {
			return `${member.team} ${member.role} (${member.id}): job is still live or its process cannot be confirmed stopped`;
		}
	} catch (error) {
		return `${member.team} ${member.role} (${member.id}): ${error instanceof Error ? error.message : String(error)}`;
	}
	return;
}
/** Marks the run closed once no member job is live and every member worktree is clean. */
async function closeGroup(identity: GroupIdentity): Promise<void> {
	await groupLock(
		`${groupPath(identity.run)}/launch`,
		async () => {
			const run = await readRun(identity.run.root, identity.run.id);
			for (const member of run.members) {
				if (await memberLive(run.root, member)) {
					const state = (await readFile(`${run.root}/.limen/jobs/${member.id}/state`, "utf8").catch(() => "")).trim();
					throw new Error(
						`cannot close group ${run.feature} (${run.id}): ${member.team} ${member.role} (${member.id}) ${state ? "is still live or its process cannot be confirmed stopped" : "has no job record yet"}; run limen group stop ${run.id}`,
					);
				}
				const tree = (await readFile(`${run.root}/.limen/jobs/${member.id}/worktree`, "utf8").catch(() => "")).trim();
				if (tree && existsSync(tree) && !cleanWorktree(tree)) {
					throw new Error(
						`cannot close group ${run.feature} (${run.id}): ${member.team} ${member.role} (${member.id}) has uncommitted work in ${tree}; run git -C ${JSON.stringify(tree)} status --short before committing or recovering that work`,
					);
				}
			}
			run.closed = true;
			run.stopped = true;
			await saveJson(`${groupPath(run)}/run.json`, run);
		},
		"wait",
	);
	console.log("group closed; clean member paths released for ordinary pruning");
}
async function allReceipts(run: GroupRun): Promise<unknown[]> {
	const receipts: unknown[] = [];
	for (const recipient of await readdir(`${groupPath(run)}/receipts`).catch(() => [])) {
		for (const name of await readdir(`${groupPath(run)}/receipts/${recipient}`)) {
			receipts.push(JSON.parse(await readFile(`${groupPath(run)}/receipts/${recipient}/${name}`, "utf8")));
		}
	}
	return receipts;
}
