import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** The longest no-job answer that `github resolve` writes and the poller posts. */
export const GITHUB_ANSWER_MAX = 1600;
/** Random bytes in the poller's handoff nonce; its hex text is twice as long. */
export const HANDOFF_NONCE_BYTES = 24;
export const HANDOFF_NONCE = new RegExp(`^[0-9a-f]{${HANDOFF_NONCE_BYTES * 2}}$`);

export type GithubBinding = { repo: string; coordinator: string; user: string; connectedAt: string };
export const githubDir = (root: string) => join(root, ".limen/github");
export const bindingPath = (root: string) => join(githubDir(root), "binding.json");
export const claimPath = (root: string, id: number | string) => join(githubDir(root), "claims", `${id}.json`);
// A comment claim is named by its comment ID, an issue body claim by `issue-<number>`; the two never share a name.
export const claimId = (text: string): number | string | undefined =>
	/^\d+$/.test(text) ? Number(text) : /^issue-\d+$/.test(text) ? text : undefined;
export function originRepository(root: string, foreign = false): string {
	const result = spawnSync(
		"git",
		[...(foreign ? ["-c", `safe.directory=${root}`] : []), "remote", "get-url", "origin"],
		{ cwd: root, encoding: "utf8" },
	);
	if (result.status !== 0) {
		throw new Error("github connect requires an origin remote");
	}
	const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(
		result.stdout.trim(),
	);
	if (!match) {
		throw new Error("github connect requires a github.com origin (HTTPS or SSH)");
	}
	return match[1] as string;
}

export async function readBinding(root: string): Promise<GithubBinding | undefined> {
	try {
		const value = JSON.parse(await readFile(bindingPath(root), "utf8")) as GithubBinding;
		if (!/^[\w.-]+\/[\w.-]+$/.test(value.repo) || !value.coordinator || !value.user || !value.connectedAt) {
			throw new Error("invalid GitHub binding");
		}
		return value;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
}

export type HerdrAgentRow = { pane_id?: string; agent_status?: string; interactive_ready?: boolean };

// Herdr skips screen detection for some engines (OMP) and then omits interactive_ready; only an explicit false means not ready.
export function liveCoordinator(agent: HerdrAgentRow | undefined, pane: string): boolean {
	return (
		agent?.pane_id === pane &&
		["idle", "working", "blocked", "done"].includes(agent.agent_status ?? "") &&
		agent.interactive_ready !== false
	);
}

// `pr` is the issue or pull request number; GitHub numbers both in one sequence. An issue claim has no base or head.
// `id` is the triggering comment ID, or `issue-<number>` when the issue body itself carries the request.
export type GithubClaim = {
	repo: string;
	id: number | string;
	pr: number;
	actor: string;
	url: string;
	title?: string;
	body?: string;
	discussion?: string;
	command?: string;
	answer?: string;
	outcomeNonce?: string; // poller-private; never mirrored into the checkout claim
	receipt?: string;
	attemptedAt?: string;
	job?: string;
	branch?: string;
	startComment?: number;
	terminalComment?: number;
	noticeComment?: number;
} & (
	| { kind?: undefined; base: string; baseRef: string; head: string }
	| { kind: "issue"; base?: undefined; baseRef?: undefined; head?: undefined }
);

export const githubMarker = (claim: GithubClaim) => `GitHub doorbell: ${claim.repo.toLowerCase()}#${claim.id}`;
export const githubSubject = (claim: GithubClaim) => `${claim.kind === "issue" ? "issue" : "PR"} #${claim.pr}`;
export const githubBranch = (claim: GithubClaim) =>
	`limen/github-${claim.kind === "issue" ? "issue" : "pr"}-${claim.pr}-${claim.id}`;

export async function matchedGithubJob(
	root: string,
	claim: GithubClaim,
): Promise<{ id: string; branch: string; state: string; started: boolean; review: boolean } | undefined> {
	const jobs = await readdir(join(root, ".limen/jobs"), { withFileTypes: true }).catch(() => []);
	for (const job of jobs) {
		if (!job.isDirectory()) {
			continue;
		}
		const dir = join(root, ".limen/jobs", job.name);
		const [task, hosted, candidate, base, branch, state, role] = await Promise.all(
			["task.md", "hosted", "candidate", "base", "branch", "state", "role"].map((name) =>
				readFile(join(dir, name), "utf8").catch(() => ""),
			),
		);
		if (!(task ?? "").startsWith(`${githubMarker(claim)}\n`)) {
			continue;
		}
		if (!state?.trim()) {
			return undefined; // spawn publishes the job directory before its fields are complete
		}
		const isReview = claim.kind !== "issue" && candidate?.trim() === claim.head && base?.trim() === claim.base;
		const isWork =
			!candidate?.trim() &&
			/^[0-9a-f]{40}$/.test(base?.trim() ?? "") &&
			role?.trim() === "worker" &&
			branch?.trim() === githubBranch(claim);
		if (!hosted || (!isReview && !isWork)) {
			throw new Error(`conflicting job ${job.name} for ${githubMarker(claim)}; inspect it before retrying`);
		}
		const agent = await readFile(join(dir, "herdr/agent"), "utf8").catch(() => "");
		return {
			id: job.name,
			branch: branch?.trim() ?? "",
			state: state?.trim() ?? "",
			started: Boolean(agent.trim()),
			review: isReview,
		};
	}
	return undefined;
}
