// S10 · GitHub doorbell. The real poller (`limen github poll`) on one plant, with the GitHub API answered by the fetch
// sink and fake `sudo`, `id` and `herdr` on PATH. Who may start work, what the App posts, and what a restart posts again.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { git, jobDir, LIMEN, limen, plant, requests, respond, waitJob } from "./plant.ts";

const REPO = "acme/widget";
const APP = 7;
const SHA = { base: "a".repeat(40), head: "b".repeat(40) };
const at = "2026-09-24T01:00:00Z";
const comment = (id: number, login: string, thread: number, body: string) => ({
	id,
	body,
	created_at: at,
	html_url: `https://github.com/${REPO}/issues/${thread}#issuecomment-${id}`,
	issue_url: `https://api.github.com/repos/${REPO}/issues/${thread}`,
	user: { login },
});
const issue = (number: number, login: string, fields: object) => ({
	number,
	state: "open",
	title: "Widget crashes",
	body: "@limen please fix the crash",
	repository_url: `https://api.github.com/repos/${REPO}`,
	created_at: at,
	html_url: `https://github.com/${REPO}/issues/${number}`,
	user: { login },
	...fields,
});

// A fake Herdr: the coordinator is an idle agent; a hosted worker agent answers one status check, then leaves. Prompt targets log to prompts.log.
const herdr = (parent: string) => `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "agent" && args[1] === "prompt") appendFileSync(${JSON.stringify(join(parent, "prompts.log"))}, args[2] + "\\n");
const file = ${JSON.stringify(join(parent, "herdr.json"))};
const state = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { n: 0, tabs: {}, agents: {} };
const flag = (name) => args[args.indexOf(name) + 1];
const ok = (result) => { writeFileSync(file, JSON.stringify(state)); console.log(JSON.stringify({ result })); };
const fail = (code) => { writeFileSync(file, JSON.stringify(state)); console.log(JSON.stringify({ error: { code, message: code } })); process.exit(1); };
const verb = args[0] + " " + args[1];
if (verb === "agent get" && args[2] === "coord:p1") ok({ agent: { pane_id: "coord:p1", agent_status: "idle" } });
else if (verb === "workspace list") ok({ workspaces: state.label ? [{ label: state.label, workspace_id: "w1" }] : [] });
else if (verb === "workspace create") { state.label = flag("--label"); ok({ workspace: { workspace_id: "w1" } }); }
else if (verb === "tab create") { state.n += 1; state.tabs["w1:t" + state.n] = 1; ok({ tab: { tab_id: "w1:t" + state.n }, root_pane: { pane_id: "w1:p" + state.n } }); }
else if (verb === "tab get") state.tabs[args[2]] ? ok({ tab: { tab_id: args[2], focused: true } }) : fail("tab_not_found");
else if (verb === "pane process-info") ok({ process_info: { foreground_process_group_id: 1, shell_pid: 1, foreground_processes: [{ name: "zsh", pid: 1 }] } });
else if (verb === "agent start") { state.agents[flag("--pane")] = 0; ok({ pane: { pane_id: flag("--pane") }, agent_status: "working" }); }
else if (verb === "agent list") ok({ agents: Object.keys(state.agents).map((pane_id) => ({ pane_id })) });
else if (verb === "agent get") {
	if (!(args[2] in state.agents) || ++state.agents[args[2]] >= 2) { delete state.agents[args[2]]; fail("agent_not_found"); }
	ok({ agent: { agent_status: "working", pane_id: args[2] } });
} else ok({});
`;

