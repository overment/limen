// S3 · finish and wake. Every way a job ends records one terminal state, and the coordinator session that should hear
// it is woken exactly once. The coordinator is the fake engine running the real hook/wake.ts under PI_SESSION_ID; its
// fake-events.jsonl holds every wake it received. Absence is proved by order, never by waiting: a session confirms a
// wake by moving its claim to notify/delivered/<session>, and no listener injects that wake again afterwards, so once
// the delivered record exists every wake the job will cause for that session is already recorded.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	engineEvents,
	git,
	jobDir,
	jobFile,
	limen,
	type Plant,
	plant,
	release,
	spawnJob,
	until,
	waitJob,
} from "./plant.ts";

const WAKE_HOOK = fileURLToPath(new URL("../hook/wake.ts", import.meta.url));
const ROUTE = ["--engine", "pi", "--provider", "p", "--model", "m", "--thinking", "high", "--detached"];
let p: Plant;
let coord = "";
const sessions: ChildProcess[] = [];

/** A coordinator session: the fake engine with the real wake hook, running `script` as PI_SESSION_ID `session`. */
function coordinator(name: string, session: string, script: string): string {
	const dir = join(p.parent, name);
	mkdirSync(dir);
	writeFileSync(join(dir, "task.md"), script);
	const args = ["--session-dir", join(dir, "session"), "--extension", WAKE_HOOK, `@${join(dir, "task.md")}`];
	sessions.push(
		spawn(join(p.bin, "pi"), args, { cwd: p.root, env: { ...p.env, PI_SESSION_ID: session }, stdio: "ignore" }),
	);
	return dir;
}
/** A detached job running the fake-engine `script`, spawned from the `coord` session unless `env` says otherwise. */
function job(
	script: string,
	label: string,
	flags: readonly string[] = [],
	env: Record<string, string> = { PI_SESSION_ID: "coord" },
): string {
	return spawnJob(p, script, [...ROUTE, "--label", label, ...flags], { env });
}
/** The wakes a session received for job `id`, with their position in its event record. */
function wakes(dir: string, id: string) {
	return engineEvents(dir).flatMap((event, index) =>
		event.text?.startsWith("Limen job") && event.text.includes(id) ? [{ ...event, index }] : [],
	);
}
const delivered = (ids: readonly string[], session = "coord") =>
	until(join(p.root, ".limen", "jobs"), () =>
		ids.every((id) => existsSync(join(jobDir(p, id), "notify", "delivered", session))),
	);
/** Each job woke the listeners of its session exactly once, and its wake names the job's label and recorded state. */
function wokeOnce(ids: Readonly<Record<string, string>>, listeners: readonly string[]): void {
	for (const [name, id] of Object.entries(ids)) {
		const [wake, ...extra] = listeners.flatMap((dir) => wakes(dir, id));
		assert.equal(extra.length, 0, `${name} woke its session once`);
		assert.ok(
			wake?.text?.includes(jobFile(p, id, "label")) && wake.text.includes(jobFile(p, id, "state")),
			`${name} wake names its label and state`,
		);
	}
}

before(async () => {
	p = await plant();
	coord = coordinator("coord", "coord", "block\n/limen off\nblock\n/limen on\nblock\n");
});
after(async () => {
	for (const session of sessions) {
		session.kill();
	}
	await p.cleanup();
});

test("a job that ends done, failed or on a provider error wakes its session once, with two listeners on that session", async () => {
	const second = coordinator("second", "coord", "block\n");
	const ids = {
		done: job("commit", "a done"),
		failed: job("fail 7", "a failed"),
		provider: job("commit\nerror", "a provider error"),
	};
	const states = Object.fromEntries(Object.entries(ids).map(([name, id]) => [name, waitJob(p, id)]));
	await delivered(Object.values(ids));
	// Every wake is recorded now. The second listener ends, so only the coord session hears the next jobs.
	await release(second);
	await until(second, () => engineEvents(second).some((event) => event.event === "exit"));
	assert.deepEqual(states, { done: "done", failed: "failed", provider: "failed" });
	// A provider error after a commit fails the job (967ab4b recorded it as done) and keeps the commit on its branch.
	assert.notEqual(jobFile(p, ids.provider, "stop-reason"), "");
	assert.notEqual(jobFile(p, ids.provider, "commits"), "");
	assert.equal(git(p.root, "rev-list", "--count", `main..${jobFile(p, ids.provider, "branch")}`), "1");
	wokeOnce(ids, [coord, second]);
	// A job with no tool calls and no commits says so; a job that committed does not.
	const [failed = "", done = ""] = [ids.failed, ids.done].map(
		(id) => [coord, second].flatMap((dir) => wakes(dir, id))[0]?.text,
	);
	assert.equal(jobFile(p, ids.failed, "tool-calls"), "0");
	assert.match(failed, /produced nothing/);
	assert.doesNotMatch(done, /produced nothing/);
});

