import { execFile, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rename } from "node:fs/promises";
import { appendLimenLog, atomicWrite, finalizeJob, isFailedStopReason, textFile } from "../job/record.ts";
import { enqueueSteer } from "../job/steer-inbox.ts";
import { recordStreamEvents, type StreamSeen } from "./activity-log.ts";
import { resolveSeatAccount } from "./claude-account.ts";
import { argvFor, ENGINES, engineRoute } from "./engine.ts";
import { githubRepo, mintHostToken, missingTokenLine, redactSecrets } from "./github-broker.ts";
import {
	bundleScript,
	cleanupScript,
	githubInstallScript,
	killScript,
	launchScript,
	oauthInstallScript,
	openRemoteShell,
	posixQuote,
	prefixHostChunk,
	type RemoteHost,
	remoteLayout,
	shellText,
	steerListScript,
	steerPushScript,
} from "./host-shell.ts";
import { assertJobSegment, loadHostPool } from "./hosts.ts";
import { createStreamParser } from "./stream.ts";
import { readWorkerExtensions } from "./worker-extensions.ts";

// A remote job's wrapper stays on the seat, as a Devin job's wrapper does. The seat pushes the branch, Pi runs over
// ssh, and the seat copies the handoff home, fast-forwards, finalizes, and wakes. The host never owns .limen state.
const MAX_TOOL_CALLS = 900;
const toolCallCap = (): number => Number(process.env.LIMEN_MAX_TOOL_CALLS) || MAX_TOOL_CALLS;
const steerPollMs = (): number =>
	Number(process.env.LIMEN_HOST_STEER_MS) > 0 ? Number(process.env.LIMEN_HOST_STEER_MS) : 1_000;

export type RemoteJob = {
	readonly host: RemoteHost;
	readonly jobDir: string;
	readonly worktree: string;
	readonly taskFile: string;
	readonly preamble: string;
	readonly jobId: string;
	readonly label: string;
	readonly branch: string;
	readonly timeoutMs: number;
	readonly stop: AbortSignal;
	readonly shutdownDeadline: () => number | undefined;
	readonly provider?: string;
	readonly model?: string;
	readonly thinking?: string;
	readonly continueTask?: string;
};

type Cause = "" | "stop" | "timeout" | "cap";
type Outcome = {
	readonly code: number | null;
	readonly signal: NodeJS.Signals | null;
	readonly error?: Error;
	readonly cause: Cause;
	readonly detail: string;
	readonly stderr: string;
	readonly seen: StreamSeen;
};

export async function runRemoteJob(job: RemoteJob): Promise<void> {
	assertJobSegment(job.jobId);
	let settled = false;
	const settle = async (state: "done" | "failed" | "stopped", detail: string) => {
		if (settled) {
			return;
		}
		settled = true;
		await finalizeJob(job.jobDir, state, detail, job.shutdownDeadline());
	};
	let cleaned = false;
	const cleanup = async () => {
		if (cleaned) {
			return;
		}
		cleaned = true;
		const result = await shellText(job.host, cleanupScript(job.host, job.jobId, job.branch), 20_000);
		if (result.code !== 0) {
			await appendLimenLog(job.jobDir, `remote cleanup failed: ${result.stderr.trim() || result.code}`).catch(() => {});
		}
	};
	try {
		const delivered = await pushAndNote(job);
		const outcome = await streamJob(job, delivered);
		await copyBack(job);
		await bringBack(job, outcome.cause === "stop");
		if (outcome.cause === "" && outcome.code === 0 && job.branch.startsWith("limen/") && loadHostPool().pruneBranches) {
			await deletePushedBranch(job);
		}
		// Drop the host worktree before the seat marks the job terminal, so the wake is not racing the cleanup.
		await cleanup();
		await finishOutcome(job, outcome, settle);
	} catch (error) {
		await settle("failed", error instanceof Error ? error.message : String(error));
	} finally {
		await cleanup();
	}
}

type Delivered = {
	readonly secrets: readonly string[];
	readonly author?: { readonly name: string; readonly email: string };
};

