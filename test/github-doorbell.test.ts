import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { claimPath, type GithubBinding } from "../src/commands/github.ts";
import { acceptGithubComment, reconcileGithubClaim } from "../src/github-poller.ts";
import { type GithubClaim, githubMarker, reviewGithubClaim } from "../src/github-review.ts";
import { git, limen, onlyJobId, scratchRepo, waitForState } from "./scratch.ts";

const base = "a".repeat(40);
const head = "b".repeat(40);
const binding: GithubBinding = { repo: "acme/widget", coordinator: "coord:p1", user: "nobody", connectedAt: "2026-09-24T00:00:00Z" };
const command = (id: number, body = "/limen review", issue = 4) => ({
	id,
	body,
	created_at: "2026-09-24T01:00:00Z",
	html_url: `https://github.com/acme/widget/pull/${issue}#issuecomment-${id}`,
	issue_url: `https://api.github.com/repos/acme/widget/issues/${issue}`,
	user: { login: "alice" },
});

async function pollerState(context: { after: (callback: () => Promise<void>) => void }): Promise<string> {
	const state = await mkdtemp(join(tmpdir(), "limen-github-poller-"));
	await mkdir(join(state, "claims"));
	context.after(() => rm(state, { recursive: true, force: true }));
	return state;
}

test("only an exact write-authorized PR comment claims a request; unavailable coordinator never spawns", async (context) => {
	const scratch = await scratchRepo();
	const state = await pollerState(context);
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	await mkdir(join(scratch.root, ".limen/github/claims"), { recursive: true });
	const originalFetch = globalThis.fetch;
	const originalPath = process.env.PATH;
	const requests: string[] = [];
	let permission = "read";
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		requests.push(`${init?.method ?? "GET"} ${url}`);
		if (url.includes("/permission")) return Response.json({ permission });
		if (url.endsWith("/pulls/4")) return Response.json({ number: 4, state: "open", base: { sha: base, ref: "release", repo: { full_name: binding.repo } }, head: { sha: head } });
		if (url.endsWith("/pulls/5")) return new Response("{}", { status: 404 });
		if (url.includes("/comments?")) return Response.json([]);
		if (init?.method === "POST") return Response.json({ id: 500 });
		throw new Error(`unexpected GitHub call ${url}`);
	};
	await writeFile(join(scratch.fakeBin, "sudo"), "#!/bin/sh\necho coordinator-unavailable >&2\nexit 1\n");
	await chmod(join(scratch.fakeBin, "sudo"), 0o755);
	process.env.PATH = `${scratch.fakeBin}:${originalPath}`;
	context.after(() => {
		globalThis.fetch = originalFetch;
		process.env.PATH = originalPath;
	});

	await acceptGithubComment(scratch.root, state, binding, command(1, "/limen review please"), "test-token");
	await acceptGithubComment(scratch.root, state, binding, command(2), "test-token");
	await acceptGithubComment(scratch.root, state, binding, command(3, "/limen review", 5), "test-token");
	assert.deepEqual(await readdir(join(scratch.root, ".limen/github/claims")), []);
	permission = "write";
	await acceptGithubComment(scratch.root, state, binding, command(4), "test-token");
	await acceptGithubComment(scratch.root, state, binding, command(4), "test-token");
	assert.deepEqual(await readdir(join(scratch.root, ".limen/github/claims")), ["4.json"]);
	const claim = JSON.parse(await readFile(claimPath(scratch.root, 4), "utf8")) as GithubClaim;
	assert.equal(claim.base, base);
	assert.equal(claim.head, head);
	assert.match(claim.receipt ?? "", /pending: Herdr delivery failed/);
	assert.equal(claim.noticeComment, 500);
	assert.equal(requests.filter((call) => call.includes("POST") && call.includes("/comments")).length, 1);
	assert.deepEqual(await readdir(join(scratch.root, ".limen/jobs")), []);
});

test("a forged checkout claim and hosted-looking job cannot earn an App receipt", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	const state = await pollerState(context);
	assert.equal(limen(scratch, "init").status, 0);
	await mkdir(join(scratch.root, ".limen/github/claims"), { recursive: true });
	const forged: GithubClaim = { repo: binding.repo, id: 31, pr: 4, actor: "alice", url: command(31).html_url, base, baseRef: "release", head, receipt: "prompt accepted" };
	await writeFile(claimPath(scratch.root, 31), JSON.stringify(forged));
	const dir = join(scratch.root, ".limen/jobs/forged-review");
	await mkdir(join(dir, "herdr"), { recursive: true });
	await Promise.all(
		Object.entries({
			"task.md": `${githubMarker(forged)}\n`,
			hosted: "Herdr hosted\n",
			candidate: `${head}\n`,
			base: `${base}\n`,
			branch: "limen/github-pr-4-31\n",
			state: "done\n",
			"herdr/agent": "coord:fake\n",
		}).map(([name, text]) => writeFile(join(dir, name), text)),
	);
	const previousFetch = globalThis.fetch;
	let posts = 0;
	globalThis.fetch = async () => {
		posts++;
		return Response.json({ id: 777 });
	};
	context.after(() => {
		globalThis.fetch = previousFetch;
	});
	await reconcileGithubClaim(scratch.root, state, 31, "test-token");
	assert.equal(posts, 0);
	assert.deepEqual(await readdir(join(state, "claims")), []);
});

