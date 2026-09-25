import { spawnSync } from "node:child_process";
import { createHash, createSign, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { claimPath, type GithubBinding, githubDir, originRepository, readBinding } from "./commands/github.ts";
import { type GithubClaim, matchedGithubJob } from "./github-review.ts";

const API = "https://api.github.com";
type Comment = { id: number; body: string | null; created_at: string; html_url: string; issue_url: string; user: { login: string } | null };
type Pull = {
	number: number;
	state: string;
	html_url: string;
	title?: string;
	body?: string | null;
	base: { sha: string; ref: string; repo: { full_name: string } };
	head: { sha: string };
};

function mentionsLimen(body: string): boolean {
	let fence: string | undefined;
	for (const line of body.replace(/<!--[\s\S]*?(?:-->|$)/g, "").split("\n")) {
		const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
		if (marker) {
			if (!fence) fence = marker;
			else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
			continue;
		}
		if (fence || /^\s*>/.test(line) || /^( {4}|\t)/.test(line)) continue;
		const plain = line.replace(/`+[^`]*`+/g, "");
		if (/(^|\s)(?:@limen|\/limen)(?=$|[\s.,!?;:])/i.test(plain)) return true;
	}
	return false;
}

function boundedContext(text: string, limit: number, label: string, link: string): string {
	return text.length > limit ? `${text.slice(0, limit)}\n[${label} truncated; see ${link}]` : text;
}

async function api<T>(path: string, token: string, method = "GET", body?: object): Promise<T> {
	const response = await fetch(`${API}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			...(body ? { "Content-Type": "application/json" } : {}),
		},
		...(body ? { body: JSON.stringify(body) } : {}),
		signal: AbortSignal.timeout(15_000),
	});
	if (!response.ok) throw new Error(`GitHub ${method} ${path.split("?")[0]} returned HTTP ${response.status}`);
	return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

async function installationToken(repo: string, jwt: string): Promise<string> {
	const installation = await api<{ id: number }>(`/repos/${repo}/installation`, jwt);
	const result = await api<{ token: string }>(`/app/installations/${installation.id}/access_tokens`, jwt, "POST", { repositories: [repo.split("/")[1]] });
	if (!result.token) throw new Error(`GitHub did not issue an installation token for ${repo}`);
	return result.token;
}
async function privatePath(path: string, allowed: readonly number[]): Promise<void> {
	const real = await realpath(path);
	for (let parent = dirname(real); ; parent = dirname(parent)) {
		const info = await stat(parent);
		if (!allowed.includes(info.uid) || (info.mode & 0o022) !== 0) throw new Error(`unsafe owner or permissions on ${parent}`);
		if (parent === dirname(parent)) break;
	}
}

async function appJwt(): Promise<string> {
	const id = process.env.LIMEN_GITHUB_APP_ID;
	const path = process.env.LIMEN_GITHUB_KEY_FILE;
	if (!id || !/^\d+$/.test(id) || !path || !isAbsolute(path)) throw new Error("poller needs LIMEN_GITHUB_APP_ID and absolute LIMEN_GITHUB_KEY_FILE");
	const key = await stat(path);
	await privatePath(path, [0, process.getuid?.() ?? -1]);
	if (key.uid !== process.getuid?.() || !key.isFile() || (key.mode & 0o077) !== 0) throw new Error("App key must be a mode-0600 regular file owned by the poller Unix user");
	const now = Math.floor(Date.now() / 1000);
	const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
	const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 540, iss: id })).toString("base64url");
	const signature = createSign("RSA-SHA256")
		.update(`${header}.${payload}`)
		.sign(await readFile(path))
		.toString("base64url");
	return `${header}.${payload}.${signature}`;
}

async function mirror(root: string, claim: GithubClaim): Promise<void> {
	const target = claimPath(root, claim.id);
	const temp = `${target}.${process.pid}.tmp`;
	await writeFile(temp, `${JSON.stringify({ ...claim, outcomeNonce: undefined })}\n`, { mode: 0o660, flag: "wx" });
	await rename(temp, target);
}

async function persist(root: string, state: string, claim: GithubClaim): Promise<void> {
	const target = join(state, "claims", `${claim.id}.json`);
	const temp = `${target}.${process.pid}.tmp`;
	await writeFile(temp, `${JSON.stringify(claim)}\n`, { mode: 0o600, flag: "wx", flush: true });
	await rename(temp, target);
	await mirror(root, claim); // worker-readable handoff, never an input to App posting
}