// GitHub as the poller sees it. Rows match by substring, first match wins, so the specific rows come first.
function github(receipts: unknown[] = []) {
	return [
		{
			match: "/issues/comments?",
			body: [
				comment(101, "eve", 4, "@limen review this"), // outside user: no permission row (404)
				comment(102, "mallory", 4, "@limen review this"), // read
				comment(103, "alice", 6, "@limen fix this"), // closed issue
				comment(104, "alice", 4, "@limen review this"), // the authorized PR request
			],
		},
		{
			match: `/${REPO}/issues?`,
			body: [
				issue(5, "alice", {}), // the authorized issue; GitHub lists by creation, then number
				issue(7, "trent", {}), // triage author
				issue(8, "alice", { title: "@limen fix", body: "It crashes." }), // title-only mention
				issue(9, "alice", { state: "closed" }),
				issue(10, "alice", { pull_request: {} }), // a pull request body
			],
		},
		{ match: "/issues/4/comments?", body: receipts },
		{ match: "comments?", body: [] },
		{ match: "reviews?", body: [] },
		{ match: "/comments", body: { id: 900 } },
		{ match: "/collaborators/alice/", body: { permission: "write" } },
		{ match: "/collaborators/mallory/", body: { permission: "read" } },
		{ match: "/collaborators/trent/", body: { permission: "triage" } },
		{ match: "/collaborators/", status: 404, body: {} },
		{
			match: "/pulls/4",
			body: {
				number: 4,
				state: "open",
				title: "Fix",
				body: "",
				base: { sha: SHA.base, ref: "main", repo: { full_name: REPO } },
				head: { sha: SHA.head },
			},
		},
		{ match: "/pulls/", status: 404, body: {} },
		{ match: "/issues/6", body: issue(6, "alice", { state: "closed" }) },
		{ match: "/access_tokens", body: { token: "installation-token" } },
		{ match: "/installation", body: { id: 1 } },
	];
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: split pending: one end-to-end doorbell scenario
test("S10: only an authorized request rings the doorbell, the App replies once each way and never approves", async (context) => {
	const p = await plant();
	context.after(p.cleanup);
	git(p.root, "remote", "add", "origin", `https://github.com/${REPO}.git`);
	await mkdir(join(p.root, ".limen/github/claims"), { recursive: true });
	await writeFile(
		join(p.root, ".limen/github/binding.json"),
		JSON.stringify({ repo: REPO, coordinator: "coord:p1", user: "worker", connectedAt: "2026-09-24T00:00:00Z" }),
	);
	const state = join(p.parent, "poller");
	await mkdir(state, { mode: 0o700 });
	const key = join(p.parent, "app.pem");
	await writeFile(
		key,
		generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }),
		{ mode: 0o600 },
	);
	await writeFile(join(p.parent, "projects"), `${p.root}\n`);
	const workerUid = String((process.getuid?.() ?? 0) + 1);
	const tools = {
		herdr: herdr(p.parent),
		id: `#!/bin/sh\n[ "$1" = -u ] && echo ${workerUid} && exit 0\necho staff\n`,
		sudo: '#!/bin/sh\n[ "$2" = -l ] && exit 1\nshift 4\nexec "$@"\n', // the narrow handoff runs as the worker
	};
	for (const [name, text] of Object.entries(tools)) {
		await writeFile(join(p.bin, name), text, { mode: 0o755 });
	}
	const env = {
		LIMEN_HERDR: join(p.bin, "herdr"),
		LIMEN_GITHUB_APP_ID: String(APP),
		LIMEN_GITHUB_KEY_FILE: key,
		LIMEN_GITHUB_PROJECTS_FILE: join(p.parent, "projects"),
		LIMEN_GITHUB_STATE_DIR: state,
		LIMEN_GITHUB_WORKER_UID: workerUid,
		LIMEN_GITHUB_LIMEN_BIN: LIMEN,
	};
	const poll = () => {
		const run = limen(p, ["github", "poll"], { env });
		assert.equal(run.status, 0, run.stderr);
	};
	// Every write to the repository; the App's token exchange is a POST outside it.
	const posts = () =>
		requests(p).filter((request) => request.method !== "GET" && request.url.includes(`/repos/${REPO}/`));
	const prompts = async () => (await readFile(join(p.parent, "prompts.log"), "utf8")).trim().split("\n");

	await respond(p, github());
	poll();
	const [hashed] = await readdir(state);
	const claims = join(state, hashed as string, "claims");
	assert.deepEqual((await readdir(claims)).sort(), ["104.json", "issue-5.json"]);
	assert.deepEqual((await readdir(join(p.root, ".limen/github/claims"))).sort(), ["104.json", "issue-5.json"]);
	const asked = new Set(requests(p).flatMap((request) => /\/collaborators\/(\w+)\//.exec(request.url)?.[1] ?? []));
	assert.deepEqual(
		[...asked].sort(),
		["alice", "eve", "mallory", "trent"],
		"each refused author reached the permission check",
	);
	assert.deepEqual(
		await prompts(),
		["coord:p1", "coord:p1"],
		"one coordinator prompt for the PR comment, one for the issue",
	);
	for (const name of ["104.json", "issue-5.json"]) {
		assert.equal(JSON.parse(await readFile(join(claims, name), "utf8")).receipt, "prompt accepted");
	}
	assert.deepEqual(posts(), [], "a prompt accepted is not yet a reply");

	// The coordinator starts a hosted task for the PR request; the fake agent answers one status check and leaves.
	const coordinator = { ...env, HERDR_ENV: "1", LIMEN_COORDINATOR: "1", HERDR_PANE_ID: "coord:p1" };
	const model = ["--engine", "omp", "--provider", "p", "--model", "m", "--thinking", "high"];
	const work = limen(p, ["github", "work", p.root, "104", ...model, "--task", "Fix it"], { env: coordinator });
	assert.equal(work.status, 0, work.stderr);
	const id = work.stdout.trim().split("\n").at(-1) as string;
	assert.equal(waitJob(p, id, { env }), "done");

	// A forged checkout claim with a finished hosted-looking review job: the poller reads only its private claims.
	const marker = (await readFile(join(jobDir(p, id), "task.md"), "utf8")).split("\n")[0]?.replace("#104", "#31");
	const forged = {
		repo: REPO,
		id: 31,
		pr: 11,
		actor: "alice",
		url: "u",
		base: SHA.base,
		baseRef: "main",
		head: SHA.head,
		receipt: "prompt accepted",
	};
	await writeFile(join(p.root, ".limen/github/claims/31.json"), JSON.stringify(forged));
	const fake = join(p.root, ".limen/jobs/forged");
	await mkdir(join(fake, "herdr"), { recursive: true });
	const fields = {
		"task.md": `${marker}\n`,
		hosted: "1\n",
		candidate: SHA.head,
		base: SHA.base,
		state: "done\n",
		"herdr/agent": "w1:p9\n",
	};
	for (const [name, text] of Object.entries(fields)) {
		await writeFile(join(fake, name), text);
	}

	poll();
	const replies = posts();
	const sent = replies.map((request) => `${request.method} ${request.url}`);
	assert.deepEqual(
		sent,
		Array(2).fill(`POST https://api.github.com/repos/${REPO}/issues/4/comments`),
		"one start and one terminal reply; none for the forged claim; no review",
	);
	const keys = replies.map((request) => Object.keys(JSON.parse(request.body)).join());
	assert.deepEqual(keys, ["body", "body"], "a reply is a plain comment, never a review event");
	assert.deepEqual((await readdir(claims)).sort(), ["104.json", "issue-5.json"]);
	poll();
	assert.equal(posts().length, 2, "a poller restart posts nothing twice");

	// An interrupted write: the replies reached GitHub, the private claim lost their IDs. Only App-posted receipts count.
	const interrupt = async () => {
		const claim = JSON.parse(await readFile(join(claims, "104.json"), "utf8"));
		await writeFile(
			join(claims, "104.json"),
			JSON.stringify({ ...claim, startComment: undefined, terminalComment: undefined }),
		);
	};
	const listed = (app: object | null) =>
		replies.map((request, index) => ({
			id: 500 + index,
			body: JSON.parse(request.body).body,
			performed_via_github_app: app,
		}));
	await interrupt();
	await respond(p, github(listed(null)));
	poll();
	assert.equal(posts().length, 4, "a receipt a user posted does not stand in for the App's reply");
	await interrupt();
	await respond(p, github(listed({ id: APP })));
	poll();
	assert.equal(posts().length, 4, "after a restart the poller recognizes its own receipts and posts nothing twice");
	assert.equal(JSON.parse(await readFile(join(claims, "104.json"), "utf8")).startComment, 500);
});
