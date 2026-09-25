import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { claimPath, ensureGithubCoordinator, type GithubBinding, githubCommand } from "../src/commands/github.ts";
import { acceptGithubComment, reconcileGithubClaim } from "../src/github-poller.ts";
import { type GithubClaim, githubMarker, startGithubJob } from "../src/github-review.ts";
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
		if (url.endsWith("/pulls/4"))
			return Response.json({
				number: 4,
				state: "open",
				title: "Fix widget",
				body: "Description",
				base: { sha: base, ref: "release", repo: { full_name: binding.repo } },
				head: { sha: head },
			});
		if (url.endsWith("/pulls/5")) return new Response("{}", { status: 404 });
		if (url.includes("/issues/4/comments?"))
			return Response.json([
				{ id: 4, body: "@limen please review this", user: { login: "alice" } },
				{ id: 9, body: "Earlier context", user: { login: "bob" } },
			]);
		if (url.includes("/pulls/4/comments?")) return Response.json([{ id: 10, body: "Inline finding", user: { login: "carol" } }]);
		if (url.includes("/pulls/4/reviews?")) return Response.json([{ id: 11, body: "Review summary", user: { login: "dave" } }]);
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

	await acceptGithubComment(scratch.root, state, binding, command(1, "@limenology"), "test-token");
	await acceptGithubComment(scratch.root, state, binding, command(2, "/limenish"), "test-token");
	await acceptGithubComment(scratch.root, state, binding, command(3, "@limen please review this", 5), "test-token");
	await acceptGithubComment(scratch.root, state, binding, command(6, "> @limen review"), "test-token");
	await acceptGithubComment(scratch.root, state, binding, command(7, "```text\n/limen\n```"), "test-token");
	await acceptGithubComment(scratch.root, state, binding, command(8, "`@limen`"), "test-token");
	await acceptGithubComment(scratch.root, state, binding, command(10, "<!-- @limen -->"), "test-token");
	await acceptGithubComment(scratch.root, state, binding, command(11, "    /limen review"), "test-token");
	assert.deepEqual(await readdir(join(scratch.root, ".limen/github/claims")), []);
	permission = "write";
	await acceptGithubComment(scratch.root, state, binding, command(4, "@limen please review this"), "test-token");
	await acceptGithubComment(scratch.root, state, binding, command(4, "@limen please review this"), "test-token");
	assert.deepEqual(await readdir(join(scratch.root, ".limen/github/claims")), ["4.json"]);
	const claim = JSON.parse(await readFile(claimPath(scratch.root, 4), "utf8")) as GithubClaim;
	assert.equal(claim.base, base);
	assert.equal(claim.head, head);
	assert.match(claim.receipt ?? "", /pending: coordinator unavailable/);
	assert.equal(claim.noticeComment, 500);
	assert.equal(claim.title, "Fix widget");
	assert.equal(claim.command, "@limen please review this");
	assert.match(claim.discussion ?? "", /bob: Earlier context.*carol: Inline finding.*dave: Review summary/s);
	assert.doesNotMatch(claim.discussion ?? "", /alice: @limen/);
	assert.doesNotMatch(await readFile(claimPath(scratch.root, 4), "utf8"), /outcomeNonce/);
	assert.equal(requests.filter((call) => call.includes("POST") && call.includes("/comments")).length, 1);
	assert.deepEqual(await readdir(join(scratch.root, ".limen/jobs")), []);
});