async function existingReceipt(repo: string, pr: number, marker: string, token: string): Promise<number | undefined> {
	for (let page = 1; ; page++) {
		const comments = await api<Array<{ id: number; body: string | null; performed_via_github_app: { id: number } | null }>>(
			`/repos/${repo}/issues/${pr}/comments?per_page=100&page=${page}`,
			token,
		);
		const found = comments.find((comment) => comment.performed_via_github_app?.id === Number(process.env.LIMEN_GITHUB_APP_ID) && comment.body?.includes(marker));
		if (found) return found.id;
		if (comments.length < 100) return undefined;
	}
}

async function reply(root: string, state: string, claim: GithubClaim, token: string, kind: "start" | "terminal" | "notice", body: string): Promise<void> {
	const field = kind === "start" ? "startComment" : kind === "terminal" ? "terminalComment" : "noticeComment";
	if (claim[field]) return;
	const marker = `<!-- limen-github ${claim.repo.toLowerCase()} ${claim.id} ${kind} -->`;
	const prior = await existingReceipt(claim.repo, claim.pr, marker, token);
	const posted = prior ?? (await api<{ id: number }>(`/repos/${claim.repo}/issues/${claim.pr}/comments`, token, "POST", { body: `${body}\n\n${marker}` })).id;
	claim[field] = posted;
	await persist(root, state, claim);
}

