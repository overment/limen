import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { herdrAvailable, openWatchTab } from "../integrations/herdr.ts";
import { claimMember, commandRoot, groupIdentity, groupLock, groupPath, jobMembership, teamRoute } from "../job/group-cabinet.ts";
import { syncLifecycle } from "../job/group-events.ts";
import { hostedAgentName, isTerminal, makeJobId } from "../job/job.ts";
import { resolveJob } from "../job/lookup.ts";
import { publishJob } from "../job/publication.ts";
import { atomicWrite, finalizeJob } from "../job/record.ts";
import { addBranchWorktree, branchCommit, branchExists, headCommit, repoRoot, workspaceRepository, workspaceRoot } from "../project/git.ts";
import { inheritedPlanning, privatePlanningFile, privatePlanningTask, recordedPlanningSource, ticketPointers } from "../project/planning.ts";
import { defaultModel, engineProfile, preflightEngine, resolveSpawnEngine } from "../runtime/engine.ts";
import { normalizeWorkerExtensions, readWorkerExtensions } from "../runtime/worker-extensions.ts";
import { launchWrapper } from "../runtime/wrapper.ts";
import { capturedVersions, currentNotificationSession, herdrWakePane, normalizeLabel, resolvePreamble, startHosted, waitForHandshake } from "./spawn.ts";

