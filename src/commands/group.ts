import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { herdrAvailable } from "../integrations/herdr.ts";
import type { GroupIdentity, GroupRun } from "../job/group-cabinet.ts";
import { groupIdentity, groupLock, groupPath, leadHookLive, leadSession, memberLive, readRun, runs, saveJson, teamRoute } from "../job/group-cabinet.ts";
import { acceptBatch, acceptTransport, groupEvents, publishEvent, syncLifecycle } from "../job/group-events.ts";
import { parseDuration, SESSION_ID } from "../job/job.ts";
import { cleanWorktree, commitHasFile, headCommit, repoRoot } from "../project/git.ts";
import { planningSource, privatePlanningFile } from "../project/planning.ts";
import { preflightEngine, resolveSpawnEngine } from "../runtime/engine.ts";
import { normalizeWorkerExtensions } from "../runtime/worker-extensions.ts";
import { spawnCommand } from "./spawn.ts";
import { stopCommand } from "./stop.ts";

const WAIT_CAP_MS = 20_000;
const WRAP_UP_RESERVE_MS = 60_000;

export async function startGroup(args: readonly string[], cwd: string): Promise<GroupRun> {
	if (process.env.LIMEN_GROUP_ID || process.env.LIMEN_JOB === "1")
		throw new Error(
			"only the owner-facing lead may start a group: run limen group start from the plant's interactive Herdr coordinator pane (LIMEN_COORDINATOR=1) with hook/group-peer.ts loaded — a hosted limen job (LIMEN_JOB=1) cannot register as lead or start groups",
		);
	const featureArgument = args[0];
	if (!featureArgument || featureArgument.startsWith("--"))
		throw new Error("group start has no feature directory; run limen group start spec/features/active/FEATURE with the settings in docs/groups.md");
	const flags = new Map<string, string>();
	const teamModels: Record<string, { provider: string; model: string }> = {};
	const extensions: string[] = [];
	const teamSelections: Record<string, string[]> = {};
	let newRun = false,
		mode: GroupRun["mode"] = "auto";
	for (let index = 1; index < args.length; index++) {
		const flag = args[index];
		if (flag === "--extension" || flag === "--team-extension") {
			const value = args[++index];
			if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
			if (flag === "--extension") extensions.push(value);
			else {
				const selection = /^(team-[1-9]\d*)=(.+)$/.exec(value);
				if (!selection?.[1] || !selection[2]) throw new Error("invalid --team-extension; use team-N=PATH");
				(teamSelections[selection[1]] ??= []).push(selection[2]);
			}
			continue;
		}
		if (flag === "--team-model") {
			const route = /^(team-[1-9]\d*)=([^/\s]+)\/(\S+)$/.exec(args[++index] ?? "");
			if (!route?.[1] || !route[2] || !route[3])
				throw new Error("invalid --team-model; run limen group start FEATURE --team-model team-N=provider/model with the other group settings");
			if (teamModels[route[1]]) throw new Error(`${route[1]} model supplied twice; run limen group start FEATURE with one --team-model for that team`);
			teamModels[route[1]] = { provider: route[2], model: route[3] };
			continue;
		}
		if (flag === "--new-run") {
			newRun = true;
			continue;
		}
		if (flag === "--tab" || flag === "--detached") {
			if (mode !== "auto") throw new Error("choose either hosted tabs or detached jobs, not both; run limen group start FEATURE with one of --tab or --detached");
			mode = flag === "--tab" ? "tab" : "detached";
			continue;
		}
		const value = args[++index];
		if (!flag || !value || value.startsWith("--") || flags.has(flag))
			throw new Error("invalid or repeated group start argument; run limen group start FEATURE with the settings in docs/groups.md");
		if (!["--teams", "--workers-per-team", "--timeout", "--worker-timeout", "--engine", "--provider", "--model", "--thinking", "--worker-thinking"].includes(flag))
			throw new Error(`unknown group flag ${flag}; run limen group start FEATURE with the settings in docs/groups.md`);
		flags.set(flag, value);
	}
	const required = (key: string): string => {
		const value = flags.get(key);
		if (!value) throw new Error(`group start is missing ${key}; run limen group start FEATURE ${key} VALUE with the other group settings`);
		return value;
	};
	const count = (key: string): number => {
		const value = required(key);
		if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
			throw new Error(`${key} must be a positive integer; run limen group start FEATURE ${key} N with the other group settings`);
		return Number(value);
	};
	// Deliberately ignore inherited LIMEN_CONTEXT_ROOT for new activation.
	const root = repoRoot(cwd);
	const feature = relative(root, resolve(cwd, featureArgument));
	if (feature.startsWith("..") || !feature.startsWith("spec/features/"))
		throw new Error("feature must be inside this repository's spec/features; run limen group start spec/features/active/FEATURE with the group settings");
	// A repeated start resumes the prior run, so it keeps that run's planning source.
	const priorRun = newRun ? undefined : (await runs(root)).filter((run) => run.feature === feature).at(-1);
	const source = priorRun ? (priorRun.planningSource ?? "committed") : planningSource(root);
	if (source === "private" && featureArgument.split(/[\\/]/).includes(".."))
		throw new Error("private planning feature path must not contain '..'; run limen group start spec/features/active/FEATURE from the project root");
	const lead = (await leadSession(root)) ?? "";
	if (!SESSION_ID.test(lead))
		throw new Error(
			"group start requires the interactive Herdr coordinator pane (LIMEN_COORDINATOR=1) with hook/group-peer.ts loaded and registered under .limen/group-leads — reload that pane after updating the package; a hosted limen job never registers as lead",
		);
	if (!(await leadHookLive(root, lead)))
		throw new Error(
			`group lead hook is not running in this pane: .limen/group-leads/${lead} names no live process refreshed by hook/group-peer.ts in the last 30 seconds. Reload this interactive Herdr coordinator (LIMEN_COORDINATOR=1) with the Limen package hooks, including hook/group-peer.ts, and retry. Do not write .limen/group-leads by hand: without the hook, team results never reach this pane — and do not spawn a hosted job as lead`,
		);
	const teams = Array.from({ length: count("--teams") }, (_, index) => `team-${index + 1}`);
	for (const team of Object.keys(teamModels))
		if (!teams.includes(team)) throw new Error(`--team-model names ${team}, which is not in the roster; run limen group start FEATURE with a team from --teams`);
	const workersPerTeam = count("--workers-per-team");
	const timeout = parseDuration(required("--timeout"));
	const workerTimeoutMs = parseDuration(required("--worker-timeout"));
	const profile = resolveSpawnEngine(required("--engine"));
	const provider = required("--provider"),
		model = required("--model");
	const thinking = required("--thinking"),
		workerThinking = required("--worker-thinking");
	for (const level of [thinking, workerThinking])
		if (!["off", "minimal", "low", "medium", "high", "xhigh"].includes(level))
			throw new Error("unsupported group reasoning level; run limen group start FEATURE with --thinking and --worker-thinking set to off, minimal, low, medium, high, or xhigh");
	if (timeout <= WRAP_UP_RESERVE_MS || workerTimeoutMs <= 0)
		throw new Error(
			`group timeout must leave a ${WRAP_UP_RESERVE_MS / 1000}-second wrap-up reserve; run limen group start FEATURE with --timeout above 1m and a positive --worker-timeout`,
		);
	if (mode === "tab" && !herdrAvailable())
		throw new Error("hosted group requires Herdr; run limen group start FEATURE --detached with the other group settings, or return to Herdr");
	// Check the packet before activation: readable inside the canonical root when private, committed at HEAD otherwise.
	for (const path of [`${feature}/ticket.md`, `${feature}/group/brief.md`, ...teams.map((team) => `${feature}/group/teams/${team}.md`)]) {
		if (source === "private") {
			await privatePlanningFile(root, path);
			continue;
		}
		await readFile(`${root}/${path}`, "utf8").catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") throw new Error(`group packet is missing ${path}; create it, then run limen group start ${feature} with the group settings`);
			throw error;
		});
		if (!commitHasFile(root, headCommit(root), path)) throw new Error(`group packet ${path} is not committed; run git add ${path} and commit before starting`);
	}
	const cabinet = `${root}/.limen/groups`;
	const activated = await groupLock(cabinet, async () => {
		const previous = (await runs(root)).filter((run) => run.feature === feature);
		if (!newRun && previous.length) return { run: previous.at(-1) as GroupRun, created: false };
		for (const prior of previous) {
			if (!prior.stopped && !prior.closed) throw new Error(`group ${prior.feature} (${prior.id}) is still open; run limen group stop ${prior.id} before starting a new run`);
			for (const member of prior.members)
				if (await memberLive(root, member))
					throw new Error(
						`group ${prior.feature} (${prior.id}) still has a live job or no job record yet for ${member.team} ${member.role} (${member.id}); run limen group status ${prior.id}`,
					);
		}
		for (const team of Object.keys(teamSelections)) if (!teams.includes(team)) throw new Error(`--team-extension names ${team}, which is not in the roster`);
		const teamExtensions: Record<string, string[]> = {};
		for (const team of teams) teamExtensions[team] = await normalizeWorkerExtensions([...extensions, ...(teamSelections[team] ?? [])], cwd, profile.id);
		preflightEngine(profile, model, provider);
		const run: GroupRun = {
			id: randomUUID(),
			root,
			feature,
			planningSource: source,
			lead,
			startedAt: Date.now(),
			teams,
			workersPerTeam,
			engine: profile.id,
			provider,
			model,
			thinking,
			workerThinking,
			deadline: Date.now() + timeout,
			workerTimeoutMs,
			reserveMs: WRAP_UP_RESERVE_MS,
			stopped: false,
			closed: false,
			mode,
			members: [],
			teamModels,
			teamExtensions,
		};
		await mkdir(groupPath(run));
		await saveJson(`${groupPath(run)}/run.json`, run);
		return { run, created: true };
	});
	if (activated.created) {
		const ticket = source === "private" ? `${root}/${feature}/ticket.md` : `${feature}/ticket.md`;
		const featureName = feature.split("/").at(-1) ?? feature;
		const featureLabel = /^F\d+/i.exec(featureName)?.[0]?.toUpperCase() ?? featureName;
		for (const team of teams) {
			try {
				await spawnCommand(
					[
						`Pursue the feature with your team. Ticket: ${ticket}`,
						"--label",
						`${team} coordinator · ${featureLabel}`,
						"--engine",
						profile.id,
						"--provider",
						teamRoute(activated.run, team).provider,
						"--model",
						teamRoute(activated.run, team).model,
						"--thinking",
						thinking,
						...(mode === "auto" ? [] : [`--${mode}`]),
					],
					root,
					{ run: activated.run, team },
				);
			} catch (error) {
				await saveJson(`${groupPath(activated.run)}/activation-error.json`, { team, error: error instanceof Error ? error.message : String(error) });
				throw new Error(
					`group ${activated.run.feature} (${activated.run.id}) started only part of its roster: ${error instanceof Error ? error.message : String(error)}; run limen group stop ${activated.run.id} before starting a new run`,
				);
			}
		}
	}
	return readRun(root, activated.run.id);
}
export async function waitGroup(identity: GroupIdentity, requestedMs = WAIT_CAP_MS): Promise<string> {
	const until = Date.now() + Math.max(0, Math.min(WAIT_CAP_MS, requestedMs));
	while (true) {
		const run = await readRun(identity.run.root, identity.run.id);
		if (run.stopped || run.closed) return "group stopped or closed; preserve work and return to the lead";
		if (Date.now() >= (identity.member?.deadline ?? run.deadline)) return "group member deadline expired";
		const batch = await acceptBatch(identity, Date.now(), "skip");
		if (batch) return batch.text;
		if (Date.now() >= until) return "group wait timed out normally; re-enter bounded wait while your collaboration or children remain live";
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
		console.log(`group wait timed out normally after the ${WAIT_CAP_MS / 1000}-second CLI cap; inspect any uncertain delivery receipt before retrying`);
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
	if (!command || !["start", "status", "publish", "wait", "stop", "close"].includes(command))
		throw new Error(`${command ? `unknown group command ${JSON.stringify(command)}` : "no group command supplied"}; run limen group status GROUP-ID`);
	if (command === "start") {
		console.log((await startGroup(rest, cwd)).id);
		return;
	}
	const explicit = process.env.LIMEN_GROUP_ID ? undefined : rest.shift();
	const identity = await groupIdentity(cwd, explicit);
	if (!identity) throw new Error("no group selected; run limen group status GROUP-ID from the lead pane");
	if (command === "publish") {
		let target: string | undefined;
		if (rest[0] === "--team") {
			rest.shift();
			target = rest.shift();
			if (!target) throw new Error("group publish --team has no team name; run limen group publish --team team-N 'Finding: …'");
		}
		console.log((await publishEvent(identity, rest.join(" "), "finding", target)).id);
		return;
	}
	if (command === "wait") {
		if (rest.length > 2 || (rest.length && rest[0] !== "--timeout")) throw new Error("invalid group wait arguments; run limen group wait --timeout 5s");
		const output = await waitGroup(identity, rest[1] ? parseDuration(rest[1]) : WAIT_CAP_MS);
		console.log(output);
		const token = /\[limen-group-delivery:([a-f0-9-]+)\]/.exec(output)?.[1];
		if (token) await acceptTransport(identity, token);
		return;
	}
	if (command === "status") {
		if (rest.length && (rest.length !== 1 || rest[0] !== "--json")) throw new Error(`invalid group status arguments; run limen group status ${identity.run.id} --json`);
		await syncLifecycle(identity.run, "skip");
		const run = await readRun(identity.run.root, identity.run.id);
		const members = await Promise.all(
			run.members.map(async (member) => ({
				...member,
				state: (await readFile(`${run.root}/.limen/jobs/${member.id}/state`, "utf8").catch(() => "no job record yet")).trim() || "no job record yet",
			})),
		);
		if (rest[0] === "--json") {
			console.log(JSON.stringify({ ...run, members, events: await groupEvents(run), receipts: await allReceipts(run) }, null, 2));
			return;
		}
		console.log(`Group ${run.feature} (${run.id})`);
		console.log(`Deadline: ${new Date(run.deadline).toLocaleString()} · ${Math.max(0, Math.ceil((run.deadline - Date.now()) / 60_000))} minutes left`);
		console.log(`Stopped: ${run.stopped ? "yes" : "no"} · Closed: ${run.closed ? "yes" : "no"}`);
		for (const member of members) console.log(`${member.team} ${member.role} (${member.id}): ${member.state}`);
		return;
	}
	if (identity.member) throw new Error(`only the group lead may ${command}; run limen group status to inspect your group's members`);
	if (command === "stop") {
		await groupLock(groupPath(identity.run), async () => {
			const run = await readRun(identity.run.root, identity.run.id);
			run.stopped = true;
			await saveJson(`${groupPath(run)}/run.json`, run);
		});
		const run = await groupLock(`${groupPath(identity.run)}/launch`, () => readRun(identity.run.root, identity.run.id), "wait");
		const failures: string[] = [];
		for (const member of run.members) {
			const dir = `${run.root}/.limen/jobs/${member.id}`;
			if (!(await readFile(`${dir}/state`, "utf8").catch(() => ""))) {
				// The launch lock has drained: a reserved slot without a published state cannot launch later.
				await mkdir(dir, { recursive: true });
				await writeFile(`${dir}/group`, `${run.id}\n`);
				await writeFile(`${dir}/team`, `${member.team}\n`);
				await writeFile(`${dir}/state`, "stopped\n");
				await writeFile(`${dir}/finished-at`, `${new Date().toISOString()}\n`);
			}
			if (!(await memberLive(run.root, member))) continue;
			try {
				await stopCommand([member.id, "group stopped by lead"], run.root);
				const until = Date.now() + 6_000;
				while ((await memberLive(run.root, member)) && Date.now() < until) await delay(100);
				if (await memberLive(run.root, member)) failures.push(`${member.team} ${member.role} (${member.id}): job is still live or its process cannot be confirmed stopped`);
			} catch (error) {
				failures.push(`${member.team} ${member.role} (${member.id}): ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		await saveJson(`${groupPath(run)}/stop-report.json`, { at: Date.now(), failures });
		if (failures.length)
			throw new Error(`group ${run.feature} (${run.id}) blocked new launches but some jobs could not be stopped:\n${failures.join("\n")}\nRun limen group status ${run.id}`);
		console.log("group stopped; recovery work and unread events retained until close");
		return;
	}
	if (command === "close") {
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
					if (tree && existsSync(tree) && !cleanWorktree(tree))
						throw new Error(
							`cannot close group ${run.feature} (${run.id}): ${member.team} ${member.role} (${member.id}) has uncommitted work in ${tree}; run git -C ${JSON.stringify(tree)} status --short before committing or recovering that work`,
						);
				}
				run.closed = true;
				run.stopped = true;
				await saveJson(`${groupPath(run)}/run.json`, run);
			},
			"wait",
		);
		console.log("group closed; clean member paths released for ordinary pruning");
		return;
	}
}
async function allReceipts(run: GroupRun): Promise<unknown[]> {
	const receipts: unknown[] = [];
	for (const recipient of await readdir(`${groupPath(run)}/receipts`).catch(() => []))
		for (const name of await readdir(`${groupPath(run)}/receipts/${recipient}`))
			receipts.push(JSON.parse(await readFile(`${groupPath(run)}/receipts/${recipient}/${name}`, "utf8")));
	return receipts;
}
