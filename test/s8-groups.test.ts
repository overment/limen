// S8 · Groups: one lead, one cabinet, fixed slots. One plant, a lead session that runs the real hook/group-peer.ts, real bin/limen.
import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
	engineEvents,
	FINAL,
	git,
	jobDir,
	jobFile,
	limen,
	type Plant,
	plant,
	type Run,
	release,
	requests,
	start,
	TICKET,
	until,
	waitJob,
} from "./plant.ts";

const PEER = fileURLToPath(new URL("../hook/group-peer.ts", import.meta.url));
const FEATURE = dirname(TICKET);
const LEAD = { PI_SESSION_ID: "s8-lead" };
const ROUTE = ["--engine", "omp", "--provider", "fake", "--model", "fake-1", "--thinking", "high", "--detached"];
const TEAM = "omp:fake/fake-1:high";
const SETTINGS = ["--team", TEAM, "--team", TEAM, "--workers", "1", "--timeout", "30m", "--detached"];
const ROUNDS = join(dirname(FEATURE), "F002-rounds");
let p: Plant;
let lead: string;
let session: ChildProcess;
let group = "";
const roster = { coordinator1: "", coordinator2: "", worker1: "", worker2: "" };

before(async () => {
	p = await plant();
	for (const name of ["brief", "teams/team-1", "teams/team-2"]) {
		await mkdir(dirname(join(p.root, FEATURE, "group", `${name}.md`)), { recursive: true });
		await writeFile(join(p.root, FEATURE, "group", `${name}.md`), `# ${name}\n`);
	}
	await writeFile(join(p.root, FEATURE, "group/teams/team-1.md"), `say ${FINAL.line}\n`); // team 1's draft result
	await mkdir(join(p.root, ROUNDS));
	await writeFile(join(p.root, ROUNDS, "ticket.md"), "# F002 · rounds\n");
	git(p.root, "add", "-A");
	git(p.root, "commit", "-q", "-m", "group packet");
	await writeFile(
		join(p.root, ".limen/finish-webhook.env"),
		"LIMEN_FINISH_WEBHOOK_URL='https://hooks.s8.test/finish'\nLIMEN_FINISH_WEBHOOK_AUTH='Bearer s8'\n",
		{ mode: 0o600 },
	);
	// The owner-facing lead: an interactive session with the group hook, held open on a FIFO until the story ends.
	lead = join(p.parent, "lead");
	await mkdir(lead);
	await writeFile(join(lead, "task.md"), "block\n");
	session = spawn(
		join(p.bin, "pi"),
		["--extension", PEER, "--session-dir", join(lead, "session"), `@${join(lead, "task.md")}`],
		{ cwd: p.root, env: { ...p.env, ...LEAD, LIMEN_COORDINATOR: "1" }, stdio: "ignore" },
	);
	await until(lead, () => existsSync(join(lead, "fake-blocked-1")));
});
after(() => p.cleanup());

const run = (args: readonly string[], env: Record<string, string> = {}) => start(p, args, { env }).done;
/** The last stdout line: the id of the job or group a run started. */
const startedId = (result?: Run) => result?.stdout.trim().split("\n").at(-1) ?? "";
const cabinet = () => join(p.root, ".limen/groups", group);
const members = (): Array<{ id: string; team: string; role: string }> =>
	JSON.parse(readFileSync(join(cabinet(), "run.json"), "utf8")).members;
const roles = () => members().map((member) => `${member.team} ${member.role}`);
const as = (id: string, team: string) => ({
	LIMEN_JOB: "1",
	LIMEN_JOB_ID: id,
	LIMEN_CONTEXT_ROOT: p.root,
	LIMEN_GROUP_ID: group,
	LIMEN_TEAM_ID: team,
});
const delivered = () => engineEvents(lead).filter((entry) => entry.text?.startsWith("[limen-group-delivery:"));
const pings = (step: string) => requests(p).filter((request) => JSON.parse(request.body).job === `F001 lead ${step}`);