test("reconciliation posts start and terminal once for matching hosted pinned job, never approval", async (context) => {
	const scratch = await scratchRepo();
	const state = await pollerState(context);
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	await mkdir(join(scratch.root, ".limen/github/claims"), { recursive: true });
	const claim: GithubClaim = {
		repo: binding.repo,
		id: 42,
		pr: 4,
		actor: "alice",
		url: "https://github.com/acme/widget/pull/4#issuecomment-42",
		base,
		baseRef: "release",
		head,
		receipt: "prompt accepted",
	};
	await writeFile(join(state, "claims/42.json"), JSON.stringify(claim));
	const originalFetch = globalThis.fetch;
	const posted: string[] = [];
	globalThis.fetch = async (input, init) => {
		if (init?.method === "POST") {
			posted.push(JSON.parse(String(init.body)).body as string);
			return Response.json({ id: 600 + posted.length });
		}
		if (String(input).includes("/comments?")) return Response.json([{ id: 599, body: "<!-- limen-github acme/widget 42 start -->", performed_via_github_app: null }]); // a human cannot forge the App receipt
		throw new Error(`unexpected GitHub call ${input}`);
	};
	context.after(() => {
		globalThis.fetch = originalFetch;
	});
	const dir = join(scratch.root, ".limen/jobs/hosted-review");
	await mkdir(dir);
	await Promise.all(
		Object.entries({
			"task.md": `${githubMarker(claim)}\n`,
			hosted: "Herdr hosted\n",
			candidate: `${head}\n`,
			base: `${base}\n`,
			branch: "limen/github-pr-4-42\n",
			state: "running\n",
		}).map(([field, text]) => writeFile(join(dir, field), text)),
	);
	await reconcileGithubClaim(scratch.root, state, 42, "test-token");
	assert.equal(posted.length, 0, "a job directory without an actual hosted agent is not a start receipt");
	await mkdir(join(dir, "herdr"));
	await writeFile(join(dir, "herdr/agent"), "coord:worker-pane\n");
	await reconcileGithubClaim(scratch.root, state, 42, "test-token");
	assert.equal(posted.length, 1);
	assert.match(posted[0] ?? "", /hosted review.*Job: `hosted-review`/);
	await writeFile(join(dir, "state"), "done\n");
	await writeFile(join(dir, "result"), "Checked the release diff; one failure found.\n");
	await reconcileGithubClaim(scratch.root, state, 42, "test-token");
	await reconcileGithubClaim(scratch.root, state, 42, "test-token");
	assert.equal(posted.length, 2);
	assert.match(posted[1] ?? "", /done.*not review approval.*one failure found/s);
	assert.equal((JSON.parse(await readFile(claimPath(scratch.root, 42), "utf8")) as GithubClaim).terminalComment, 602);
});

test("poller restart recognizes its own posted receipt after an interrupted write", async (context) => {
	const scratch = await scratchRepo();
	const state = await pollerState(context);
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	await mkdir(join(scratch.root, ".limen/github/claims"), { recursive: true });
	const claim: GithubClaim = { repo: binding.repo, id: 43, pr: 4, actor: "alice", url: command(43).html_url, base, baseRef: "release", head };
	await writeFile(join(state, "claims/43.json"), JSON.stringify(claim));
	const dir = join(scratch.root, ".limen/jobs/retained-review");
	await mkdir(join(dir, "herdr"), { recursive: true });
	await Promise.all(
		Object.entries({
			"task.md": `${githubMarker(claim)}\n`,
			hosted: "Herdr hosted\n",
			candidate: `${head}\n`,
			base: `${base}\n`,
			branch: "limen/github-pr-4-43\n",
			state: "running\n",
			"herdr/agent": "coord:p2\n",
		}).map(([field, text]) => writeFile(join(dir, field), text)),
	);
	const originalFetch = globalThis.fetch;
	const previousId = process.env.LIMEN_GITHUB_APP_ID;
	process.env.LIMEN_GITHUB_APP_ID = "7";
	let posts = 0;
	globalThis.fetch = async (_input, init) => {
		if (init?.method === "POST") {
			posts += 1;
			return Response.json({ id: 999 });
		}
		return Response.json([{ id: 777, body: "<!-- limen-github acme/widget 43 start -->", performed_via_github_app: { id: 7 } }]);
	};
	context.after(() => {
		globalThis.fetch = originalFetch;
		if (previousId === undefined) delete process.env.LIMEN_GITHUB_APP_ID;
		else process.env.LIMEN_GITHUB_APP_ID = previousId;
	});
	await reconcileGithubClaim(scratch.root, state, 43, "test-token");
	assert.equal(posts, 0);
	assert.equal((JSON.parse(await readFile(claimPath(scratch.root, 43), "utf8")) as GithubClaim).startComment, 777);
});