test("stop, timeout and the tool cap each end a job once and wake its session once", async () => {
	const ids = {
		stopped: job("block", "b stopped"),
		timeout: job("block", "b timeout", ["--timeout", "1s"]),
		cap: job("tool ls\nblock", "b tool cap", [], { PI_SESSION_ID: "coord", LIMEN_MAX_TOOL_CALLS: "1" }),
	};
	await until(jobDir(p, ids.stopped), () => existsSync(join(jobDir(p, ids.stopped), "fake-blocked-1")));
	assert.equal(limen(p, ["stop", ids.stopped, "test stop"]).status, 0);
	const states = Object.fromEntries(Object.entries(ids).map(([name, id]) => [name, waitJob(p, id)]));
	assert.deepEqual(states, { stopped: "stopped", timeout: "failed", cap: "failed" });
	// Each ending has one finished-at stamp. Timeout and the tool cap race the engine's own exit and log one terminal line.
	// A stop still logs two when the engine exits at once on TERM: stop.ts's 25 ms grace races the wrapper's finalize.
	// The planned exclusive finalize (F928) fixes it; add ids.stopped to the line count when it lands.
	for (const [name, id] of Object.entries(ids)) {
		assert.ok(Number.isFinite(Date.parse(jobFile(p, id, "finished-at"))), `${name} has one stamp`);
	}
	for (const id of [ids.timeout, ids.cap]) {
		assert.equal(jobFile(p, id, "log").match(/\] (?:done|failed|stopped):/g)?.length, 1, id);
	}
	await delivered(Object.values(ids));
	wokeOnce(ids, [coord]);
});

test("wakes of jobs that end while muted arrive after /limen on, in one turn, each exactly once (F042)", async () => {
	await release(coord, 1);
	await until(coord, () => existsSync(join(coord, "fake-blocked-2")));
	const muted = [job("say one", "m one"), job("say two", "m two")];
	for (const id of muted) {
		assert.equal(waitJob(p, id), "done");
	}
	await release(coord, 2);
	await delivered(muted);
	const on = engineEvents(coord).findIndex(
		(event) => event.event === "notify" && event.text?.startsWith("limen wake on"),
	);
	assert.ok(on >= 0, "the session saw /limen on");
	const heard = muted.map((id) => wakes(coord, id));
	// Before 7e43d23 the batched turn confirmed only its last wake, and the first was injected again.
	assert.deepEqual(
		heard.map((list) => list.length),
		[1, 1],
	);
	assert.ok(
		heard.every(([wake]) => (wake?.index ?? -1) > on),
		"muted wakes arrive only after /limen on",
	);
	// The first idle inject opens a turn; the second joins it as a follow-up, so both enter one turn.
	assert.deepEqual(
		heard.map(([wake]) => wake?.event),
		["user", "followUp"],
	);
});

test("limen watch and unwatch move a job's wake to another session", async () => {
	const other = coordinator("other", "other", "block\n");
	const moved = job("block", "w moved");
	assert.equal(limen(p, ["watch", moved]).status, 1, "watch needs a session to route the wake to");
	assert.equal(limen(p, ["watch", moved], { env: { PI_SESSION_ID: "other" } }).status, 0);
	assert.equal(limen(p, ["unwatch", moved], { env: { PI_SESSION_ID: "coord" } }).status, 0);
	await release(jobDir(p, moved));
	assert.equal(waitJob(p, moved), "done");
	await delivered([moved], "other");
	// The coord session visits jobs in id order in one sweep; a misrouted wake for `moved` lands before the barrier's.
	const barrier = job("say ok", "y barrier");
	await delivered([barrier]);
	assert.equal(wakes(other, moved).length, 1);
	assert.equal(wakes(coord, moved).length, 0);
});
