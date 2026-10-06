// S7 · Webhooks. One plant: a job spawned before any config sends nothing; then two targets and an author map route
// each terminal ping, through the real sender helper, to the target of the ticket's author, with the secret only in the
// Authorization header.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { git, jobDir, jobFile, limen, plant, type Run, requests, until } from "./plant.ts";

const p = await plant();
after(p.cleanup);
const SECRETS = ["Bearer s7-secret-one", "Bearer s7-secret-two"];
const URLS = ["https://hooks.s7.test/one", "https://hooks.s7.test/two"];
const runs: Run[] = [];
const run = (args: string[], cwd?: string) => {
	const result = limen(p, args, cwd ? { cwd } : {});
	runs.push(result);
	assert.equal(result.status, 0, result.stderr);
	return result.stdout.trim().split("\n").at(-1) ?? "";
};
const ids: string[] = [];
const spawn = (task: string, label: string) => {
	const id = run(["spawn", "--label", label, task]);
	ids.push(id);
	return id;
};
const wait = (id: string) => {
	const result = limen(p, ["wait", id]);
	runs.push(result);
	return result.stdout.split(" ")[0]?.toLowerCase();
};
const payloads = () => requests(p).map((request) => ({ url: request.url, body: JSON.parse(request.body) }));
// The finish path writes its final result line after the sender exits; every request it made is recorded by then.
const settled = (id: string) =>
	until(p.parent, () => /^(accepted|failed|skipped)/.test(jobFile(p, id, "finish-webhook")));

async function ticket(code: string, author: string, lane = "active"): Promise<string> {
	const path = `spec/features/${lane}/${code}-s7/ticket.md`;
	await mkdir(join(p.root, dirname(path)), { recursive: true });
	await writeFile(join(p.root, path), `---\ntouches:\n  - demo.place\nopened: 2026-10-06\n---\n\n# ${code} · S7\n`);
	git(p.root, "add", path);
	git(p.root, "commit", "-q", "--author", author, "-m", `ticket ${code}`);
	return path;
}

// Spawned before any config exists: the job records no config, so nothing can ever send for it.
const quiet = spawn("commit", "S7 quiet");
const BOB = "Bob <2+bob@users.noreply.github.com>";
const planned = await ticket("F002", "Alice <1+alice@users.noreply.github.com>", "planned");
const bob = await ticket("F003", BOB);
// Bob edits Alice's ticket and moves it to active: Alice still filed it, so her pings stay hers.
const alice = planned.replace("planned", "active");
git(p.root, "mv", dirname(planned), dirname(alice));
await appendFile(join(p.root, alice), "\nBob's edit.\n");
git(p.root, "commit", "-q", "-a", "--author", BOB, "-m", "Bob moves and edits F002");
await writeFile(
	join(p.root, ".limen/finish-webhook.env"),
	`LIMEN_FINISH_WEBHOOK_TARGETS='${JSON.stringify(URLS.map((url, index) => ({ url, auth: SECRETS[index] })))}'\nLIMEN_FINISH_WEBHOOK_AUTHOR_TARGETS='{"@alice":[1],"@bob":[2]}'\n`,
);

test("an unconfigured job records no config and sends nothing", () => {
	assert.equal(wait(quiet), "done");
	assert.equal(jobFile(p, quiet, "finish-webhook-env"), "");
	assert.equal(jobFile(p, quiet, "finish-webhook-attempt"), "");
	assert.deepEqual(requests(p), []);
});

test("a done job pings only the target its ticket author maps to", async () => {
	const id = spawn(`Ticket: ${alice}\ncommit`, "S7 alice");
	assert.equal(wait(id), "done");
	await settled(id);
	const [ping, ...rest] = payloads();
	assert.deepEqual(rest, []);
	assert.equal(ping?.url, URLS[0]);
	assert.equal(ping?.body.event, "job.done");
	assert.equal(ping?.body.jobId, id);
	assert.equal(requests(p)[0]?.headers.authorization, SECRETS[0]);
	assert.equal(jobFile(p, id, "finish-webhook-route"), "mapped @alice -> 1");
});

test("a failed job with an empty result still sends one ping with kind, plant, id and reason", async () => {
	const id = spawn(`Ticket: ${bob}\nsay\nfail 3`, "S7 bob");
	assert.equal(wait(id), "failed");
	assert.equal(jobFile(p, id, "result"), "");
	await settled(id);
	const sent = payloads().filter((ping) => ping.body.jobId === id);
	assert.equal(sent.length, 1);
	assert.equal(sent[0]?.url, URLS[1]);
	assert.equal(sent[0]?.body.event, "job.failed");
	assert.equal(sent[0]?.body.plant, "repo");
	assert.ok(sent[0]?.body.reason);
	assert.equal(requests(p).at(-1)?.headers.authorization, SECRETS[1]);
});

test("a continuation from a subdirectory keeps the parent's config and author route", async () => {
	const parent = ids[1] ?? "";
	const id = run(["continue", parent, "say continued"], join(p.root, "spec"));
	ids.push(id);
	assert.notEqual(id, parent);
	assert.equal(wait(id), "done");
	assert.equal(jobFile(p, id, "finish-webhook-env"), jobFile(p, parent, "finish-webhook-env"));
	assert.equal(jobFile(p, id, "finish-webhook-author"), jobFile(p, parent, "finish-webhook-author"));
	await settled(id);
	const sent = payloads().filter((ping) => ping.body.jobId === id);
	assert.deepEqual(
		sent.map((ping) => ping.url),
		[URLS[0]],
	);
	assert.equal(jobFile(p, id, "finish-webhook-route"), "mapped @alice -> 1");
});

test("no secret or target URL leaves the request header, and nothing names the quiet job", () => {
	assert.equal(requests(p).length, 3);
	assert.ok(
		requests(p).every(
			(request) =>
				request.url.startsWith("https://hooks.s7.test/") && SECRETS.includes(request.headers.authorization ?? ""),
		),
	);
	assert.ok(payloads().every((ping) => ping.body.jobId !== quiet));
	const leaks = (text: string) =>
		[...SECRETS.map((secret) => secret.slice(7)), "hooks.s7.test"].filter((value) => text.includes(value));
	for (const request of requests(p)) {
		assert.deepEqual(
			leaks(JSON.stringify({ ...request, url: "", headers: { ...request.headers, authorization: "" } })),
			[],
		);
	}
	for (const result of runs) {
		assert.deepEqual(leaks(result.stdout + result.stderr), []);
	}
	for (const id of ids) {
		for (const entry of readdirSync(jobDir(p, id), { recursive: true, withFileTypes: true })) {
			if (entry.isFile()) {
				assert.deepEqual(
					leaks(readFileSync(join(entry.parentPath, entry.name), "utf8")),
					[],
					join(entry.parentPath, entry.name),
				);
			}
		}
	}
});