test("a stale lead registration starts nothing; two concurrent activations by the lead start one roster in one cabinet; the lead hears every last-round result whole", async () => {
	// A registration no running hook refreshes is not a lead: no update would reach it.
	await writeFile(join(p.root, ".limen/group-leads/stale-pane"), `${process.pid}\n`);
	await utimes(join(p.root, ".limen/group-leads/stale-pane"), new Date(0), new Date(0));
	assert.equal(limen(p, ["group", "start", FEATURE, ...SETTINGS], { env: { PI_SESSION_ID: "stale-pane" } }).status, 1);
	assert.ok(!existsSync(join(p.root, ".limen/groups")));
	const started = await Promise.all([
		run(["group", "start", FEATURE, ...SETTINGS], LEAD),
		run(["group", "start", FEATURE, ...SETTINGS], LEAD),
	]);
	for (const result of started) {
		assert.equal(result.status, 0, result.stderr);
	}
	group = startedId(started[0]);
	assert.deepEqual([startedId(started[1]), ...readdirSync(join(p.root, ".limen/groups"))], [group, group]);
	assert.deepEqual(roles(), ["team-1 coordinator", "team-2 coordinator"]);
	[roster.coordinator1 = "", roster.coordinator2 = ""] = members().map((member) => member.id);
	for (const id of [roster.coordinator1, roster.coordinator2]) {
		assert.equal(waitJob(p, id), "done");
	}
	await until(lead, () => delivered().some((entry) => entry.text?.includes(`/team-1.md\n${FINAL.text}\n`)));
});

test("launches queued behind a slow sibling wait past the old 10-second lock deadline, and one slot makes one member", async () => {
	// A Git hook holds the first worker's checkout, and with it the group launch lock, until one FIFO write.
	const hooks = join(p.parent, "hooks"),
		gate = join(p.parent, "checkout-gate"),
		entered = join(p.parent, "checkout-entered");
	await mkdir(hooks);
	execFileSync("mkfifo", [gate]);
	// mkdir marks the first checkout atomically; dash exits on a failed `: >` under set -C instead of running `|| exit 0`.
	await writeFile(
		join(hooks, "post-checkout"),
		`#!/bin/sh\nmkdir '${entered}' 2>/dev/null || exit 0\ncat '${gate}' > /dev/null\n`,
		{ mode: 0o755 },
	);
	git(p.root, "config", "core.hooksPath", hooks);
	const slow = run(["spawn", ...ROUTE, "block"], as(roster.coordinator1, "team-1"));
	await until(p.parent, () => existsSync(entered));
	// Team 2 has one worker slot and asks for it twice at once.
	const racing = [0, 1].map(() => run(["spawn", ...ROUTE, "say team two"], as(roster.coordinator2, "team-2")));
	// The one real hold: past the 10 seconds after which a queued launch used to fail (b62b837).
	await delay(12_000);
	await writeFile(gate, "go\n");
	const first = await slow;
	const raced = await Promise.all(racing);
	roster.worker1 = startedId(first);
	roster.worker2 = startedId(raced.find((result) => result.status === 0));
	assert.equal(first.status, 0, first.stderr);
	assert.deepEqual(raced.map((r) => r.status).sort(), [0, 1], raced.map((r) => r.stdout + r.stderr).join("\n"));
	// No half-claimed slot: the roster and the job records are the same four jobs.
	assert.deepEqual(roles(), ["team-1 coordinator", "team-2 coordinator", "team-1 worker", "team-2 worker"]);
	assert.deepEqual(new Set(readdirSync(join(p.root, ".limen/jobs"))), new Set(members().map((member) => member.id)));
	assert.equal(waitJob(p, roster.worker2), "done");

	const worker = as(roster.worker1, "team-1");
	assert.equal(limen(p, ["spawn", ...ROUTE, "say nested"], { env: worker }).status, 1, "a worker cannot launch");
	assert.equal(readdirSync(join(p.root, ".limen/jobs")).length, 4);
});

test("a member's finish completes while another process holds the cabinet; its lifecycle event follows once the lock frees", async () => {
	// A live owner (this test process) holds the cabinet lock; a live owner is never evicted.
	const lock = join(cabinet(), ".lock");
	await until(cabinet(), () => {
		try {
			mkdirSync(lock);
		} catch {
			return false;
		}
		writeFileSync(join(lock, "owner"), `${process.pid}\n`);
		return true;
	});
	await release(jobDir(p, roster.worker1));
	assert.equal(waitJob(p, roster.worker1), "done");
	await until(jobDir(p, roster.worker1), () => /^accepted/.test(jobFile(p, roster.worker1, "finish-webhook")));
	await rm(lock, { recursive: true });
	// `group status` publishes lifecycle only when it gets the cabinet, and live member hooks take it for a moment, so read
	// until the event is there; one more read must still show exactly one.
	const doneEvents = () => {
		const status = limen(p, ["group", "status", group, "--json"], { env: LEAD });
		assert.equal(status.status, 0, status.stderr);
		const events: Array<{ author: string; text: string }> = JSON.parse(status.stdout).events;
		return events.filter((event) => event.author === roster.worker1 && event.text.endsWith(": state done")).length;
	};
	let seen = 0;
	while (seen === 0) {
		seen = doneEvents();
	}
	assert.deepEqual([seen, doneEvents()], [1, 1]);
});