async function pushAndNote(job: RemoteJob): Promise<Delivered> {
	const where = `${job.host.alias} (${job.host.ssh}, ${job.host.platform})`;
	await appendLimenLog(job.jobDir, `remote host ${where}: pushing ${job.branch}`);
	await git(job.worktree, ["push", "origin", job.branch]);
	await appendLimenLog(job.jobDir, `remote host ${job.host.alias}: fetching ${job.branch} and adding a worktree`);
	const account = await deliverAccount(job);
	const github = await deliverGithub(job);
	const author = github?.name && github.email ? { name: github.name, email: github.email } : seatAuthor(job.worktree);
	if (author) {
		await appendLimenLog(job.jobDir, `commit author ${author.name} <${author.email}>`);
	}
	await uploadSession(job);
	const extras = await readWorkerExtensions(job.jobDir, "pi");
	if (extras.length > 0) {
		await appendLimenLog(job.jobDir, `remote host: not loading ${extras.length} seat extension path(s)`);
	}
	const secrets = [account, github?.token ?? ""].filter((secret) => secret !== "");
	return author ? { secrets, author } : { secrets };
}

async function deliverAccount(job: RemoteJob): Promise<string> {
	const account = resolveSeatAccount();
	if (!account) {
		await appendLimenLog(job.jobDir, "no seat Claude account; the host uses its own login");
		return "";
	}
	const sent = await shellText(job.host, oauthInstallScript(job.jobId, account.token), 20_000);
	await appendLimenLog(
		job.jobDir,
		sent.code === 0
			? `seat Claude account ${account.name} for this job`
			: `seat Claude account ${account.name} was not delivered`,
	);
	return account.token;
}

async function deliverGithub(job: RemoteJob): Promise<{ token: string; name?: string; email?: string } | undefined> {
	// `remote get-url` applies insteadOf and can hide the GitHub url the broker must see.
	const url = spawnSync("git", ["config", "--local", "--get", "remote.origin.url"], {
		cwd: job.worktree,
		encoding: "utf8",
	});
	const repo = url.status === 0 ? githubRepo(url.stdout) : undefined;
	if (!repo) {
		return undefined;
	}
	const minted = await mintHostToken(repo, loadHostPool().githubBroker);
	if (!minted.minted) {
		await appendLimenLog(job.jobDir, missingTokenLine(repo, minted.detail));
		return undefined;
	}
	const sent = await shellText(job.host, githubInstallScript(job.jobId, minted.minted.token), 20_000);
	await appendLimenLog(
		job.jobDir,
		sent.code === 0 ? `seat GitHub token for ${repo} for this job` : `seat GitHub token for ${repo} was not delivered`,
	);
	return minted.minted;
}