/** Resume a finished job's own engine session; restore a pruned checkout from its branch. */
export async function continueCommand(args: readonly string[], cwd: string): Promise<void> {
	await continueJob(args, cwd);
}
async function continueJob(args: readonly string[], cwd: string, locked = false): Promise<void> {
	let review = false;
	let tab = false;
	let detached = false;
	let label: string | undefined;
	let model: string | undefined, provider: string | undefined, thinking: string | undefined, engine: string | undefined;
	const positional: string[] = [];
	const selected: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const value = args[index];
		if (!value) continue;
		if (value === "--review") review = true;
		else if (value === "--tab") tab = true;
		else if (value === "--detached") detached = true;
		else if (value === "--label" || value === "--model" || value === "--provider" || value === "--thinking" || value === "--engine" || value === "--extension") {
			const optionValue = args[index + 1];
			if (!optionValue || (value === "--extension" && optionValue.startsWith("--"))) throw new Error(`${value} requires a value`);
			index += 1;
			if (value === "--extension") selected.push(optionValue);
			else if (value === "--label") label = normalizeLabel(optionValue);
			else if (value === "--provider") provider = optionValue;
			else if (value === "--thinking") thinking = optionValue;
			else if (value === "--engine") engine = optionValue.trim();
			else model = optionValue;
		} else if (value.startsWith("--")) throw new Error(`unknown continue option ${value}`);
		else positional.push(value);
	}
	const [query] = positional;
	const instruction = positional.slice(1).join(" ").trim();
	if (!query || !instruction) throw new Error('continue requires <id|suffix|label> "follow-up instruction"');
	if (tab && detached) throw new Error("--tab and --detached cannot be combined");
	const herdr = herdrAvailable();
	const hosted = detached ? false : tab || herdr;
	if (tab && !herdr) throw new Error("hosted continue requires Herdr (HERDR_ENV=1); use --detached for an ordinary job");
	const chosenModel = model ?? defaultModel(review);

	// A job that continues from its own worktree resolves jobs in its canonical root.
	const inherited = workspaceRoot(cwd) ? undefined : inheritedPlanning(repoRoot(cwd));
	const root = inherited?.root ?? (await commandRoot(cwd));
	const { id: parentId, jobDir: parentDir } = await resolveJob(root, query, "control");
	const membership = await jobMembership(parentDir);
	if (membership) {
		if (membership.member?.role === "coordinator") throw new Error("group coordinator continuation is not supported; inspect and stop before --new-run");
		const caller = await groupIdentity(cwd, membership.run.id);
		if (!caller || (caller.member && (caller.member.role !== "coordinator" || caller.member.team !== membership.member?.team)))
			throw new Error("only this team's coordinator or the recorded lead may continue its worker");
		const route = teamRoute(membership.run, membership.member?.team ?? "");
		if (engine !== membership.run.engine || model !== route.model || provider !== route.provider || thinking !== membership.run.workerThinking)
			throw new Error("group continuation requires recorded engine/provider/model/reasoning explicitly");
		if (!locked) {
			await groupLock(`${groupPath(membership.run)}/launch`, () => continueJob(args, cwd, true), "wait");
			return;
		}
	}
	const parentState = await text(`${parentDir}/state`);
	if (!isTerminal(parentState)) throw new Error(`job ${parentId} is ${parentState || "stateless"}; continue needs a finished job`);
	const worktree = await text(`${parentDir}/worktree`);
	if (!worktree) throw new Error(`parent record ${parentId} has no worktree path`);
	if (membership)
		for (const existing of await readdir(`${root}/.limen/jobs`)) {
			if (existing === parentId) continue;
			const dir = `${root}/.limen/jobs/${existing}`;
			if ((await text(`${dir}/state`)) === "running" && (await text(`${dir}/worktree`)) === worktree) throw new Error("group worker worktree already has a live continuation");
		}
	const branch = await text(`${parentDir}/branch`);
	if (!branch) throw new Error(`parent record ${parentId} has no branch`);
	const repo = await text(`${parentDir}/repo`);
	const sessions = (await readdir(`${parentDir}/session`).catch(() => [])).filter((name) => name.endsWith(".jsonl"));
	if (sessions.length === 0) throw new Error(`parent record ${parentId} has no session transcript to continue`);
	const inheritedSession = sessions.sort().at(-1);
	const parentEngine = (await text(`${parentDir}/engine`)) || "pi";
	if (engine) {
		const requested = resolveSpawnEngine(engine);
		if (requested.id !== parentEngine) throw new Error(`continue --engine ${engine} does not match parent engine ${parentEngine}`);
	}
	const profile = engineProfile(parentEngine);
	const recorded = membership?.run.teamExtensions?.[membership.member?.team ?? ""];
	const extensions = recorded
		? await normalizeWorkerExtensions(recorded, cwd, profile.id)
		: selected.length
			? await normalizeWorkerExtensions(selected, cwd, profile.id)
			: await readWorkerExtensions(parentDir, profile.id);
	if (recorded) {
		if (JSON.stringify(await readWorkerExtensions(parentDir, profile.id)) !== JSON.stringify(extensions))
			throw new Error("group continuation parent does not match the recorded team extensions");
		if (selected.length && JSON.stringify(await normalizeWorkerExtensions(selected, cwd, profile.id)) !== JSON.stringify(extensions))
			throw new Error("group continuation requires the recorded team extensions; omit --extension to inherit them");
	}
	preflightEngine(profile, chosenModel, provider);

	// Private planning: carry the parent's canonical ticket and check every pointer before a record exists.
	const source = recordedPlanningSource(parentDir);
	let followUp = instruction;
	if (source === "private") {
		const parentTicket = ticketPointers(await readFile(`${parentDir}/task.md`, "utf8"))[0]?.path;
		if (parentTicket && ticketPointers(followUp).length === 0) followUp += `\n\nTicket: ${parentTicket}`;
		followUp = await privatePlanningTask(root, followUp);
		if (membership?.member) {
			const feature = membership.run.feature;
			const brief = await privatePlanningFile(root, `${feature}/group/brief.md`);
			const note = await privatePlanningFile(root, `${feature}/group/teams/${membership.member.team}.md`);
			followUp += `\nBrief: ${brief}\nApproach note: ${note}`;
		}
	}
	const finalLabel = label ?? `${(await text(`${parentDir}/label`)) || parentId} · continue`;
	const id = makeJobId(finalLabel);
	const jobDir = `${root}/.limen/jobs/${id}`;
	const role = review ? "reviewer" : (await text(`${parentDir}/role`)) || "worker";
	const preamble = resolvePreamble(root, role);
	const member = membership?.member ? await claimMember(membership.run, membership.member.team, "worker", id, parentId) : undefined;
	const repository = repo ? workspaceRepository(root, repo) : root;
	if (!existsSync(worktree) && !branchExists(repository, branch))
		throw new Error(`parent worktree ${worktree} is gone and branch ${branch} is missing in ${repository}; restore that branch before continuing`);
	// A continuation started from a shell with no wake route (a remote executor, a plain terminal) keeps the parent's coordinator; otherwise its finish reaches nobody.
	const callerSession = currentNotificationSession();
	const callerPane = herdrWakePane(membership ? undefined : callerSession);
	const routed = Boolean(callerSession || callerPane);
	const coordinatorTab = process.env.HERDR_TAB_ID?.trim() || (routed ? "" : await text(`${parentDir}/origin-tab`));
	const coordinatorPane = routed ? callerPane : await text(`${parentDir}/origin-pane`);
	const notificationSession = routed ? callerSession : coordinatorPane ? undefined : (await text(`${parentDir}/origin-session`)) || undefined;
	// Resume the parent's opt-in (or absence), not the current shell's destination.
	const finishConfig = await text(`${parentDir}/finish-webhook-env`);
	const finishAuthor = await text(`${parentDir}/finish-webhook-author`);
	await publishJob(jobDir, {
		task: `${followUp}\n`,
		label: finalLabel,
		branch,
		worktree,
		base: existsSync(worktree) ? headCommit(worktree) : branchCommit(repository, branch),
		role,
		engine: profile.id,
		extensions,
		planningSource: source,
		parent: parentId,
		session: { source: `${parentDir}/session/${inheritedSession}`, name: inheritedSession ?? "" },
		...(repo ? { repo } : {}),
		...(hosted ? { agentName: hostedAgentName(id), continueTask: followUp } : {}),
		...(!membership && notificationSession ? { notificationSession } : {}),
		...(coordinatorTab ? { originTab: coordinatorTab } : {}),
		...(coordinatorPane ? { originPane: coordinatorPane } : {}),
		...(membership && member ? { group: { id: membership.run.id, team: member.team, deadline: member.deadline } } : {}),
		...(finishConfig ? { finishConfig } : {}),
		...(finishAuthor ? { finishAuthor } : {}),
	});
	try {
		// Publication protects the checkout before restoration. Prune during hidden writes may remove
		// an old finished checkout; restore it only after the complete starting record is visible.
		if (!existsSync(worktree)) {
			addBranchWorktree(repository, worktree, branch);
			console.log(`restored ${worktree} from ${branch}; only committed branch contents were recovered`);
		}
	} catch (error) {
		await rm(jobDir, { recursive: true, force: true });
		throw error;
	}
	const versions = capturedVersions(profile).then((text) => writeFile(`${jobDir}/versions`, text, { flag: "wx", flush: true }));
	await atomicWrite(`${jobDir}/state`, "running\n");
	if (membership) await syncLifecycle(membership.run, "skip");
	if (hosted) {
		try {
			await startHosted({
				jobDir,
				id,
				label: finalLabel,
				root,
				worktree,
				preamble,
				taskFile: `${jobDir}/task.md`,
				role,
				continueFile: `${jobDir}/continue`,
				...(chosenModel ? { model: chosenModel } : {}),
				...(provider ? { provider } : {}),
				...(thinking ? { thinking } : {}),
			});
		} catch (error) {
			await versions.catch(() => {});
			throw error;
		}
		await versions.catch(() => {});
		console.log(
			review
				? `continued ${finalLabel} as reviewer in ${parentId}'s session — shares prior context; this review is not independent (hosted)`
				: `continued ${finalLabel} in ${parentId}'s session (hosted)`,
		);
		console.log(id);
		return;
	}
	await openWatchTab({ jobDir, label: finalLabel, cwd: root, logPath: `${jobDir}/log`, role });
	const environment: Record<string, string> = {
		LIMEN_JOB_DIR: jobDir,
		LIMEN_WORKTREE: worktree,
		LIMEN_TASK_FILE: `${jobDir}/task.md`,
		LIMEN_PREAMBLE: preamble,
		LIMEN_JOB_ID: id,
		LIMEN_LABEL: finalLabel,
		LIMEN_CONTEXT_ROOT: root,
		LIMEN_CONTINUE: "1",
		LIMEN_PROVIDER: provider ?? "",
		LIMEN_THINKING: thinking ?? "",
	};
	if (membership && member) {
		environment.LIMEN_GROUP_ID = membership.run.id;
		environment.LIMEN_TEAM_ID = member.team;
		environment.LIMEN_TIMEOUT_MS = String(Math.max(1, member.deadline - Date.now()));
	}
	if (chosenModel) environment.LIMEN_MODEL = chosenModel;
	let wrapperPid: number;
	try {
		wrapperPid = await launchWrapper(environment);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await versions.catch(() => {});
		await finalizeJob(jobDir, "failed", `failed to launch wrapper: ${message}`);
		throw error;
	}
	await waitForHandshake(jobDir, wrapperPid);
	const state = await text(`${jobDir}/state`);
	if (state !== "running") {
		console.log(state, finalLabel);
		console.log(id);
		return;
	}
	await versions.catch(() => {});
	console.log(
		review
			? `continued ${finalLabel} as reviewer in ${parentId}'s session — shares prior context; this review is not independent`
			: `continued ${finalLabel} in ${parentId}'s session`,
	);
	console.log(id);
}

async function text(path: string): Promise<string> {
	return readFile(path, "utf8").then(
		(value) => value.trim(),
		() => "",
	);
}
