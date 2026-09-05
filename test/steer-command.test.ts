import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { limen, limenWithSession, onlyJobId, scratchRepo, waitForState } from "./scratch.ts";

const waitingPi = `#!/usr/bin/env node
process.on("SIGTERM", () => process.exit(0));
console.log("waiting");
setInterval(() => {}, 1000);
`;

const steeringPi = `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const root = process.env.LIMEN_CONTEXT_ROOT;
const job = join(root, ".limen/jobs", process.env.LIMEN_JOB_ID);
const hook = process.argv[process.argv.indexOf("--extension") + 1];
const messages = [];
import(pathToFileURL(hook).href).then((mod) => {
  const handlers = new Map();
  mod.default({
    on(event, handler) { handlers.set(event, handler); },
    sendUserMessage(content, options) {
      messages.push({ content, deliverAs: options && options.deliverAs });
      writeFileSync(join(job, "acted"), messages.map((message) => message.content).join("\\n") + "\\n");
      writeFileSync(join(job, "steers.json"), JSON.stringify(messages));
    },
  });
  handlers.get("session_start")();
  process.on("SIGTERM", () => {
    handlers.get("session_shutdown")();
    process.exit(0);
  });
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
console.log("ready");
setInterval(() => {}, 1000);
`;

test("steer reaches a running worker and leaves durable evidence", async (context) => {
	const scratch = await scratchRepo(steeringPi);
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const id = onlyJobId(limen(scratch, "spawn", "--label", "F009 steer", "wait for steer").stdout);
	const first = limen(scratch, "steer", id, "stay on the session test");
	assert.equal(first.status, 0, first.stderr);
	assert.match(first.stdout, /steered .* · 0001/);
	const second = limen(scratch, "steer", id, "then write the failing test");
	assert.equal(second.status, 0, second.stderr);
	assert.match(second.stdout, /0002/);
	const job = join(scratch.root, ".limen/jobs", id);
	await waitUntil(async () => (await readFile(join(job, "acted"), "utf8").catch(() => "")).includes("then write the failing test"));
	assert.equal(await readFile(join(job, "acted"), "utf8"), "stay on the session test\nthen write the failing test\n");
	assert.deepEqual(JSON.parse(await readFile(join(job, "steers.json"), "utf8")), [
		{ content: "stay on the session test", deliverAs: "steer" },
		{ content: "then write the failing test", deliverAs: "steer" },
	]);
	assert.equal(await readFile(join(job, "steer/delivered/0001/text"), "utf8"), "stay on the session test\n");
	assert.equal(await readFile(join(job, "steer/delivered/0002/text"), "utf8"), "then write the failing test\n");
	const log = await readFile(join(job, "log"), "utf8");
	assert.match(log, /steered: stay on the session test/);
	assert.match(log, /steered: then write the failing test/);
	const detail = limen(scratch, "jobs", id);
	assert.equal(detail.status, 0, detail.stderr);
	assert.match(detail.stdout, /steered: then write the failing test/);
	limen(scratch, "stop", id, "done steering");
	await waitForState(scratch.root, id, "stopped");
});

test("steer refuses a finished job and writes nothing", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const id = onlyJobId(limen(scratch, "spawn", "make commit").stdout);
	await waitForState(scratch.root, id, "done");
	const job = join(scratch.root, ".limen/jobs", id);
	const before = await snapshot(job);
	const result = limen(scratch, "steer", id, "too late");
	assert.equal(result.status, 1);
	assert.match(result.stderr, /already done; not steered/);
	assert.deepEqual(await snapshot(job), before);
});

test("steer --running places the same message in every live watched inbox", async (context) => {
	const scratch = await scratchRepo(steeringPi);
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const session = "coordinator-f080";
	const first = onlyJobId(limenWithSession(scratch, session, "spawn", "--label", "one", "wait for steer").stdout);
	const second = onlyJobId(limenWithSession(scratch, session, "spawn", "--label", "two", "wait for steer").stdout);
	const unwatched = onlyJobId(limen(scratch, "spawn", "--label", "other", "wait for steer").stdout);
	const result = limenWithSession(scratch, session, "steer", "--running", "same correction");
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, new RegExp(`steered ${first}`));
	assert.match(result.stdout, new RegExp(`steered ${second}`));
	assert.doesNotMatch(result.stdout, new RegExp(unwatched));
	await waitUntil(async () => (await steeredText(join(scratch.root, ".limen/jobs", first))) === "same correction\n");
	await waitUntil(async () => (await steeredText(join(scratch.root, ".limen/jobs", second))) === "same correction\n");
	assert.equal(await steeredText(join(scratch.root, ".limen/jobs", unwatched)), "");
	limen(scratch, "stop", first, "done");
	limen(scratch, "stop", second, "done");
	limen(scratch, "stop", unwatched, "done");
});

test("steer --running with no live watched job says nothing was reached", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const result = limenWithSession(scratch, "coordinator-f080", "steer", "--running", "unused");
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /nothing was reached/);
});

test("steer --running reports a job that ended between selection and delivery", async (context) => {
	const scratch = await scratchRepo(steeringPi);
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const session = "coordinator-f080";
	const live = onlyJobId(limenWithSession(scratch, session, "spawn", "--label", "live", "wait for steer").stdout);
	const ended = "ended-before-delivery";
	const endedDir = join(scratch.root, ".limen/jobs", ended);
	await mkdir(join(endedDir, "notify/subscribers"), { recursive: true });
	await writeFile(join(endedDir, "state"), "running\n");
	await writeFile(join(endedDir, "notify/subscribers", session), "1\n");
	const result = limenWithSession(scratch, session, "steer", "--running", "keep going");
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, new RegExp(`steered ${live}`));
	assert.match(result.stdout, new RegExp(`not reached ${ended}`));
	await waitUntil(async () => (await steeredText(join(scratch.root, ".limen/jobs", live))) === "keep going\n");
	limen(scratch, "stop", live, "done");
});

test("steer reports unavailable when the worker extension never loaded", async (context) => {
	const scratch = await scratchRepo(waitingPi);
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const id = onlyJobId(limen(scratch, "spawn", "wait").stdout);
	const job = join(scratch.root, ".limen/jobs", id);
	const before = await snapshot(job);
	const result = limen(scratch, "steer", id, "should not land");
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stderr, /steering is unavailable/);
	assert.deepEqual(await snapshot(job), before);
	limen(scratch, "stop", id, "no extension");
	await waitForState(scratch.root, id, "stopped");
});

async function steeredText(job: string): Promise<string> {
	return (await readFile(join(job, "steer/inbox/0001"), "utf8").catch(() => "")) || (await readFile(join(job, "steer/delivered/0001/text"), "utf8").catch(() => ""));
}

async function snapshot(job: string): Promise<string[]> {
	const { readdir } = await import("node:fs/promises");
	const names = await readdir(job);
	return names.filter((name) => name !== "log" && name !== "activity" && name !== "last-tool" && name !== "tool-calls" && name !== "born" && !name.endsWith(".tmp")).sort();
}

async function waitUntil(predicate: () => Promise<boolean>): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		if (await predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	assert.ok(await predicate(), "timed out waiting for the worker to act on a steer");
}