test("each recipient reads a finding once, the lead hears it as a followUp, and a synthesis write sends a lead-step ping", async () => {
	const author = as(roster.coordinator2, "team-2"),
		reader = as(roster.coordinator1, "team-1");
	assert.equal(limen(p, ["group", "publish", "s8 first finding"], { env: author }).status, 0);
	let read = "";
	while (!read.includes("s8 first finding")) {
		read += limen(p, ["group", "wait"], { env: reader }).stdout;
	}
	await writeFile(join(p.root, FEATURE, "group/synthesis.md"), "# Synthesis\n\nTeam 1 wins.\n");
	// A later finding orders the counts: a repeat of the first would have arrived before it.
	assert.equal(limen(p, ["group", "publish", "s8 later finding"], { env: author }).status, 0);
	const later = limen(p, ["group", "wait"], { env: reader }).stdout;
	assert.match(later, /s8 later finding/);
	assert.doesNotMatch(later, /s8 first finding/);
	await until(
		lead,
		() => delivered().some((entry) => entry.text?.includes("s8 later finding")) && pings("synthesis").length > 0,
	);
	assert.equal(delivered().filter((entry) => entry.text?.includes("s8 first finding")).length, 1);
	// A group update wakes an idle lead without interrupting a busy one: only followUp does both.
	assert.deepEqual([...new Set(delivered().map((entry) => entry.event))], ["followUp"]);
});

test("a second group runs two routes through draft, critique and final, and the lead hears its result once", async () => {
	const teams = ["--team", TEAM, "--team", "omp:fake/fake-2:low", "--rounds", "draft,critique,final"];
	const started = await run(["group", "start", ROUNDS, ...teams], LEAD);
	const finished = `Group ${ROUNDS} (${startedId(started)}) finished`;
	await until(lead, () => delivered().some((entry) => entry.text?.includes(finished)));
	const runFile = readFileSync(join(p.root, ".limen/groups", startedId(started), "run.json"), "utf8");
	const jobs: Array<{ id: string; team: string; round: number; parent?: string }> = JSON.parse(runFile).members;
	// Every team continues in its own session into the critique; the final round is the first team's alone.
	const chain = jobs.map((job) => `${job.team} ${job.round} ${jobs.findIndex((other) => other.id === job.parent)}`);
	assert.deepEqual(chain, ["team-1 0 -1", "team-2 0 -1", "team-1 1 0", "team-2 1 1", "team-1 2 2"]);
	const argv: string[] = JSON.parse(jobFile(p, jobs[3]?.id ?? "", "fake-argv.json"));
	assert.deepEqual([argv[argv.indexOf("--model") + 1], argv[argv.indexOf("--thinking") + 1]], ["fake-2", "low"]);
	const finalTask = readFileSync(join(jobDir(p, jobs[4]?.id ?? ""), "task.md"), "utf8");
	assert.match(finalTask, /rounds\/1-draft\/team-2\.md[\s\S]*rounds\/2-critique\/team-2\.md/);
	assert.equal(delivered().filter((entry) => entry.text?.includes(finished)).length, 1);
	// Five team jobs start and end here; the lead hears none of it.
	assert.ok(!delivered().some((entry) => entry.text?.includes("| lifecycle |")));
});

test("close refuses a member with uncommitted work until it is clean; each lead step pings once", async () => {
	assert.equal(limen(p, ["group", "stop", group], { env: LEAD }).status, 0);
	const dirty = join(jobFile(p, roster.coordinator2, "worktree"), "recovery.txt");
	await writeFile(dirty, "keep me\n");
	assert.equal(limen(p, ["group", "close", group], { env: LEAD }).status, 1);
	assert.equal(JSON.parse(readFileSync(join(cabinet(), "run.json"), "utf8")).closed, false);
	await rm(dirty);
	await rm(join(jobFile(p, roster.worker2, "worktree"), ".git")); // a folder a prune race left: no Git work in it
	limen(p, ["group", "close", group], { env: LEAD });
	assert.equal(JSON.parse(readFileSync(join(cabinet(), "run.json"), "utf8")).closed, true);
	// The lead's next turn after close is its last: one close ping, and still one synthesis ping. The ping is queued at
	// that turn and its own deliverer sends it, so it can land just after the session exits.
	await release(lead);
	await once(session, "exit");
	await until(p.parent, () => pings("close").length > 0);
	assert.deepEqual([pings("synthesis").length, pings("close").length], [1, 1]);
});