test("pending availability failure retries once after live ensure without duplicate notice", async (context) => {
	const scratch = await scratchRepo();
	const state = await pollerState(context);
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	await mkdir(join(scratch.root, ".limen/github/claims"), { recursive: true });
	await writeFile(join(scratch.root, ".limen/github/binding.json"), JSON.stringify(binding));
	git(scratch.root, "remote", "add", "origin", "https://github.com/acme/widget.git");
	const claim: GithubClaim = {
		repo: binding.repo,
		id: 81,
		pr: 4,
		actor: "alice",
		url: command(81).html_url,
		base,
		baseRef: "release",
		head,
		receipt: "pending: coordinator unavailable",
		attemptedAt: new Date(Date.now() - 31_000).toISOString(),
		noticeComment: 500,
	};
	await writeFile(join(state, "claims/81.json"), JSON.stringify(claim));
	const calls = join(state, "sudo-calls");
	await writeFile(join(scratch.fakeBin, "sudo"), `#!/bin/sh\nprintf '%s\\n' "$7" >> ${JSON.stringify(calls)}\nexit 0\n`);
	await chmod(join(scratch.fakeBin, "sudo"), 0o755);
	const path = process.env.PATH;
	process.env.PATH = `${scratch.fakeBin}:${path}`;
	context.after(() => {
		process.env.PATH = path;
	});
	const previousFetch = globalThis.fetch;
	let posts = 0;
	globalThis.fetch = async () => {
		posts++;
		return Response.json([]);
	};
	context.after(() => {
		globalThis.fetch = previousFetch;
	});
	await reconcileGithubClaim(scratch.root, state, 81, "test-token");
	await reconcileGithubClaim(scratch.root, state, 81, "test-token");
	assert.equal(await readFile(calls, "utf8"), "ensure\ndeliver\n");
	assert.equal(posts, 0);
	assert.equal((JSON.parse(await readFile(join(state, "claims/81.json"), "utf8")) as GithubClaim).receipt, "prompt accepted");
});
test("a rejected bare-shell prompt retries after recovery without duplicate notice", async (context) => {
	const scratch = await scratchRepo();
	const state = await pollerState(context);
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	git(scratch.root, "remote", "add", "origin", "https://github.com/acme/widget.git");
	await mkdir(join(scratch.root, ".limen/github/claims"), { recursive: true });
	await writeFile(join(scratch.root, ".limen/github/binding.json"), JSON.stringify(binding));
	const claim: GithubClaim = {
		repo: binding.repo,
		id: 82,
		pr: 4,
		actor: "alice",
		url: command(82).html_url,
		base,
		baseRef: "release",
		head,
		receipt: "pending: coordinator unavailable",
		attemptedAt: new Date(Date.now() - 31_000).toISOString(),
	};
	await writeFile(join(state, "claims/82.json"), JSON.stringify(claim));
	const calls = join(state, "calls");
	const sudo = join(scratch.fakeBin, "sudo");
	await writeFile(sudo, `#!/bin/sh\nprintf '%s\\n' "$7" >> ${JSON.stringify(calls)}\nif [ "$7" = deliver ]; then echo 'target is not an available shell' >&2; exit 1; fi\n`);
	await chmod(sudo, 0o755);
	const previousPath = process.env.PATH;
	process.env.PATH = `${scratch.fakeBin}:${previousPath}`;
	context.after(() => {
		process.env.PATH = previousPath;
	});
	const previousFetch = globalThis.fetch;
	const posts: string[] = [];
	globalThis.fetch = async (input, init) => {
		if (init?.method === "POST") {
			posts.push(String(input));
			return Response.json({ id: 800 });
		}
		return Response.json([]);
	};
	context.after(() => {
		globalThis.fetch = previousFetch;
	});
	await reconcileGithubClaim(scratch.root, state, 82, "test-token");
	let stored = JSON.parse(await readFile(join(state, "claims/82.json"), "utf8")) as GithubClaim;
	assert.match(stored.receipt ?? "", /pending: coordinator unavailable/);
	stored.attemptedAt = new Date(Date.now() - 31_000).toISOString();
	await writeFile(join(state, "claims/82.json"), JSON.stringify(stored));
	await writeFile(sudo, `#!/bin/sh\nprintf '%s\\n' "$7" >> ${JSON.stringify(calls)}\n`);
	await reconcileGithubClaim(scratch.root, state, 82, "test-token");
	await reconcileGithubClaim(scratch.root, state, 82, "test-token");
	assert.equal(await readFile(calls, "utf8"), "ensure\ndeliver\nensure\ndeliver\n");
	assert.equal(posts.length, 1);
	stored = JSON.parse(await readFile(join(state, "claims/82.json"), "utf8")) as GithubClaim;
	assert.equal(stored.receipt, "prompt accepted");
});

