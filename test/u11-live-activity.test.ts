// U11: what the live picture says a job does. A record that says running is never shown as working when its owner is
// gone or it has been silent too long; finished jobs leave the page after an hour; job folders of both engines read
// the same way; a coordinator's workers and a group's teams nest as one tree.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	activityReader,
	CHECK_QUIET_MS,
	FINISHED_SHOWN_MS,
	type JobFiles,
	jobActivity,
	QUIET_MS,
	toolWords,
} from "../src/picture/activity.ts";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const job = (over: Partial<JobFiles>): JobFiles => ({
	id: "2026-10-08-f932-live-1a2b3c4d",
	state: "running",
	spawning: false,
	owner: "alive",
	label: "F932 follow-up for F780",
	engine: "omp",
	model: "pi-claude/claude-opus-5-5",
	activity: "tool",
	lastTool: "bash",
	detail: "npm test",
	stopReason: "",
	tools: 3,
	hosted: false,
	role: "worker",
	spawnedBy: "",
	group: "",
	team: "",
	startedAt: NOW - 60_000,
	lastEventAt: NOW - 1_000,
	finishedAt: undefined,
	...over,
});
const seen = (over: Partial<JobFiles>) => {
	const live = jobActivity(job(over), NOW);
	return live && [live.state, live.doing, live.detail];
};

test("a running record reads by its owner and its last event, never as working when either is stale", () => {
	assert.deepEqual(seen({}), ["working", "running tests and checks", "npm test"]);
	assert.deepEqual(seen({ owner: "gone" }), ["dead", "running tests and checks", ""]);
	assert.deepEqual(seen({ owner: "none" }), ["starting", "starting", ""]);
	assert.deepEqual(seen({ owner: "gone", lastEventAt: NOW - CHECK_QUIET_MS - 1 }), [
		"dead",
		"running tests and checks",
		"",
	]);
	assert.deepEqual(seen({ activity: "wait" }), ["waiting", "waiting", ""]);
	assert.deepEqual(seen({ activity: "think" }), ["working", "thinking", ""]);
	assert.deepEqual(seen({ state: "", spawning: true }), ["starting", "starting", ""]);
	assert.equal(seen({ state: "", spawning: false }), undefined);
});

test("a job turns quiet after 5 minutes without an event, or 15 while it runs a test or check", () => {
	assert.deepEqual([QUIET_MS, CHECK_QUIET_MS], [5 * 60_000, 15 * 60_000]);
	const state = (over: Partial<JobFiles>) => jobActivity(job(over), NOW)?.state;
	assert.equal(state({ detail: "ls -la", lastEventAt: NOW - QUIET_MS }), "working");
	assert.equal(state({ detail: "ls -la", lastEventAt: NOW - QUIET_MS - 1 }), "quiet");
	assert.equal(state({ activity: "think", lastEventAt: NOW - QUIET_MS - 1 }), "quiet");
	assert.equal(state({ detail: "npm test", lastEventAt: NOW - 6 * 60_000 }), "working");
	assert.equal(state({ detail: "npm test", lastEventAt: NOW - CHECK_QUIET_MS }), "working");
	assert.equal(state({ detail: "npm test", lastEventAt: NOW - CHECK_QUIET_MS - 1 }), "quiet");
});

test("a finished job shows its end for an hour, then leaves the page", () => {
	const finishedAt = NOW - FINISHED_SHOWN_MS;
	assert.deepEqual(seen({ state: "done", finishedAt }), ["done", "", ""]);
	assert.deepEqual(seen({ state: "failed", finishedAt, stopReason: "error: overloaded" }), [
		"failed",
		"error: overloaded",
		"",
	]);
	assert.equal(seen({ state: "stopped", finishedAt: finishedAt - 1 }), undefined);
	assert.equal(jobActivity(job({ state: "done", finishedAt }), NOW)?.finishedAt, new Date(finishedAt).toISOString());
	assert.deepEqual(jobActivity(job({}), NOW)?.work, ["f932", "f780"]);
});

test("tool words name the kind of work in plain words", () => {
	assert.equal(toolWords("bash", "npx biome check ."), "running tests and checks");
	assert.equal(toolWords("bash", "cd app && npm run test -- --watch=false"), "running tests and checks");
	assert.equal(toolWords("bash", "node ~/.agents/skills/browser-check/browser.mjs shot"), "running a command");
	assert.equal(toolWords("bash", "git status --short"), "running a command");
	assert.equal(toolWords("edit", ""), "editing files");
	assert.equal(toolWords("grep", ""), "reading code");
	assert.equal(toolWords("task", ""), "running helpers");
	assert.equal(toolWords("constructor", ""), "using constructor");
});