// The test seam also reads authority from the private store; a checkout claim is never an input.
export async function reconcileGithubClaim(root: string, state: string, id: number, token: string): Promise<void> {
	let claim: GithubClaim;
	try {
		claim = JSON.parse(await readFile(join(state, "claims", `${id}.json`), "utf8")) as GithubClaim;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	await reconcile(root, state, claim, token);
}

async function reconcile(root: string, state: string, claim: GithubClaim, token: string): Promise<void> {
	const found = await matchedGithubJob(root, claim);
	if (claim.receipt === "resolved") {
		await reply(
			root,
			state,
			claim,
			token,
			"terminal",
			`A seat-recorded answer for PR #${claim.pr} without starting a job (shared worker/coordinator account; answer text is not independently authenticated):\n\n${claim.answer ?? "No answer recorded."}\n\nNo review approval or merge occurred.`,
		);
		return;
	}
	if (!found) {
		if (
			claim.receipt === "prompt accepted" ||
			claim.receipt?.startsWith("handoff attempted; outcome unconfirmed") ||
			claim.receipt?.startsWith("pending: no matching job record")
		) {
			const binding = await readBinding(root);
			const outcome = await readFile(join(githubDir(root), "outcomes", `${claim.id}.json`), "utf8")
				.then((text) => JSON.parse(text) as { repo: string; id: number; coordinator: string; nonce: string; answer: string })
				.catch(() => undefined);
			if (
				binding &&
				claim.outcomeNonce &&
				outcome?.nonce === claim.outcomeNonce &&
				typeof outcome.repo === "string" &&
				outcome.repo.toLowerCase() === claim.repo.toLowerCase() &&
				binding.repo.toLowerCase() === claim.repo.toLowerCase() &&
				originRepository(root, true).toLowerCase() === claim.repo.toLowerCase() &&
				outcome.id === claim.id &&
				outcome.coordinator === binding.coordinator &&
				typeof outcome.answer === "string" &&
				outcome.answer.trim() &&
				outcome.answer.length <= 1600
			) {
				claim.answer = outcome.answer.trim();
				claim.receipt = "resolved";
				await persist(root, state, claim);
				await reply(
					root,
					state,
					claim,
					token,
					"terminal",
					`A seat-recorded answer for PR #${claim.pr} without starting a job (shared worker/coordinator account; answer text is not independently authenticated):\n\n${claim.answer}\n\nNo review approval or merge occurred.`,
				);
				return;
			}
		}
		if (claim.receipt?.startsWith("pending: coordinator unavailable") && Date.now() - Date.parse(claim.attemptedAt ?? "") > 30_000) {
			const binding = await readBinding(root);
			if (binding && binding.repo.toLowerCase() === claim.repo.toLowerCase() && originRepository(root, true).toLowerCase() === claim.repo.toLowerCase())
				await handoff(root, state, binding, claim, token);
		}
		if ((claim.receipt?.startsWith("handoff attempted; outcome unconfirmed") || claim.receipt === "prompt accepted") && Date.now() - Date.parse(claim.attemptedAt ?? "") > 90_000) {
			claim.receipt = "pending: no matching job record; inspect coordinator before retry";
			await persist(root, state, claim);
			await reply(
				root,
				state,
				claim,
				token,
				"notice",
				`Limen request for PR #${claim.pr} is pending: handoff to the Herdr coordinator is unconfirmed and no hosted job has been observed. Inspect this seat's .limen/github/claims/${claim.id}.json; no detached fallback was started.`,
			);
		}
		return;
	}
	if (!claim.job || claim.receipt !== found.state) {
		claim.job = found.id;
		claim.branch = found.branch;
		claim.receipt = found.state;
		await persist(root, state, claim);
	}
	if (!found.started) {
		if (found.state !== "running")
			await reply(
				root,
				state,
				claim,
				token,
				"notice",
				`Limen created job \`${found.id}\` for PR #${claim.pr}, but the hosted agent never started (state: ${found.state}). Inspect \`limen jobs ${found.id}\` on the owning seat. No review approval or detached fallback occurred.`,
			);
		return;
	}
	await reply(
		root,
		state,
		claim,
		token,
		"start",
		`Limen started a hosted ${found.review ? "review" : "task"} for PR #${claim.pr}${found.review ? ` at pinned head \`${claim.head}\` against base \`${claim.base}\`` : " from the registered repository"}. Job: \`${found.id}\`; branch: \`${found.branch}\`. On its owning seat: \`limen jobs ${found.id}\`. This is not an approval.`,
	);
	if (!found.state || found.state === "running") return;
	const dir = join(root, ".limen/jobs", found.id);
	const [result, log] = await Promise.all(["result", "log"].map((name) => readFile(join(dir, name), "utf8").catch(() => "")));
	const evidence = (result ?? "").trim().slice(0, 1600) || (log ?? "").trim().split("\n").slice(-10).join("\n").slice(0, 1600) || "No result or check evidence recorded.";
	await reply(
		root,
		state,
		claim,
		token,
		"terminal",
		`Limen hosted ${found.review ? "review" : "task"} job \`${found.id}\` ended with state **${found.state}**. This is job termination, not review approval or a merge.\n\nRecorded evidence/result:\n\n\`\`\`text\n${evidence.replaceAll("```", "''' ")}\n\`\`\`\n\nInspect on the owning seat: \`limen jobs ${found.id}\`.`,
	);
}

export { accept as acceptGithubComment };

async function accept(root: string, state: string, binding: GithubBinding, comment: Comment, token: string): Promise<void> {
	if (!comment.body || !mentionsLimen(comment.body) || !comment.user || Date.parse(comment.created_at) < Date.parse(binding.connectedAt)) return;
	if (!Number.isSafeInteger(comment.id) || comment.id < 1) throw new Error("GitHub comment has an invalid ID");
	const pr = Number(/\/issues\/(\d+)$/.exec(comment.issue_url)?.[1]);
	if (!Number.isSafeInteger(pr) || pr < 1) return;
	let permission: { permission: string };
	try {
		permission = await api<{ permission: string }>(`/repos/${binding.repo}/collaborators/${encodeURIComponent(comment.user.login)}/permission`, token);
	} catch (error) {
		if (String(error).includes("HTTP 404")) return;
		throw error;
	}
	if (!["admin", "write", "maintain"].includes(permission.permission)) return;
	let pull: Pull;
	try {
		pull = await api<Pull>(`/repos/${binding.repo}/pulls/${pr}`, token);
	} catch (error) {
		if (String(error).includes("HTTP 404")) return;
		throw error;
	}
	if (pull.state !== "open" || pull.number !== pr || pull.base.repo.full_name.toLowerCase() !== binding.repo.toLowerCase()) return;
	if (!/^[0-9a-f]{40}$/.test(pull.head.sha) || !/^[0-9a-f]{40}$/.test(pull.base.sha) || !/^[\w./-]+$/.test(pull.base.ref)) throw new Error("GitHub returned invalid PR refs");
	const path = join(state, "claims", `${comment.id}.json`);
	let claim: GithubClaim;
	try {
		claim = JSON.parse(await readFile(path, "utf8")) as GithubClaim;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		const discussion: string[] = [];
		for (const endpoint of [`/repos/${binding.repo}/issues/${pr}/comments`, `/repos/${binding.repo}/pulls/${pr}/comments`, `/repos/${binding.repo}/pulls/${pr}/reviews`]) {
			let entries: Array<{ id: number; body: string | null; user: { login: string } | null }>;
			try {
				entries = await api<typeof entries>(`${endpoint}?per_page=100`, token);
			} catch (error) {
				if (!endpoint.includes("/issues/") && /HTTP (403|404)/.test(String(error))) {
					discussion.push(`[${endpoint.split("/").at(-1)} unavailable via App; see https://github.com/${binding.repo}/pull/${pr}]`);
					continue;
				}
				throw error;
			}
			let used = 0;
			for (const entry of entries) {
				if (endpoint.includes("/issues/") && entry.id === comment.id) continue;
				const body = entry.body ?? "";
				const line = `${entry.user?.login ?? "unknown"}: ${body.slice(0, 1200)}${body.length > 1200 ? " [comment excerpt truncated]" : ""}`;
				if (used + line.length > 3500) {
					discussion.push(`[Further ${endpoint.split("/").at(-1)} omitted; see https://github.com/${binding.repo}/pull/${pr}]`);
					break;
				}
				discussion.push(line);
				used += line.length;
			}
			if (entries.length === 100) discussion.push(`[More ${endpoint.split("/").at(-1)} may exist; first 100 fetched at https://github.com/${binding.repo}/pull/${pr}]`);
		}
		const excerpt = discussion.join("\n");
		claim = {
			repo: binding.repo,
			id: comment.id,
			pr,
			actor: comment.user.login,
			url: comment.html_url,
			base: pull.base.sha,
			baseRef: pull.base.ref,
			head: pull.head.sha,
			title: boundedContext(pull.title ?? "", 500, "PR title", `https://github.com/${binding.repo}/pull/${pr}`),
			body: boundedContext(pull.body ?? "", 6000, "PR body", `https://github.com/${binding.repo}/pull/${pr}`),
			discussion: excerpt.length > 12000 ? `${excerpt.slice(0, 12000)}\n[Discussion truncated; see https://github.com/${binding.repo}/pull/${pr}]` : excerpt,
			outcomeNonce: randomBytes(24).toString("hex"),
			command: boundedContext(comment.body, 4000, "Triggering comment", comment.html_url),
		};
		await writeFile(path, `${JSON.stringify(claim)}\n`, { flag: "wx", mode: 0o600, flush: true }); // authoritative claim before handoff
		await mirror(root, claim);
	}
	if (claim.receipt || claim.job) {
		await reconcile(root, state, claim, token);
		return;
	}
	await handoff(root, state, binding, claim, token);
}

async function handoff(root: string, state: string, binding: GithubBinding, claim: GithubClaim, token: string): Promise<void> {
	claim.outcomeNonce ??= randomBytes(24).toString("hex");
	claim.attemptedAt = new Date().toISOString();
	claim.receipt = "pending: coordinator unavailable";
	await persist(root, state, claim);
	const command = process.env.LIMEN_GITHUB_LIMEN_BIN || "/opt/limen/bin/limen";
	const ensure = spawnSync("sudo", ["-n", "-u", binding.user, "--", command, "github", "ensure", root], { encoding: "utf8", timeout: 20_000 });
	if (ensure.status !== 0) {
		await reply(
			root,
			state,
			claim,
			token,
			"notice",
			`Limen could not reach the registered Herdr coordinator for PR #${claim.pr}. The request remains pending on its owning seat (.limen/github/claims/${claim.id}.json). No detached job was started.`,
		);
		return;
	}
	// Record an ambiguous attempt before invoking Herdr. Never blindly prompt twice after this point.
	claim.receipt = "handoff attempted; outcome unconfirmed";
	await persist(root, state, claim);
	const delivered = spawnSync("sudo", ["-n", "-u", binding.user, "--", command, "github", "deliver", root, String(claim.id), claim.outcomeNonce], {
		encoding: "utf8",
		timeout: 20_000,
	});
	if (delivered.status !== 0) {
		claim.receipt = /(?:bare.shell|not an available shell|agent_not_found|target_not_found)/i.test(delivered.stderr ?? "")
			? "pending: coordinator unavailable (Herdr refused prompt before acceptance)"
			: `handoff attempted; outcome unconfirmed (${(delivered.stderr || delivered.error?.message || "unavailable").trim().slice(0, 250)})`;
		await persist(root, state, claim);
		await reply(
			root,
			state,
			claim,
			token,
			"notice",
			`Limen could not confirm delivery to the Herdr coordinator for PR #${claim.pr}. The request remains pending for inspection on its owning seat (.limen/github/claims/${claim.id}.json). No detached job was started.`,
		);
		return;
	}
	claim.receipt = "prompt accepted";
	await persist(root, state, claim);
	await reconcile(root, state, claim, token);
}

async function project(root: string, stateDir: string, jwt: string): Promise<void> {
	const binding = await readBinding(root);
	if (!binding || originRepository(root, true).toLowerCase() !== binding.repo.toLowerCase()) return;
	const state = join(stateDir, createHash("sha256").update(root).digest("hex"));
	await mkdir(join(state, "claims"), { recursive: true, mode: 0o700 });
	for (const dir of [state, join(state, "claims")]) {
		const info = await stat(dir);
		if (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || !info.isDirectory()) throw new Error(`unsafe poller claim directory ${dir}`);
	}
	const lock = join(githubDir(root), "poll.lock");
	await writeFile(lock, `${process.pid}\n`, { flag: "wx", mode: 0o660 });
	try {
		if ((await readBinding(root))?.connectedAt !== binding.connectedAt) return; // disconnect won the race
		const identity = spawnSync("id", ["-u", binding.user], { encoding: "utf8" });
		const groups = spawnSync("id", ["-nG", binding.user], { encoding: "utf8" });
		if (
			identity.status !== 0 ||
			Number(identity.stdout.trim()) !== Number(process.env.LIMEN_GITHUB_WORKER_UID) ||
			groups.status !== 0 ||
			/\b(?:sudo|wheel|admin)\b/.test(groups.stdout)
		)
			throw new Error("registered coordinator has unsafe Unix privileges; disconnect until its sudo access is removed");
		const token = await installationToken(binding.repo, jwt); // a token scoped to this installed repository only
		const claimsDir = join(state, "claims");
		for (const entry of await readdir(claimsDir)) {
			if (!/^\d+\.json$/.test(entry)) continue;
			const claim = JSON.parse(await readFile(join(claimsDir, entry), "utf8")) as GithubClaim;
			if (claim.repo.toLowerCase() === binding.repo.toLowerCase()) await reconcile(root, state, claim, token);
		}
		// Keep a durable cursor, with one second overlap for comments sharing a GitHub timestamp.
		const cursorPath = join(state, "cursor.json");
		const cursor = await readFile(cursorPath, "utf8").then(
			(text) => JSON.parse(text) as { id: number; createdAt: string },
			() => ({ id: 0, createdAt: binding.connectedAt }),
		);
		const since = new Date(Math.max(Date.parse(binding.connectedAt), Date.parse(cursor.createdAt) - 1000)).toISOString().replace(/\.\d{3}Z$/, "Z");
		for (let page = 1; ; page++) {
			const comments = await api<Comment[]>(
				`/repos/${binding.repo}/issues/comments?sort=created&direction=asc&since=${encodeURIComponent(since)}&per_page=100&page=${page}`,
				token,
			);
			for (const comment of comments) {
				if (comment.id <= cursor.id) continue;
				await accept(root, state, binding, comment, token);
				cursor.id = comment.id;
				cursor.createdAt = comment.created_at;
				const temp = `${cursorPath}.${process.pid}.tmp`;
				await writeFile(temp, `${JSON.stringify(cursor)}\n`, { flag: "wx", mode: 0o600 });
				await rename(temp, cursorPath);
			}
			if (comments.length < 100) break;
		}
	} finally {
		await rm(lock, { force: true });
	}
}

export async function pollGithub(): Promise<void> {
	const registry = process.env.LIMEN_GITHUB_PROJECTS_FILE;
	if (!registry || !isAbsolute(registry) || process.getuid?.() === 0) throw new Error("github poll requires an isolated non-root poller and absolute LIMEN_GITHUB_PROJECTS_FILE");
	const stateDir = process.env.LIMEN_GITHUB_STATE_DIR;
	if (!stateDir || !isAbsolute(stateDir)) throw new Error("github poll requires absolute LIMEN_GITHUB_STATE_DIR");
	const stateInfo = await stat(stateDir);
	if (!stateInfo.isDirectory() || stateInfo.uid !== process.getuid?.() || (stateInfo.mode & 0o077) !== 0)
		throw new Error("poller state directory must be private and poller-owned");
	await privatePath(stateDir, [0, process.getuid?.() ?? -1]);
	const workerUid = Number(process.env.LIMEN_GITHUB_WORKER_UID);
	if (!Number.isSafeInteger(workerUid) || workerUid <= 0) throw new Error("poller requires LIMEN_GITHUB_WORKER_UID");
	if (process.getuid?.() === workerUid) throw new Error("poller and hosted workers must have different Unix users");
	const modulePath = await realpath(fileURLToPath(import.meta.url));
	const file = await stat(modulePath);
	if ((file.mode & 0o022) !== 0 || file.uid === workerUid) throw new Error("poller code must not be writable by the worker account");
	await privatePath(modulePath, [0, process.getuid?.() ?? -1]);
	const jwt = await appJwt();
	const projects = [...new Set((await readFile(registry, "utf8")).split("\n").filter(Boolean))];
	for (const root of projects) {
		try {
			if (resolve(root) === root) await project(root, stateDir, jwt);
		} catch (error) {
			console.error(`${root}: ${error instanceof Error ? error.message : String(error)}`);
			process.exitCode = 1;
		}
	}
}