test("one idle coordinator accepts two repository-specific requests and rejects a noninteractive pane", async (context) => {
	const first = await scratchRepo();
	const second = await scratchRepo();
	context.after(first.cleanup);
	context.after(second.cleanup);
	const roots = await Promise.all([first.root, second.root].map((root) => realpath(root)));
	for (const [index, root] of roots.entries()) {
		assert.equal(limen(index === 0 ? first : second, "init").status, 0);
		git(root, "remote", "add", "origin", `https://github.com/acme/${index === 0 ? "widget" : "gadget"}.git`);
		await mkdir(join(root, ".limen/github/claims"), { recursive: true });
		const repo = index === 0 ? "acme/widget" : "acme/gadget";
		await writeFile(join(root, ".limen/github/binding.json"), JSON.stringify({ ...binding, repo }));
		await writeFile(
			claimPath(root, 91),
			JSON.stringify({
				...binding,
				repo,
				id: 91,
				pr: 4,
				actor: "alice",
				url: `https://github.com/${repo}/pull/4#issuecomment-91`,
				base,
				baseRef: "release",
				head,
				title: `Title ${repo}`,
				body: "PR body",
				discussion: "bob: existing discussion",
				command: "@limen inspect this",
			}),
		);
	}
	const prompts = join(first.fakeBin, "prompts");
	const herdr = join(first.fakeBin, "herdr");
	await writeFile(
		herdr,
		`#!/bin/sh\nif [ "$2" = get ]; then printf '%s\\n' '{"id":"cli:agent:get","result":{"agent":{"pane_id":"coord:p1","agent_status":"done","interactive_ready":true}}}'; else printf '%s\\n' "$4" >> ${JSON.stringify(prompts)}; fi\n`,
	);
	await writeFile(join(first.fakeBin, "id"), "#!/bin/sh\necho staff\n");
	await writeFile(join(first.fakeBin, "sudo"), "#!/bin/sh\nexit 1\n");
	for (const name of ["herdr", "id", "sudo"]) await chmod(join(first.fakeBin, name), 0o755);
	const previousPath = process.env.PATH;
	const previousHerdr = process.env.LIMEN_HERDR;
	process.env.PATH = `${first.fakeBin}:${previousPath}`;
	process.env.LIMEN_HERDR = herdr;
	context.after(() => {
		process.env.PATH = previousPath;
		if (previousHerdr === undefined) delete process.env.LIMEN_HERDR;
		else process.env.LIMEN_HERDR = previousHerdr;
	});
	for (const root of roots) await githubCommand(["deliver", root, "91", "f".repeat(48)], root);
	const delivered = await readFile(prompts, "utf8");
	for (const root of roots) assert.match(delivered, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	assert.match(delivered, /Title acme\/widget/);
	assert.match(delivered, /Title acme\/gadget/);
	assert.match(delivered, /bob: existing discussion/);
	assert.match(delivered, /\/opt\/limen\/bin\/limen github review/);
	const priorCoordinator = process.env.LIMEN_COORDINATOR;
	const priorPane = process.env.HERDR_PANE_ID;
	const priorHerdrEnv = process.env.HERDR_ENV;
	process.env.LIMEN_COORDINATOR = "1";
	process.env.HERDR_PANE_ID = binding.coordinator;
	process.env.HERDR_ENV = "1";
	context.after(() => {
		if (priorCoordinator === undefined) delete process.env.LIMEN_COORDINATOR;
		else process.env.LIMEN_COORDINATOR = priorCoordinator;
		if (priorPane === undefined) delete process.env.HERDR_PANE_ID;
		else process.env.HERDR_PANE_ID = priorPane;
		if (priorHerdrEnv === undefined) delete process.env.HERDR_ENV;
		else process.env.HERDR_ENV = priorHerdrEnv;
	});
	await githubCommand(["resolve", roots[0] as string, "91", "f".repeat(48), "No job is appropriate."], roots[0] as string);
	assert.match(await readFile(join(roots[0] as string, ".limen/github/outcomes/91.json"), "utf8"), /No job is appropriate/);
	await assert.rejects(
		startGithubJob(roots[0] as string, JSON.parse(await readFile(claimPath(roots[0] as string, 91), "utf8")) as GithubClaim, {
			engine: "omp",
			provider: "openai-codex",
			model: "gpt-6-sol",
			thinking: "xhigh",
		}),
		/already entered a handoff/,
	);
	await writeFile(herdr, '#!/bin/sh\nprintf \'%s\\n\' \'{"id":"cli:agent:get","result":{"agent":{"pane_id":"coord:p1","agent_status":"done","interactive_ready":false}}}\'\n');
	await assert.rejects(ensureGithubCoordinator(roots[0] as string), /not interactive/);
});

test("a generic hosted worker and a nonce-backed no-job answer reconcile without a review claim", async (context) => {
	const scratch = await scratchRepo();
	const state = await pollerState(context);
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	git(scratch.root, "remote", "add", "origin", "https://github.com/acme/widget.git");
	await mkdir(join(scratch.root, ".limen/github/claims"), { recursive: true });
	await writeFile(join(scratch.root, ".limen/github/binding.json"), JSON.stringify(binding));
	const nonce = "e".repeat(48);
	const noJob: GithubClaim = {
		repo: binding.repo,
		id: 62,
		pr: 4,
		actor: "alice",
		url: command(62).html_url,
		base,
		baseRef: "release",
		head,
		receipt: "prompt accepted",
		outcomeNonce: nonce,
	};
	const work: GithubClaim = { ...noJob, id: 63, url: command(63).html_url };
	delete work.outcomeNonce;
	await writeFile(join(state, "claims/62.json"), JSON.stringify(noJob));
	await writeFile(join(state, "claims/63.json"), JSON.stringify(work));
	await mkdir(join(scratch.root, ".limen/github/outcomes"));
	const outcome = join(scratch.root, ".limen/github/outcomes/62.json");
	await writeFile(outcome, JSON.stringify({ repo: binding.repo, id: 62, coordinator: binding.coordinator, nonce: "f".repeat(48), answer: "No job needed." }));
	const posted: string[] = [];
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (_input, init) => {
		if (init?.method === "POST") {
			posted.push(JSON.parse(String(init.body)).body as string);
			return Response.json({ id: 900 + posted.length });
		}
		return Response.json([]);
	};
	context.after(() => {
		globalThis.fetch = originalFetch;
	});
	await reconcileGithubClaim(scratch.root, state, 62, "test-token");
	assert.equal(posted.length, 0, "a forged checkout outcome cannot use the App receipt");
	await writeFile(join(state, "claims/62.json"), JSON.stringify({ ...noJob, receipt: "pending: no matching job record; inspect coordinator before retry" }));
	await writeFile(outcome, JSON.stringify({ repo: binding.repo, id: 62, coordinator: binding.coordinator, nonce, answer: "No job needed." }));
	await reconcileGithubClaim(scratch.root, state, 62, "test-token");
	await reconcileGithubClaim(scratch.root, state, 62, "test-token");
	assert.equal(posted.length, 1);
	assert.match(posted[0] ?? "", /without starting a job.*No job needed/s);
	assert.doesNotMatch(await readFile(claimPath(scratch.root, 62), "utf8"), /outcomeNonce/);
	const dir = join(scratch.root, ".limen/jobs/ordinary-worker");
	await mkdir(join(dir, "herdr"), { recursive: true });
	await Promise.all(
		Object.entries({
			"task.md": `${githubMarker(work)}\nCoordinator task: inspect build failures\n`,
			hosted: "Herdr hosted\n",
			base: `${git(scratch.root, "rev-parse", "HEAD")}\n`,
			branch: "limen/github-pr-4-63\n",
			role: "worker\n",
			state: "running\n",
			"herdr/agent": "coord:worker\n",
		}).map(([name, text]) => writeFile(join(dir, name), text)),
	);
	await reconcileGithubClaim(scratch.root, state, 63, "test-token");
	await writeFile(join(dir, "state"), "done\n");
	await writeFile(join(dir, "result"), "Build failure identified.\n");
	await reconcileGithubClaim(scratch.root, state, 63, "test-token");
	await reconcileGithubClaim(scratch.root, state, 63, "test-token");
	assert.equal(posted.length, 3);
	assert.match(posted[1] ?? "", /hosted task.*ordinary-worker/);
	assert.doesNotMatch(posted[1] ?? "", /pinned head/);
	assert.match(posted[2] ?? "", /hosted task job.*Build failure identified/s);
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
	await assert.rejects(startGithubJob(scratch.root, request, options), /PR head moved/);
	assert.deepEqual(await readdir(join(scratch.root, ".limen/jobs")), []);
	await assert.rejects(startGithubJob(scratch.root, { ...request, id: 91, head: actualHead }, options), /hosted spawn requires Herdr/);
	assert.deepEqual(await readdir(join(scratch.root, ".limen/jobs")), [], "never start a detached review");
	await assert.rejects(startGithubJob(scratch.root, { ...request, id: 92 }, options, "Inspect the build failure"), /hosted spawn requires Herdr/);
	assert.deepEqual(await readdir(join(scratch.root, ".limen/jobs")), [], "never start a detached worker");
});
