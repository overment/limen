import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { headCommit, repoRoot, workspaceRoot } from "../git.ts";
import { herdrAvailable, openWatchTab } from "../herdr.ts";
import { resolveJob } from "../lookup.ts";
import { atomicWrite, finalizeJob, launchWrapper } from "../wrapper.ts";
import { capturedVersions, currentNotificationSession, HOSTED_NOTE, hostedAgentName, makeJobId, normalizeLabel, preflightPi, startHosted, waitForHandshake } from "./spawn.ts";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** F034/F037: resume a finished job's own pi session — full context, same worktree. */
export async function continueCommand(args: readonly string[], cwd: string): Promise<void> {
	let review = false;
	let tab = false;
	let detached = false;
	let label: string | undefined;
	let model: string | undefined;
	const positional: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const value = args[index];
		if (!value) continue;
		if (value === "--review") review = true;
		else if (value === "--tab") tab = true;
		else if (value === "--detached") detached = true;
		else if (value === "--label" || value === "--model") {
			const optionValue = args[index + 1];
			if (!optionValue) throw new Error(`${value} requires a value`);
			index += 1;
			if (value === "--label") label = normalizeLabel(optionValue);
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
	const chosenModel = model ?? (process.env[review ? "LIMEN_REVIEWER_MODEL" : "LIMEN_WORKER_MODEL"]?.trim() || undefined);
	preflightPi(chosenModel);

	const root = workspaceRoot(cwd) ?? repoRoot(cwd);
	const { id: parentId, jobDir: parentDir } = await resolveJob(cwd, query);
	const parentState = await text(`${parentDir}/state`);
	if (!["done", "failed", "stopped"].includes(parentState)) throw new Error(`job ${parentId} is ${parentState || "stateless"}; continue needs a finished job`);
	const worktree = await text(`${parentDir}/worktree`);
	if (!worktree || !existsSync(worktree)) throw new Error(`the parent worktree (${parentId}) is gone — likely pruned; spawn a fresh job instead`);
	const branch = await text(`${parentDir}/branch`);
	if (!branch) throw new Error(`parent record ${parentId} has no branch`);
	const repo = await text(`${parentDir}/repo`);
	const sessions = (await readdir(`${parentDir}/session`).catch(() => [])).filter((name) => name.endsWith(".jsonl"));
	if (sessions.length === 0) throw new Error(`parent record ${parentId} has no session transcript to continue`);
	const inheritedSession = sessions.sort().at(-1);

	const finalLabel = label ?? `${(await text(`${parentDir}/label`)) || parentId} · continue`;
	const id = makeJobId(finalLabel);
	const jobDir = `${root}/.limen/jobs/${id}`;
	await mkdir(jobDir, { recursive: false });
	await mkdir(`${jobDir}/notify/subscribers`, { recursive: true });
	const notificationSession = currentNotificationSession();
	const coordinatorTab = process.env.HERDR_TAB_ID?.trim();
	const role = review ? "reviewer" : "worker";
	await Promise.all([
		writeFile(`${jobDir}/task.md`, `${instruction}\n`, { flag: "wx", flush: true }),
		writeFile(`${jobDir}/label`, `${finalLabel}\n`, { flag: "wx", flush: true }),
		writeFile(`${jobDir}/branch`, `${branch}\n`, { flag: "wx", flush: true }),
		writeFile(`${jobDir}/worktree`, `${worktree}\n`, { flag: "wx", flush: true }),
		writeFile(`${jobDir}/base`, `${headCommit(worktree)}\n`, { flag: "wx", flush: true }),
		writeFile(`${jobDir}/parent`, `${parentId}\n`, { flag: "wx", flush: true }),
		writeFile(`${jobDir}/started-at`, `${new Date().toISOString()}\n`, { flag: "wx", flush: true }),
		writeFile(`${jobDir}/tool-calls`, "0\n", { flag: "wx", flush: true }),
		writeFile(`${jobDir}/last-tool`, "", { flag: "wx", flush: true }),
		writeFile(`${jobDir}/activity`, "think\n", { flag: "wx", flush: true }),
		writeFile(`${jobDir}/log`, "", { flag: "wx", flush: true }),
		...(repo ? [writeFile(`${jobDir}/repo`, `${repo}\n`, { flag: "wx", flush: true })] : []),
		...(hosted
			? [
					writeFile(`${jobDir}/hosted`, HOSTED_NOTE, { flag: "wx", flush: true }),
					writeFile(`${jobDir}/role`, `${role}\n`, { flag: "wx", flush: true }),
					writeFile(`${jobDir}/agent-name`, `${hostedAgentName(id)}\n`, { flag: "wx", flush: true }),
					writeFile(`${jobDir}/continue`, `${instruction}\n`, { flag: "wx", flush: true }),
				]
			: []),
		...(notificationSession
			? [
					writeFile(`${jobDir}/origin-session`, `${notificationSession}\n`, { flag: "wx", flush: true }),
					writeFile(`${jobDir}/notify/subscribers/${notificationSession}`, `${new Date().toISOString()}\n`, { flag: "wx", flush: true }),
				]
			: []),
		...(coordinatorTab ? [writeFile(`${jobDir}/origin-tab`, `${coordinatorTab}\n`, { flag: "wx", flush: true })] : []),
	]);
	await writeFile(`${jobDir}/notify/ready`, "1\n", { flag: "wx", flush: true });
	const versions = capturedVersions().then((text) => writeFile(`${jobDir}/versions`, text, { flag: "wx", flush: true }));
	// The continued run writes into its own transcript, seeded with a copy of the parent's
	// newest session — the parent record stays frozen history.
	await mkdir(`${jobDir}/session`, { recursive: true });
	await copyFile(`${parentDir}/session/${inheritedSession}`, `${jobDir}/session/${inheritedSession}`);
	await atomicWrite(`${jobDir}/state`, "running\n");
	const localPreamble = `${root}/.agents/limen/${role}.md`;
	const preamble = await readFile(localPreamble).then(
		() => localPreamble,
		() => `${PACKAGE_ROOT}/templates/${role}.md`,
	);
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
	};
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