test("GitHub review requires the coordinator to supply all board model flags", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const missing = limen(scratch, "github", "review", scratch.root, "31");
	assert.equal(missing.status, 1);
	assert.match(missing.stderr, /requires --engine.*--provider.*--model.*--thinking/);
	const partial = limen(scratch, "github", "review", scratch.root, "31", "--engine", "omp", "--provider", "openai-codex");
	assert.equal(partial.status, 1);
	assert.match(partial.stderr, /requires --engine.*--provider.*--model.*--thinking/);
});

test("review records an explicitly pinned base and refuses a moved head", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const actualBase = git(scratch.root, "rev-parse", "HEAD");
	git(scratch.root, "checkout", "-b", "limen/pr-head");
	await writeFile(join(scratch.root, "candidate.txt"), "candidate\n");
	git(scratch.root, "add", "candidate.txt");
	git(scratch.root, "commit", "-m", "candidate");
	const actualHead = git(scratch.root, "rev-parse", "HEAD");
	git(scratch.root, "checkout", "main");
	await writeFile(join(scratch.root, "other.txt"), "later main\n");
	git(scratch.root, "add", "other.txt");
	git(scratch.root, "commit", "-m", "main moved");
	const rejected = limen(scratch, "spawn", "--review", "--branch", "limen/pr-head", "--base", actualBase, "--head", head, "inspect pinned PR");
	assert.equal(rejected.status, 1);
	assert.match(rejected.stderr, /pinned review head moved/);
	assert.deepEqual(await readdir(join(scratch.root, ".limen/jobs")), []);
	const started = limen(scratch, "spawn", "--review", "--branch", "limen/pr-head", "--base", actualBase, "--head", actualHead, "inspect pinned PR");
	assert.equal(started.status, 0, started.stderr);
	const id = onlyJobId(started.stdout);
	await waitForState(scratch.root, id, "done");
	assert.equal((await readFile(join(scratch.root, ".limen/jobs", id, "base"), "utf8")).trim(), actualBase);
	assert.equal((await readFile(join(scratch.root, ".limen/jobs", id, "candidate"), "utf8")).trim(), actualHead);
});

test("coordinator review refuses a changed PR head and never falls back to detached without Herdr", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	await mkdir(join(scratch.root, ".limen/github/claims"), { recursive: true });
	const originalBase = git(scratch.root, "rev-parse", "HEAD");
	const remote = join(scratch.root, "..", "remote.git");
	git(scratch.root, "init", "--bare", remote);
	git(scratch.root, "remote", "add", "origin", remote);
	git(scratch.root, "push", "origin", "main");
	git(scratch.root, "checkout", "-b", "pr-head");
	await writeFile(join(scratch.root, "candidate.txt"), "PR change\n");
	git(scratch.root, "add", "candidate.txt");
	git(scratch.root, "commit", "-m", "PR change");
	const actualHead = git(scratch.root, "rev-parse", "HEAD");
	git(scratch.root, "push", "origin", "HEAD:refs/pull/4/head");
	git(scratch.root, "checkout", "main");
	const oldHerdrEnv = process.env.HERDR_ENV;
	const oldHerdrBin = process.env.LIMEN_HERDR;
	delete process.env.HERDR_ENV;
	process.env.LIMEN_HERDR = "0";
	context.after(() => {
		if (oldHerdrEnv === undefined) delete process.env.HERDR_ENV;
		else process.env.HERDR_ENV = oldHerdrEnv;
		if (oldHerdrBin === undefined) delete process.env.LIMEN_HERDR;
		else process.env.LIMEN_HERDR = oldHerdrBin;
	});
	const request: GithubClaim = { repo: binding.repo, id: 90, pr: 4, actor: "alice", url: command(90).html_url, base: originalBase, baseRef: "main", head };
	const options = { engine: "omp", provider: "openai-codex", model: "gpt-6-sol", thinking: "xhigh" };
	await assert.rejects(reviewGithubClaim(scratch.root, request, options), /PR head moved/);
	assert.deepEqual(await readdir(join(scratch.root, ".limen/jobs")), []);
	await assert.rejects(reviewGithubClaim(scratch.root, { ...request, id: 91, head: actualHead }, options), /hosted spawn requires Herdr/);
	assert.deepEqual(await readdir(join(scratch.root, ".limen/jobs")), [], "never start a detached review");
});