async function deletePushedBranch(job: RemoteJob): Promise<void> {
	try {
		await git(job.worktree, ["push", "origin", "--delete", job.branch]);
		await appendLimenLog(job.jobDir, `deleted origin/${job.branch}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await appendLimenLog(job.jobDir, `could not delete origin/${job.branch}: ${message}`);
	}
}

async function bringBack(job: RemoteJob, stopping: boolean): Promise<void> {
	try {
		await git(job.worktree, ["fetch", "origin", job.branch]);
		await git(
			job.worktree,
			["merge", "--ff-only", "FETCH_HEAD"],
			`remote host ${job.host.alias} left ${job.branch} where it does not fast-forward the worktree, which stays unchanged`,
		);
		const head = await git(job.worktree, ["rev-parse", "HEAD"]);
		const tip = await git(job.worktree, ["rev-parse", "--verify", `refs/heads/${job.branch}`]).catch(() => "");
		if (tip !== head) {
			await git(job.worktree, ["update-ref", `refs/heads/${job.branch}`, head]);
		}
	} catch (error) {
		if (!stopping) {
			throw error;
		}
		await appendLimenLog(job.jobDir, error instanceof Error ? error.message : String(error));
	}
}

async function finishOutcome(
	job: RemoteJob,
	outcome: Outcome,
	settle: (state: "done" | "failed" | "stopped", detail: string) => Promise<void>,
): Promise<void> {
	if (outcome.seen.stop) {
		await atomicWrite(`${job.jobDir}/stop-reason`, `${outcome.seen.stop}\n`).catch(() => {});
		await appendLimenLog(job.jobDir, `assistant ${outcome.seen.stop}`).catch(() => {});
	}
	if (outcome.cause === "stop" || outcome.signal === "SIGTERM" || outcome.signal === "SIGKILL") {
		await settle("stopped", "stop ended the remote process");
		return;
	}
	if (outcome.cause === "timeout" || outcome.cause === "cap") {
		await settle("failed", outcome.detail);
		return;
	}
	if (outcome.error || outcome.code === null || outcome.code === 255) {
		const reason = outcome.error?.message || outcome.stderr.trim() || "no connection";
		await settle("failed", `ssh ${job.host.ssh} failed: ${reason.slice(0, 500)}`);
		return;
	}
	if (outcome.code === 0) {
		await settleCleanExit(job, outcome, settle);
		return;
	}
	await settle("failed", `worker exited with code ${outcome.code}`);
}

async function settleCleanExit(
	job: RemoteJob,
	outcome: Outcome,
	settle: (state: "done" | "failed" | "stopped", detail: string) => Promise<void>,
): Promise<void> {
	if (outcome.seen.assistant && !(await textFile(`${job.jobDir}/result`))) {
		await atomicWrite(`${job.jobDir}/result`, `${outcome.seen.assistant}\n`).catch(() => {});
	}
	const failedReason = isFailedStopReason(outcome.seen.stop) ? outcome.seen.stop : "";
	await settle(failedReason ? "failed" : "done", failedReason || "pi exited 0");
}

async function streamJob(job: RemoteJob, delivered: Delivered): Promise<Outcome> {
	const task = job.continueTask ?? (await readFile(job.taskFile, "utf8"));
	const launch = piArgs(job);
	const script = launchScript({
		host: job.host,
		jobId: job.jobId,
		branch: job.branch,
		label: job.label,
		piArgs: launch.args,
		bridged: launch.bridged,
		task,
		...(delivered.author ? { author: delivered.author } : {}),
	});
	return watchRemote(job, openRemoteShell(job.host, script), delivered.secrets);
}

function piArgs(job: RemoteJob): { readonly args: string[]; readonly bridged: boolean } {
	const provider = job.provider || undefined;
	const model = job.model || undefined;
	const thinking = job.thinking || undefined;
	const route = engineRoute(ENGINES.pi, provider, model);
	const remoteJob = remoteLayout(job.host, job.jobId).jobDir;
	const extensions = ["finish.ts", "steering.ts", "communication.ts"].map((name) => `${job.host.hook}/${name}`);
	const args = argvFor(ENGINES.pi, {
		jsonMode: true,
		jobDir: remoteJob,
		label: job.label,
		preamble: job.preamble,
		extensions,
		...(route.bridged ? { bridgePath: "__LIMEN_BRIDGE__" } : {}),
		...(provider ? { provider } : {}),
		...(model ? { model } : {}),
		...(thinking ? { thinking } : {}),
		...(job.continueTask !== undefined ? { continueValue: job.continueTask } : { taskFile: `${remoteJob}/task.md` }),
	});
	return { args, bridged: route.bridged };
}

async function watchRemote(
	job: RemoteJob,
	child: ReturnType<typeof openRemoteShell>,
	secrets: readonly string[],
): Promise<Outcome> {
	const parser = createStreamParser();
	const seen: StreamSeen = { activity: "", activityAt: 0, assistant: "", stop: "", tool: "", progress: 0 };
	const cause: { value: Cause; detail: string } = { value: "", detail: "" };
	const pipes = attachPipes(job, child, parser, seen, cause, secrets);
	const onStop = () => endRemote(job, child, cause, "stop", "stop ended the remote process");
	if (job.stop.aborted) {
		onStop();
	} else {
		job.stop.addEventListener("abort", onStop, { once: true });
	}
	const timeout = setTimeout(
		() => endRemote(job, child, cause, "timeout", `timeout after ${job.timeoutMs}ms`),
		job.timeoutMs,
	);
	const steerAt = setTimeout(() => queueDeadlineSteer(job, pipes.failLog), Math.round(job.timeoutMs * 0.8));
	const steerTimer = setInterval(() => {
		void syncSteer(job).catch(pipes.failLog);
	}, steerPollMs());
	const closed = await childClosed(child);
	clearTimeout(timeout);
	clearTimeout(steerAt);
	clearInterval(steerTimer);
	job.stop.removeEventListener("abort", onStop);
	await pipes.finish(parser.flush());
	return { ...closed, cause: cause.value, detail: cause.detail, stderr: pipes.stderr(), seen };
}

function endRemote(
	job: RemoteJob,
	child: ReturnType<typeof openRemoteShell>,
	cause: { value: Cause; detail: string },
	next: Cause,
	detail: string,
): void {
	if (cause.value) {
		return;
	}
	cause.value = next;
	cause.detail = detail;
	void killRemote(job).catch(() => {});
	child.kill("SIGTERM");
}

function attachPipes(
	job: RemoteJob,
	child: ReturnType<typeof openRemoteShell>,
	parser: ReturnType<typeof createStreamParser>,
	seen: StreamSeen,
	cause: { value: Cause; detail: string },
	secrets: readonly string[],
): { failLog(error: unknown): void; finish(events: ReturnType<typeof parser.flush>): Promise<void>; stderr(): string } {
	let tools = 0;
	let pending = Promise.resolve();
	let stderr = "";
	let pendingLine = "";
	const failLog = (error: unknown) => {
		void appendLimenLog(
			job.jobDir,
			`log write failed: ${error instanceof Error ? error.message : String(error)}`,
		).catch(() => {});
	};
	const apply = (events: ReturnType<typeof parser.flush>) => {
		pending = pending
			.then(() =>
				recordStreamEvents(
					job.jobDir,
					events,
					() => {
						tools += 1;
						if (tools >= toolCallCap() && !cause.value) {
							endRemote(job, child, cause, "cap", `tool-call cap reached after ${tools} calls`);
						}
						return tools;
					},
					seen,
				),
			)
			.catch(failLog);
	};
	child.stdout?.setEncoding("utf8");
	child.stderr?.setEncoding("utf8");
	child.stdout?.on("data", (chunk: string) => apply(parser.push(chunk)));
	const writeHost = (chunk: string) => {
		const prefixed = prefixHostChunk(job.host.alias, pendingLine, chunk);
		pendingLine = prefixed.pending;
		const text = redact(prefixed.text, secrets);
		if (!text) {
			return;
		}
		stderr = redact(`${stderr}${text}`, secrets).slice(-2_000);
		pending = pending.then(() => appendFile(`${job.jobDir}/log`, text)).catch(failLog);
	};
	child.stderr?.on("data", (chunk: string) => writeHost(chunk));
	return {
		failLog,
		finish: async (events) => {
			if (pendingLine) {
				writeHost("\n");
			}
			apply(events);
			await pending;
		},
		stderr: () => redact(stderr, secrets),
	};
}

function redact(text: string, secrets: readonly string[]): string {
	let next = redactSecrets(text);
	for (const secret of secrets) {
		if (secret && next.includes(secret)) {
			next = next.split(secret).join("[redacted]");
		}
	}
	return next;
}

function seatAuthor(cwd: string): { readonly name: string; readonly email: string } | undefined {
	const name = localConfig(cwd, "user.name");
	const email = localConfig(cwd, "user.email");
	if (!name || !email || /[\0\r\n]/.test(name) || /[\0\r\n]/.test(email)) {
		return undefined;
	}
	return { name, email };
}

function localConfig(cwd: string, key: string): string {
	const result = spawnSync("git", ["config", "--local", "--get", key], { cwd, encoding: "utf8" });
	return result.status === 0 ? result.stdout.trim() : "";
}

function queueDeadlineSteer(job: RemoteJob, failLog: (error: unknown) => void): void {
	const left = job.timeoutMs - Math.round(job.timeoutMs * 0.8);
	const minutes = Math.max(1, Math.round(left / 60_000));
	const text = `${minutes} min left before the timeout: commit your work or write your verdict now; mark checks you did not run as unverified.`;
	void enqueueSteer(job.jobDir, text).catch(failLog);
}

function childClosed(
	child: ReturnType<typeof openRemoteShell>,
): Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }> {
	const { promise, resolve } = Promise.withResolvers<{
		code: number | null;
		signal: NodeJS.Signals | null;
		error?: Error;
	}>();
	child.once("error", (error) => resolve({ code: null, signal: null, error }));
	child.once("close", (code, signal) => resolve({ code, signal }));
	return promise;
}

async function killRemote(job: RemoteJob): Promise<void> {
	const { jobDir } = remoteLayout(job.host, job.jobId);
	await shellText(job.host, killScript(jobDir), 4_000);
}

async function copyBack(job: RemoteJob): Promise<void> {
	const packed = await shellText(job.host, bundleScript(job.host, job.jobId), 60_000);
	const b64 = packed.stdout.trim();
	if (!b64) {
		return;
	}
	const extracted = spawnSync("tar", ["-xf", "-", "-C", job.jobDir], { input: Buffer.from(b64, "base64") });
	if (extracted.status !== 0) {
		await appendLimenLog(job.jobDir, `remote copy failed: ${extracted.stderr.toString().trim() || extracted.status}`);
	}
}

async function uploadSession(job: RemoteJob): Promise<void> {
	const dir = `${job.jobDir}/session`;
	if (!existsSync(dir) || (await readdir(dir)).length === 0) {
		return;
	}
	const packed = spawnSync("tar", ["-C", dir, "-cf", "-", "."], { maxBuffer: 64 * 1024 * 1024 });
	if (packed.status !== 0 || !packed.stdout?.length) {
		throw new Error(`could not pack the session: ${packed.stderr?.toString().trim() || packed.status}`);
	}
	const remote = `${remoteLayout(job.host, job.jobId).jobDir}/session`;
	const b64 = Buffer.from(packed.stdout).toString("base64");
	const script = `set -eu
mkdir -p ${posixQuote(remote)}
node -e 'const c=[];process.stdin.on("data",d=>c.push(d));process.stdin.on("end",()=>process.stdout.write(Buffer.from(Buffer.concat(c).toString().trim(),"base64")))' <<'LIMEN_SESSION' | tar -C ${posixQuote(remote)} -xf -
${b64}
LIMEN_SESSION
`;
	const sent = await shellText(job.host, script, 60_000);
	if (sent.code !== 0) {
		throw new Error(`could not copy the session to ${job.host.alias}: ${sent.stderr.trim() || sent.code}`);
	}
}

async function syncSteer(job: RemoteJob): Promise<void> {
	const remote = remoteLayout(job.host, job.jobId).jobDir;
	const inbox = `${job.jobDir}/steer/inbox`;
	for (const name of await readdir(inbox).catch(() => [] as string[])) {
		if (!/^[A-Za-z0-9._-]+$/.test(name)) {
			continue;
		}
		const body = await readFile(`${inbox}/${name}`);
		await shellText(job.host, steerPushScript(remote, name, body), 15_000);
	}
	const listed = await shellText(job.host, steerListScript(remote), 15_000);
	for (const name of listed.stdout.split("\n")) {
		await takeDelivered(job.jobDir, inbox, name);
	}
}

async function takeDelivered(jobDir: string, inbox: string, name: string): Promise<void> {
	if (!/^[A-Za-z0-9._-]+$/.test(name) || !existsSync(`${inbox}/${name}`)) {
		return;
	}
	await mkdir(`${jobDir}/steer/delivered`, { recursive: true });
	await rename(`${inbox}/${name}`, `${jobDir}/steer/delivered/${name}`).catch(() => {});
}

/** Git's trimmed stdout. A failure throws `what` with git's own reason. */
function git(cwd: string, args: readonly string[], what = `git ${args.join(" ")} failed`): Promise<string> {
	const { promise, resolve, reject } = Promise.withResolvers<string>();
	execFile(
		"git",
		args,
		{ cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
		(error, stdout, stderr) => {
			if (error) {
				reject(new Error(`${what}: ${(stderr || error.message).trim()}`));
				return;
			}
			resolve(stdout.trim());
		},
	);
	return promise;
}