test("the reader reads detached and hosted job folders the same way", async () => {
	const jobs = await mkdtemp(join(tmpdir(), "limen-live-"));
	const gone = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]).stdout.toString();
	const folder = async (id: string, files: Record<string, string>) => {
		await mkdir(join(jobs, id, "session"), { recursive: true });
		for (const [name, body] of Object.entries(files)) {
			await writeFile(join(jobs, id, name), body);
		}
	};
	const running = { state: "running\n", pid: `${process.pid}\n`, activity: "tool\n", "last-tool": "bash\n" };
	const session = "session/2026-10-08T11-59-00Z_a.jsonl";
	await folder("2026-10-08-f932-detached-00000001", {
		...running,
		engine: "pi\n",
		log: "think\nbash npm test\n",
		[session]: '{"type":"session"}\n{"type":"model_change","provider":"openai-codex","modelId":"gpt-6-sol"}\n',
	});
	await folder("2026-10-08-f932-hosted-00000002", {
		...running,
		engine: "omp\n",
		"tool-detail": "git log\n",
		[session]: '{"type":"title"}\n{"type":"model_change","model":"pi-claude/claude-opus-5-5"}\n',
	});
	await folder("2026-10-08-f932-gone-00000003", { ...running, pid: `${gone}\n` });
	const snapshot = await activityReader(jobs)();
	const rows = snapshot.jobs.map((live) => [live.id.slice(16, -9), live.state, live.doing, live.detail, live.model]);
	assert.deepEqual(rows.sort(), [
		["detached", "working", "running tests and checks", "npm test", "openai-codex/gpt-6-sol"],
		["gone", "dead", "running a command", "", ""],
		["hosted", "working", "running a command", "git log", "pi-claude/claude-opus-5-5"],
	]);
});

test("a coordinator's workers and a group's teams nest as one tree with their states counted", async () => {
	const root = await mkdtemp(join(tmpdir(), "limen-tree-"));
	const gone = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]).stdout.toString();
	const folder = async (id: string, files: Record<string, string>) => {
		await mkdir(join(root, "jobs", id), { recursive: true });
		for (const [name, body] of Object.entries(files)) {
			await writeFile(join(root, "jobs", id, name), body);
		}
	};
	const running = { state: "running\n", pid: `${process.pid}\n`, activity: "think\n", role: "worker\n" };
	const member = (team: string, files: Record<string, string> = {}) => ({ ...running, group: "g1\n", team, ...files });
	await folder("c1", member("team-1", { role: "coordinator\n" }));
	// An older group worker records no spawn link: it goes under its team's coordinator.
	await folder("w1", member("team-1", { activity: "wait\n" }));
	// Its coordinator is not on the page, so it stays at the top.
	await folder("w2", member("team-2", { pid: `${gone}\n` }));
	await folder("boss", { ...running, role: "coordinator\n" });
	await folder("helper", { ...running, "spawned-by": "boss\n" });
	await folder("orphan", { ...running, "spawned-by": "2026-01-01-long-gone-00000000\n" });
	await mkdir(join(root, "groups", "g1"), { recursive: true });
	const roster = [
		{ id: "w1", team: "team-1", role: "worker" },
		{ id: "c1", team: "team-1", role: "coordinator" },
		{ id: "c2", team: "team-2", role: "coordinator" },
		{ id: "w2", team: "team-2", role: "worker" },
	];
	const run = {
		id: "g1",
		feature: "spec/features/active/F929-biome",
		lead: "f929-lead-1",
		teams: ["team-1", "team-2"],
	};
	await writeFile(join(root, "groups/g1/run.json"), JSON.stringify({ ...run, members: roster }));
	const snapshot = await activityReader(join(root, "jobs"))();
	assert.deepEqual(Object.fromEntries(snapshot.jobs.map((live) => [live.id, live.parent])), {
		boss: null,
		c1: null,
		helper: "boss",
		orphan: null,
		w1: "c1",
		w2: null,
	});
	assert.deepEqual(snapshot.groups, [
		{
			id: "g1",
			work: ["f929"],
			feature: "F929-biome",
			lead: "f929-lead-1",
			teams: [
				{ name: "team-1", jobs: ["c1", "w1"], count: { working: 1, waiting: 1 } },
				{ name: "team-2", jobs: ["w2"], count: { dead: 1 } },
			],
			count: { working: 1, waiting: 1, dead: 1 },
		},
	]);
});
