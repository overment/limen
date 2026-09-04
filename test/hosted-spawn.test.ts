import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { hostedAgentName, makeJobId } from "../src/commands/spawn.ts";
import { hostedAgentStatus, hostedTerminalReason, startHostedPi, stopHostedAgent } from "../src/herdr.ts";
import { DEFAULT_HOSTED_IDLE_MS, DEFAULT_STALL_RERING_MS, type HostedIdleWatch, noteHostedIdle, writeHostedResult } from "../src/supervisor.ts";
import { git, limen, limenWithEnv, onlyJobId, scratchRepo, waitForState } from "./scratch.ts";

test("hosted completion is session end or vanished agent, not Herdr idle", () => {
	assert.equal(hostedTerminalReason("idle", false), undefined);
	assert.equal(hostedTerminalReason("done", false), undefined);
	assert.equal(hostedTerminalReason("unknown", false), undefined);
	assert.equal(hostedTerminalReason("working", false), undefined);
	assert.equal(hostedTerminalReason("blocked", false), undefined);
	assert.equal(hostedTerminalReason("missing", false), "hosted agent ended");
	assert.equal(hostedTerminalReason("idle", true), "hosted session ended");
	assert.equal(hostedTerminalReason("missing", true), "hosted session ended");
});

test("hosted result capture follows the last assistant stop reason", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "limen-hosted-result-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, "session"));
	await writeFile(
		join(root, "session/run.jsonl"),
		`${JSON.stringify({ type: "message", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "temporary" } })}\n${JSON.stringify({ type: "message", message: { role: "assistant", content: [], stopReason: "stop" } })}\n`,
	);
	await writeHostedResult(root);
	await assert.rejects(readFile(join(root, "stop-reason")));
});

test("hosted result capture keeps a tool-written result over later assistant text", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "limen-hosted-finish-result-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, "session"));
	await writeFile(join(root, "result"), "handoff from finish\n");
	await writeFile(join(root, "session/run.jsonl"), `${JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "Done." }] } })}\n`);
	await writeHostedResult(root);
	assert.equal(await readFile(join(root, "result"), "utf8"), "handoff from finish\n");
});

test("hosted idle bound defaults to 60s and re-ring to 15m", () => {
	assert.equal(DEFAULT_HOSTED_IDLE_MS, 60_000);
	assert.equal(DEFAULT_STALL_RERING_MS, 15 * 60_000);
});

test("noteHostedIdle finalizes a clean idle turn with no tool call and writes no advisory", async (context) => {
	const dir = await mkdtemp(join(tmpdir(), "limen-idle-clean-"));
	context.after(() => rm(dir, { recursive: true, force: true }));
	const tree = join(dir, "tree");
	await mkdir(tree);
	git(tree, "init", "-b", "main");
	git(tree, "config", "user.email", "limen@example.test");
	git(tree, "config", "user.name", "Limen Test");
	await writeFile(join(tree, "README.md"), "ok\n");
	git(tree, "add", ".");
	git(tree, "commit", "-m", "initial");
	await writeFile(join(dir, "worktree"), `${tree}\n`);
	await mkdir(join(dir, "session"));
	await writeFile(join(dir, "session/run.jsonl"), `${JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "done." }] } })}\n`);
	await writeFile(join(dir, "last-turn-tools"), "0\n");
	await writeFile(join(dir, "activity"), "wait\n");
	const watch: HostedIdleWatch = { leftWorkingAt: undefined, armed: true };
	assert.equal(await noteHostedIdle(dir, "idle", watch, 0, 1_000), undefined);
	assert.equal(await noteHostedIdle(dir, "idle", watch, 1_000, 1_000), "closed a clean idle session");
	await assert.rejects(readFile(join(dir, "advisory")), "a clean idle turn must not write an advisory");
	await writeFile(join(tree, "dirty.txt"), "left behind\n");
	const dirty: HostedIdleWatch = { leftWorkingAt: undefined, armed: true };
	assert.equal(await noteHostedIdle(dir, "idle", dirty, 0, 1_000), undefined);
	assert.equal(await noteHostedIdle(dir, "idle", dirty, 1_000, 1_000), undefined);
	await writeFile(join(dir, "last-turn-tools"), "2\n");
	await writeFile(join(dir, "tool-calls"), "2\n");
	const stalled: HostedIdleWatch = { leftWorkingAt: undefined, armed: true };
	assert.equal(await noteHostedIdle(dir, "idle", stalled, 0, 1_000), undefined);
	assert.equal(await noteHostedIdle(dir, "idle", stalled, 1_000, 1_000), undefined);
	assert.match(await readFile(join(dir, "advisory"), "utf8"), /idle 1s after 2 tool calls/);
});

test("noteHostedIdle finalizes a clean tool-using turn without claiming the session ended", async (context) => {
	const dir = await mkdtemp(join(tmpdir(), "limen-idle-tools-"));
	context.after(() => rm(dir, { recursive: true, force: true }));
	const tree = join(dir, "tree");
	await mkdir(tree);
	git(tree, "init", "-b", "main");
	git(tree, "config", "user.email", "limen@example.test");
	git(tree, "config", "user.name", "Limen Test");
	await writeFile(join(tree, "README.md"), "ok\n");
	git(tree, "add", ".");
	git(tree, "commit", "-m", "initial");
	await writeFile(join(dir, "worktree"), `${tree}\n`);
	await mkdir(join(dir, "session"));
	await writeFile(join(dir, "session/run.jsonl"), `${JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "handoff." }] } })}\n`);
	await writeFile(join(dir, "last-turn-tools"), "3\n");
	await writeFile(join(dir, "tool-calls"), "3\n");
	await writeFile(join(dir, "activity"), "wait\n");
	const watch: HostedIdleWatch = { leftWorkingAt: undefined, armed: true };
	assert.equal(await noteHostedIdle(dir, "idle", watch, 0, 1_000), undefined);
	const reason = await noteHostedIdle(dir, "idle", watch, 1_000, 1_000);
	assert.equal(reason, "closed a clean idle session");
	assert.notEqual(reason, "hosted session ended");
	await assert.rejects(readFile(join(dir, "advisory")), "a clean tool-using turn must not write an advisory");

	await rm(join(dir, "session/run.jsonl"));
	const missing: HostedIdleWatch = { leftWorkingAt: undefined, armed: true };
	assert.equal(await noteHostedIdle(dir, "idle", missing, 0, 1_000), undefined);
	assert.equal(await noteHostedIdle(dir, "idle", missing, 1_000, 1_000), undefined, "no assistant response is not a clean idle close");
	assert.match(await readFile(join(dir, "advisory"), "utf8"), /idle 1s after 3 tool calls/);

	await writeFile(join(dir, "session/run.jsonl"), `${JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "handoff." }] } })}\n`);
	await rm(join(dir, "advisory"), { force: true });
	await writeFile(join(tree, "dirty.txt"), "left behind\n");
	const dirty: HostedIdleWatch = { leftWorkingAt: undefined, armed: true };
	assert.equal(await noteHostedIdle(dir, "idle", dirty, 0, 1_000), undefined);
	assert.equal(await noteHostedIdle(dir, "idle", dirty, 1_000, 1_000), undefined, "a dirty worktree is not a clean idle close");
	assert.match(await readFile(join(dir, "advisory"), "utf8"), /idle 1s after 3 tool calls/);

	await rm(join(tree, "dirty.txt"));
	await rm(join(dir, "advisory"), { force: true });
	await writeFile(join(dir, "activity"), "think\n");
	const thinking: HostedIdleWatch = { leftWorkingAt: undefined, armed: true };
	assert.equal(await noteHostedIdle(dir, "idle", thinking, 0, 1_000), undefined);
	assert.equal(await noteHostedIdle(dir, "idle", thinking, 1_000, 1_000), undefined, "think is not a clean idle close");
	await assert.rejects(readFile(join(dir, "advisory")), "think must not advisory");
	assert.equal(thinking.leftWorkingAt, undefined);

	await writeFile(join(dir, "activity"), "tool\n");
	const tooling: HostedIdleWatch = { leftWorkingAt: undefined, armed: true };
	assert.equal(await noteHostedIdle(dir, "idle", tooling, 1_000, 1_000), undefined, "tool activity is not a clean idle close");
	await assert.rejects(readFile(join(dir, "advisory")), "tool must not advisory");

	await writeFile(join(dir, "activity"), "wait\n");
	await writeFile(
		join(dir, "session/run.jsonl"),
		`${JSON.stringify({ type: "message", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "usage limit reached" } })}\n`,
	);
	const failed: HostedIdleWatch = { leftWorkingAt: undefined, armed: true };
	assert.equal(await noteHostedIdle(dir, "idle", failed, 0, 1_000), undefined);
	assert.equal(await noteHostedIdle(dir, "idle", failed, 1_000, 1_000), undefined, "a failed last response is not a clean idle close");
	assert.match(await readFile(join(dir, "advisory"), "utf8"), /errored: last turn failed/);

	await rm(join(dir, "advisory"), { force: true });
	await writeFile(join(dir, "session/run.jsonl"), `${JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "handoff." }] } })}\n`);
	const blocked: HostedIdleWatch = { leftWorkingAt: undefined, armed: true };
	assert.equal(await noteHostedIdle(dir, "blocked", blocked, 0, 1_000), undefined, "blocked is not a clean idle close");
	assert.match(await readFile(join(dir, "advisory"), "utf8"), /blocked after 3 tool calls/);
});

test("noteHostedIdle writes one stall marker, skips zero tools, and re-arms after working", async () => {
	const dir = await mkdtemp(join(tmpdir(), "limen-idle-"));
	try {
		await writeFile(join(dir, "tool-calls"), "0\n");
		await writeFile(join(dir, "activity"), "wait\n");
		const watch: HostedIdleWatch = { leftWorkingAt: undefined, armed: true };
		await noteHostedIdle(dir, "idle", watch, 0, 10 * 60_000);
		assert.equal(watch.leftWorkingAt, 0);
		assert.equal(watch.armed, true);
		await noteHostedIdle(dir, "idle", watch, 10 * 60_000, 10 * 60_000);
		await assert.rejects(readFile(join(dir, "advisory")), "zero tool calls is not a stall");
		await writeFile(join(dir, "tool-calls"), "14\n");
		await noteHostedIdle(dir, "idle", watch, 10 * 60_000, 10 * 60_000);
		assert.equal(await readFile(join(dir, "advisory"), "utf8"), "idle 10m after 14 tool calls, session still open\n");
		assert.equal(watch.armed, false);
		await noteHostedIdle(dir, "idle", watch, 20 * 60_000, 10 * 60_000);
		assert.equal(await readFile(join(dir, "advisory"), "utf8"), "idle 10m after 14 tool calls, session still open\n", "same stall must not nag");
		await mkdir(join(dir, "notify/delivered/_advisory.coord"), { recursive: true });
		await writeFile(join(dir, "notify/delivered/_advisory.coord/accepted"), "1\n");
		await noteHostedIdle(dir, "working", watch, 21 * 60_000, 10 * 60_000);
		assert.equal(watch.armed, true);
		assert.equal(watch.leftWorkingAt, undefined);
		await assert.rejects(readFile(join(dir, "advisory")));
		await assert.rejects(readdir(join(dir, "notify/delivered/_advisory.coord")));
		await noteHostedIdle(dir, "idle", watch, 21 * 60_000, 10 * 60_000);
		await noteHostedIdle(dir, "idle", watch, 31 * 60_000, 10 * 60_000);
		assert.equal(await readFile(join(dir, "advisory"), "utf8"), "idle 10m after 14 tool calls, session still open\n");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("noteHostedIdle rings and stamps unheard stalls until delivery, then restores and re-arms", async () => {
	const dir = await mkdtemp(join(tmpdir(), "limen-stall-ring-"));
	const callsPath = join(dir, "herdr-calls");
	const previousRering = process.env.LIMEN_STALL_RERING_MS;
	const previousHerdrEnv = process.env.HERDR_ENV;
	const previousHerdrPane = process.env.HERDR_PANE_ID;
	const previousRole = process.env.LIMEN_ROLE;
	try {
		await mkdir(join(dir, "herdr"));
		await writeFile(join(dir, "herdr/pane"), "w1:p1\n");
		await writeFile(join(dir, "label"), "F045 stall ring\n");
		await writeFile(join(dir, "tool-calls"), "4\n");
		await writeFile(join(dir, "activity"), "wait\n");
		process.env.LIMEN_STALL_RERING_MS = "10";
		process.env.LIMEN_ROLE = "worker";
		delete process.env.HERDR_ENV;
		delete process.env.HERDR_PANE_ID;
		await withFakeHerdr(
			`const args = process.argv.slice(2);
const allowed = ["idle", "working", "blocked", "done", "unknown"];
for (let i = 0; i < args.length; i++) {
	if (args[i] === "--state-label" && !allowed.includes(args[i + 1].split("=", 1)[0])) process.exit(2);
}
require("node:fs").appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + "\\n");
`,
			async () => {
				const watch: HostedIdleWatch = { leftWorkingAt: undefined, armed: true };
				await noteHostedIdle(dir, "idle", watch, 0, 60);
				await noteHostedIdle(dir, "idle", watch, 60, 60);
				let calls = (await readFile(callsPath, "utf8"))
					.trim()
					.split("\n")
					.map((line) => JSON.parse(line) as string[]);
				assert.equal(calls.filter((call) => call[0] === "notification").length, 1);
				const first = calls[0] as string[];
				assert.deepEqual(first.slice(0, 5), ["pane", "report-metadata", "w1:p1", "--source", "limen"]);
				assert.equal(first[first.indexOf("--display-agent") + 1], "⚠ stalled 1s");
				assert.deepEqual(
					first.flatMap((arg, i) => (arg === "--state-label" ? [first[i + 1]] : [])),
					["idle=⚠ stalled 1s", "done=⚠ stalled 1s", "blocked=⚠ stalled 1s"],
				);

				await noteHostedIdle(dir, "idle", watch, 69, 60);
				await noteHostedIdle(dir, "idle", watch, 70, 60);
				calls = (await readFile(callsPath, "utf8"))
					.trim()
					.split("\n")
					.map((line) => JSON.parse(line) as string[]);
				assert.equal(calls.filter((call) => call[0] === "notification").length, 2, "an unheard stall re-rings at the configured interval");

				await mkdir(join(dir, "notify/delivered/_advisory.coord"), { recursive: true });
				await noteHostedIdle(dir, "idle", watch, 120_000, 60);
				calls = (await readFile(callsPath, "utf8"))
					.trim()
					.split("\n")
					.map((line) => JSON.parse(line) as string[]);
				assert.equal(calls.filter((call) => call[0] === "notification").length, 2, "delivery silences later rings");
				const stalled = calls.filter((call) => call[0] === "pane").at(-1) as string[];
				assert.equal(stalled[stalled.indexOf("--display-agent") + 1], "⚠ stalled 2m", "the stamped duration keeps updating");

				await noteHostedIdle(dir, "working", watch, 120_001, 60);
				calls = (await readFile(callsPath, "utf8"))
					.trim()
					.split("\n")
					.map((line) => JSON.parse(line) as string[]);
				const restored = calls.at(-1) as string[];
				assert.equal(restored[restored.indexOf("--display-agent") + 1], "limen worker");
				assert.ok(restored.includes("--clear-state-labels"));
				await assert.rejects(readFile(join(dir, "advisory")));

				await noteHostedIdle(dir, "idle", watch, 120_001, 60);
				await noteHostedIdle(dir, "idle", watch, 120_061, 60);
				calls = (await readFile(callsPath, "utf8"))
					.trim()
					.split("\n")
					.map((line) => JSON.parse(line) as string[]);
				assert.equal(calls.filter((call) => call[0] === "notification").length, 3, "recovery re-arms the supervisor ring");

				process.env.LIMEN_ROLE = "reviewer";
				await noteHostedIdle(dir, "working", watch, 120_062, 60);
				calls = (await readFile(callsPath, "utf8"))
					.trim()
					.split("\n")
					.map((line) => JSON.parse(line) as string[]);
				const reviewerRestored = calls.at(-1) as string[];
				assert.equal(reviewerRestored[reviewerRestored.indexOf("--display-agent") + 1], "limen reviewer");
				assert.ok(reviewerRestored.includes("--clear-state-labels"));
			},
		);
	} finally {
		if (previousRering === undefined) delete process.env.LIMEN_STALL_RERING_MS;
		else process.env.LIMEN_STALL_RERING_MS = previousRering;
		if (previousHerdrEnv === undefined) delete process.env.HERDR_ENV;
		else process.env.HERDR_ENV = previousHerdrEnv;
		if (previousHerdrPane === undefined) delete process.env.HERDR_PANE_ID;
		else process.env.HERDR_PANE_ID = previousHerdrPane;
		if (previousRole === undefined) delete process.env.LIMEN_ROLE;
		else process.env.LIMEN_ROLE = previousRole;
		await rm(dir, { recursive: true, force: true });
	}
});

test("noteHostedIdle treats blocked as immediate and ignores unknown", async () => {
	const dir = await mkdtemp(join(tmpdir(), "limen-blocked-"));
	try {
		await writeFile(join(dir, "tool-calls"), "3\n");
		await writeFile(join(dir, "activity"), "tool\n");
		const watch: HostedIdleWatch = { leftWorkingAt: undefined, armed: true };
		await noteHostedIdle(dir, "unknown", watch, 0, 10 * 60_000);
		assert.equal(watch.leftWorkingAt, undefined);
		await assert.rejects(readFile(join(dir, "advisory")));
		await noteHostedIdle(dir, "blocked", watch, 0, 10 * 60_000);
		assert.equal(await readFile(join(dir, "advisory"), "utf8"), "blocked after 3 tool calls, session still open\n");
		assert.equal(watch.armed, false);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("noteHostedIdle ignores idle while activity is think or tool", async () => {
	const dir = await mkdtemp(join(tmpdir(), "limen-idle-loop-"));
	try {
		await writeFile(join(dir, "tool-calls"), "5\n");
		await writeFile(join(dir, "activity"), "think\n");
		const watch: HostedIdleWatch = { leftWorkingAt: undefined, armed: true };
		await noteHostedIdle(dir, "idle", watch, 0, 60_000);
		await noteHostedIdle(dir, "idle", watch, 60_000, 60_000);
		await assert.rejects(readFile(join(dir, "advisory")), "think is the loop still going");
		assert.equal(watch.armed, true);
		assert.equal(watch.leftWorkingAt, undefined);
		await writeFile(join(dir, "activity"), "tool\n");
		await noteHostedIdle(dir, "idle", watch, 120_000, 60_000);
		await assert.rejects(readFile(join(dir, "advisory")), "tool is the loop still going");
		assert.equal(watch.leftWorkingAt, undefined);
		await writeFile(join(dir, "activity"), "wait\n");
		await noteHostedIdle(dir, "idle", watch, 120_000, 60_000);
		await noteHostedIdle(dir, "idle", watch, 180_000, 60_000);
		assert.equal(await readFile(join(dir, "advisory"), "utf8"), "idle 1m after 5 tool calls, session still open\n");
		assert.equal(watch.armed, false);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("noteHostedIdle writes an errored advisory when the last assistant turn failed", async (context) => {
	const dir = await mkdtemp(join(tmpdir(), "limen-idle-errored-"));
	context.after(() => rm(dir, { recursive: true, force: true }));
	const tree = join(dir, "tree");
	await mkdir(tree);
	git(tree, "init", "-b", "main");
	git(tree, "config", "user.email", "limen@example.test");
	git(tree, "config", "user.name", "Limen Test");
	await writeFile(join(tree, "README.md"), "ok\n");
	git(tree, "add", ".");
	git(tree, "commit", "-m", "initial");
	await mkdir(join(dir, "session"));
	await writeFile(join(dir, "worktree"), `${tree}\n`);
	await writeFile(join(dir, "last-turn-tools"), "0\n");
	await writeFile(join(dir, "activity"), "wait\n");
	await writeFile(
		join(dir, "session/run.jsonl"),
		`${JSON.stringify({ type: "message", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "usage limit reached" } })}\n`,
	);
	const watch: HostedIdleWatch = { leftWorkingAt: undefined, armed: true };
	assert.equal(await noteHostedIdle(dir, "idle", watch, 0, 1_000), undefined);
	assert.equal(await noteHostedIdle(dir, "idle", watch, 1_000, 1_000), undefined);
	assert.equal(await readFile(join(dir, "advisory"), "utf8"), "errored: last turn failed with error: usage limit reached, session still open\n");
	assert.equal(watch.armed, false);
	await assert.rejects(readFile(join(dir, "finished-at")), "an errored turn must not finalize the job");
});

test("noteHostedIdle snapshots result and commits without finishing", async () => {
	const parent = await mkdtemp(join(tmpdir(), "limen-idle-snap-"));
	const repo = join(parent, "repo");
	const dir = join(parent, "job");
	try {
		await mkdir(repo);
		git(repo, "init", "-b", "main");
		git(repo, "config", "user.email", "limen@example.test");
		git(repo, "config", "user.name", "Limen Test");
		await writeFile(join(repo, "README.md"), "scratch\n");
		git(repo, "add", ".");
		git(repo, "commit", "-m", "initial");
		const base = git(repo, "rev-parse", "HEAD");
		await mkdir(join(dir, "session"), { recursive: true });
		await writeFile(join(dir, "base"), `${base}\n`);
		await writeFile(join(dir, "branch"), "main\n");
		await writeFile(join(dir, "worktree"), `${repo}\n`);
		await writeFile(join(dir, "tool-calls"), "2\n");
		await writeFile(join(dir, "activity"), "wait\n");
		const entries = [
			JSON.stringify({ type: "session", version: 3 }),
			JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "early note" }] } }),
			JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "hosted stall summary" }] } }),
		];
		await writeFile(join(dir, "session/2026-01-01T00-00-00-000Z_abc.jsonl"), `${entries.join("\n")}\n`);
		await writeFile(join(repo, "stall.txt"), "done\n");
		git(repo, "add", "stall.txt");
		git(repo, "commit", "-m", "stall work");
		await writeFile(join(repo, "dirty.txt"), "left behind\n");
		const watch: HostedIdleWatch = { leftWorkingAt: undefined, armed: true };
		await noteHostedIdle(dir, "idle", watch, 0, 60_000);
		await assert.rejects(readFile(join(dir, "advisory")));
		await noteHostedIdle(dir, "idle", watch, 60_000, 60_000);
		assert.equal(await readFile(join(dir, "advisory"), "utf8"), "idle 1m after 2 tool calls, session still open\n");
		assert.equal(await readFile(join(dir, "result"), "utf8"), "hosted stall summary\n");
		assert.match(await readFile(join(dir, "commits"), "utf8"), /stall work/);
		await assert.rejects(readFile(join(dir, "finished-at")), "stall must not finalize");
		assert.equal(watch.armed, false);
	} finally {
		await rm(parent, { recursive: true, force: true });
	}
});

test("hostedAgentStatus reads nested 0.8.0 envelope and flat legacy", async () => {
	await withFakeHerdr(
		`const target = process.argv[4];
const ok = (result) => console.log(JSON.stringify({ result }));
const fail = (code, message) => { console.log(JSON.stringify({ error: { code, message } })); process.exit(1); };
if (process.argv[2] === "agent" && process.argv[3] === "get") {
  if (target === "nested-working") ok({ type: "agent_info", agent: { agent_status: "working", pane_id: target } });
  else if (target === "nested-idle") ok({ type: "agent_info", agent: { agent_status: "idle", pane_id: target } });
  else if (target === "nested-blocked") ok({ type: "agent_info", agent: { agent_status: "blocked", pane_id: target } });
  else if (target === "flat-working") ok({ type: "agent_info", agent_status: "working", pane_id: target });
  else if (target === "flat-idle") ok({ type: "agent_info", agent_status: "idle", pane_id: target });
  else if (target === "flat-blocked") ok({ type: "agent_info", agent_status: "blocked", pane_id: target });
  else if (target === "gone") fail("agent_not_found", "missing");
  else if (target === "timeout") fail("timeout", "herdr timeout");
  else { console.log("not-json"); process.exit(1); }
} else process.exit(1);
`,
		() => {
			assert.equal(hostedAgentStatus("nested-working"), "working");
			assert.equal(hostedAgentStatus("nested-idle"), "idle");
			assert.equal(hostedAgentStatus("nested-blocked"), "blocked");
			assert.equal(hostedAgentStatus("flat-working"), "working");
			assert.equal(hostedAgentStatus("flat-idle"), "idle");
			assert.equal(hostedAgentStatus("flat-blocked"), "blocked");
			assert.equal(hostedAgentStatus("gone"), "missing");
			assert.equal(hostedAgentStatus("timeout"), "unknown");
			assert.equal(hostedAgentStatus("garbage"), "unknown");
		},
	);
});

test("hostedAgentStatus keeps last known status across a non-not-found CLI failure", async () => {
	const dir = await mkdtemp(join(tmpdir(), "limen-herdr-last-"));
	const bin = join(dir, "herdr");
	const count = join(dir, "n");
	await writeFile(count, "0");
	await writeFile(
		bin,
		`#!/usr/bin/env node
const { readFileSync, writeFileSync } = require("node:fs");
const n = Number(readFileSync(${JSON.stringify(count)}, "utf8")) + 1;
writeFileSync(${JSON.stringify(count)}, String(n));
if (n === 1) console.log(JSON.stringify({ result: { type: "agent_info", agent: { agent_status: "working" } } }));
else { console.log(JSON.stringify({ error: { code: "timeout", message: "herdr timeout" } })); process.exit(1); }
`,
	);
	await chmod(bin, 0o755);
	const previous = process.env.LIMEN_HERDR;
	process.env.LIMEN_HERDR = bin;
	try {
		assert.equal(hostedAgentStatus("blip-target"), "working");
		assert.equal(hostedAgentStatus("blip-target"), "working");
	} finally {
		if (previous === undefined) delete process.env.LIMEN_HERDR;
		else process.env.LIMEN_HERDR = previous;
		await rm(dir, { recursive: true, force: true });
	}
});

test("stopHostedAgent sends ctrl+c", async () => {
	const dir = await mkdtemp(join(tmpdir(), "limen-herdr-keys-"));
	const bin = join(dir, "herdr");
	const calls = join(dir, "calls");
	await writeFile(
		bin,
		`#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
appendFileSync(${JSON.stringify(calls)}, process.argv.slice(2).join(" ") + "\\n");
console.log(JSON.stringify({ result: { type: "ok" } }));
`,
	);
	await chmod(bin, 0o755);
	const previous = process.env.LIMEN_HERDR;
	process.env.LIMEN_HERDR = bin;
	try {
		stopHostedAgent("w1:p1");
		assert.equal(await readFile(calls, "utf8"), "agent send-keys w1:p1 ctrl+c\nagent send-keys w1:p1 ctrl+c\n");
	} finally {
		if (previous === undefined) delete process.env.LIMEN_HERDR;
		else process.env.LIMEN_HERDR = previous;
		await rm(dir, { recursive: true, force: true });
	}
});

test("spawn --tab refuses without Herdr and leaves no job record", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const refused = limen(scratch, "spawn", "--tab", "--label", "F010 noherdr", "do work");
	assert.equal(refused.status, 1);
	assert.match(refused.stderr, /hosted spawn requires Herdr/);
	assert.deepEqual(await readdir(join(scratch.root, ".limen/jobs")), []);
	const review = limen(scratch, "spawn", "--tab", "--review", "--branch", "limen/ghost", "inspect candidate");
	assert.equal(review.status, 1);
	assert.match(review.stderr, /hosted spawn requires Herdr/);
	assert.doesNotMatch(review.stderr, /does not support --review/);
	assert.deepEqual(await readdir(join(scratch.root, ".limen/jobs")), []);
});

test("spawn in Herdr is hosted without --tab; --detached keeps a watch tab", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const herdr = await installHostedFakeHerdr(scratch.root, scratch.fakeBin);
	const env = { HERDR_ENV: "1", LIMEN_HERDR: herdr.bin, FAKE_HERDR_STATE: herdr.dir, HERDR_TAB_ID: "coord:t0" };
	const launched = limenWithEnv(scratch, env, "spawn", "--label", "F010 hosted", "make a tiny commit");
	assert.equal(launched.status, 0, launched.stderr);
	assert.match(launched.stdout, /started F010 hosted \(hosted\)/);
	const id = onlyJobId(launched.stdout);
	const job = join(scratch.root, ".limen/jobs", id);
	assert.match(await readFile(join(job, "hosted"), "utf8"), /weaker guarantees/);
	assert.equal(await readFile(join(job, "herdr/mode"), "utf8"), "hosted\n");
	assert.equal(await waitForFile(join(job, "herdr/agent"), /w1:p1/), "w1:p1\n");
	const calls = await readFile(herdr.calls, "utf8");
	const lines = calls.split("\n");
	const focusNew = lines.findIndex((line) => line === "tab focus w1:t1");
	const start = lines.findIndex((line) => line.startsWith("agent start "));
	const focusCoord = lines.findIndex((line) => line === "tab focus coord:t0");
	assert.match(calls, /workspace create .*--label repo workers/);
	assert.match(calls, /tab create /);
	assert.match(calls, /--no-focus/);
	assert.doesNotMatch(calls, /tab create .*--focus/);
	const focusSpace = lines.findIndex((line) => line === "workspace focus coord");
	assert.ok(focusNew >= 0 && start > focusNew && focusSpace > start && focusCoord > focusSpace, calls);
	assert.equal(await readFile(join(job, "herdr/workspace"), "utf8"), "w1\n");
	assert.match(calls, /--kind pi/);
	assert.doesNotMatch(calls, /pane run .*tail/);
	await waitForState(scratch.root, id, "done");
	assert.match(await readFile(join(job, "log"), "utf8"), /hosted supervisor started/);
	const logDeadline = Date.now() + 2_000;
	let logText = "";
	while (Date.now() < logDeadline) {
		logText = await readFile(join(job, "log"), "utf8").catch(() => "");
		if (/hosted agent done|hosted agent ended/.test(logText)) break;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	assert.match(logText, /hosted agent done|hosted agent ended/);
});

test("hosted spawn returns on the supervisor PID while agent start is still busy", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const herdr = await installHostedFakeHerdr(scratch.root, scratch.fakeBin);
	const env = {
		HERDR_ENV: "1",
		LIMEN_HERDR: herdr.bin,
		FAKE_HERDR_STATE: herdr.dir,
		FAKE_HERDR_PERSIST: "1",
		FAKE_HERDR_START_BUSY_MS: "8000",
		HERDR_TAB_ID: "coord:t0",
	};
	const before = Date.now();
	const launched = limenWithEnv(scratch, env, "spawn", "--label", "F048 handshake", "stay hosted");
	assert.equal(launched.status, 0, launched.stderr);
	assert.ok(Date.now() - before < 6_000, "spawn must not wait for agent readiness");
	const id = onlyJobId(launched.stdout);
	const job = join(scratch.root, ".limen/jobs", id);
	const pid = Number((await readFile(join(job, "pid"), "utf8")).trim());
	assert.ok(Number.isSafeInteger(pid) && pid > 0);
	assert.doesNotThrow(() => process.kill(pid, 0));
	await waitForFile(join(herdr.dir, "start-busy"), /\d+/);
	await assert.rejects(readFile(join(job, "herdr/agent")), "the caller returned before agent start completed");
	await waitForFile(join(job, "herdr/agent"), /w1:p1/);
	await waitForFile(join(job, "log"), /hosted agent ready after start warning/);
	assert.equal(await readFile(join(job, "role"), "utf8"), "worker\n");
	assert.match(await readFile(join(job, "agent-name"), "utf8"), /^limen-f048-[0-9a-f]{8}\n$/);
	await writeFile(join(job, "session-ended"), `${new Date().toISOString()}\n`);
	await waitForState(scratch.root, id, "done");
});

test("hosted start retries one pane-shell failure and logs both attempts", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const herdr = await installHostedFakeHerdr(scratch.root, scratch.fakeBin);
	const env = {
		HERDR_ENV: "1",
		LIMEN_HERDR: herdr.bin,
		FAKE_HERDR_STATE: herdr.dir,
		FAKE_HERDR_PERSIST: "1",
		FAKE_HERDR_START_PANE_FAILURES: "1",
		HERDR_TAB_ID: "coord:t0",
	};
	const launched = limenWithEnv(scratch, env, "spawn", "--label", "F044 retry", "stay hosted");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	const job = join(scratch.root, ".limen/jobs", id);
	await waitForFile(herdr.calls, (value) => [...value.matchAll(/^agent start /gm)].length === 2);
	assert.equal((await readFile(join(job, "state"), "utf8")).trim(), "running");
	assert.equal([...(await readFile(herdr.calls, "utf8")).matchAll(/^agent start /gm)].length, 2);
	const log = await waitForFile(join(job, "log"), /hosted agent start attempt 2/);
	assert.match(log, /hosted agent start attempt 1/);
	assert.match(log, /hosted agent start attempt 2/);
	await writeFile(join(job, "session-ended"), `${new Date().toISOString()}\n`);
	await waitForState(scratch.root, id, "done");
});

test("hosted start finalizes failed after two pane-shell failures", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const herdr = await installHostedFakeHerdr(scratch.root, scratch.fakeBin);
	const env = {
		HERDR_ENV: "1",
		LIMEN_HERDR: herdr.bin,
		FAKE_HERDR_STATE: herdr.dir,
		FAKE_HERDR_START_PANE_FAILURES: "2",
		HERDR_TAB_ID: "coord:t0",
	};
	const launched = limenWithEnv(scratch, env, "spawn", "--label", "F044 fail", "do not start");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	const job = join(scratch.root, ".limen/jobs", id);
	await waitForState(scratch.root, id, "failed");
	assert.equal((await readFile(join(job, "state"), "utf8")).trim(), "failed");
	await waitForFile(join(job, "log"), /failed: hosted start failed: agent target pane w1:p1 is not an available shell/);
	assert.equal([...(await readFile(herdr.calls, "utf8")).matchAll(/^agent start /gm)].length, 2);
});

test("hosted start does not retry a non-pane-shell error", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const herdr = await installHostedFakeHerdr(scratch.root, scratch.fakeBin);
	const env = {
		HERDR_ENV: "1",
		LIMEN_HERDR: herdr.bin,
		FAKE_HERDR_STATE: herdr.dir,
		FAKE_HERDR_START_ERROR: "1",
		HERDR_TAB_ID: "coord:t0",
	};
	const launched = limenWithEnv(scratch, env, "spawn", "--label", "F044 auth", "do not start");
	assert.equal(launched.status, 0, launched.stderr);
	await waitForState(scratch.root, onlyJobId(launched.stdout), "failed");
	assert.equal([...(await readFile(herdr.calls, "utf8")).matchAll(/^agent start /gm)].length, 1);
});

test("hosted supervisor writes one idle advisory and stays running", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const herdr = await installHostedFakeHerdr(scratch.root, scratch.fakeBin);
	const env = {
		HERDR_ENV: "1",
		LIMEN_HERDR: herdr.bin,
		FAKE_HERDR_STATE: herdr.dir,
		FAKE_HERDR_PERSIST: "1",
		HERDR_TAB_ID: "coord:t0",
		LIMEN_HOSTED_IDLE_MS: "200",
	};
	const launched = limenWithEnv(scratch, env, "spawn", "--label", "F027 idle", "stay hosted");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	const job = join(scratch.root, ".limen/jobs", id);
	await new Promise((resolve) => setTimeout(resolve, 2_500));
	await assert.rejects(readFile(join(job, "advisory")), "zero tool calls must not advisory");
	assert.equal((await readFile(join(job, "state"), "utf8")).trim(), "running");
	await mkdir(join(job, "session"), { recursive: true });
	const entries = [
		JSON.stringify({ type: "session", version: 3 }),
		JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "early note" }] } }),
		JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "hosted stall summary" }] } }),
	];
	await writeFile(join(job, "session/2026-01-01T00-00-00-000Z_abc.jsonl"), `${entries.join("\n")}\n`);
	const worktree = (await readFile(join(job, "worktree"), "utf8")).trim();
	await writeFile(join(worktree, "stall.txt"), "done\n");
	git(worktree, "add", "stall.txt");
	git(worktree, "commit", "-m", "stall work");
	await writeFile(join(worktree, "dirty.txt"), "left behind\n");
	await writeFile(join(job, "tool-calls"), "14\n");
	await writeFile(join(job, "activity"), "wait\n");
	const deadline = Date.now() + 5_000;
	let advisory = "";
	while (Date.now() < deadline) {
		advisory = await readFile(join(job, "advisory"), "utf8").then(
			(value) => value.trim(),
			() => "",
		);
		if (advisory) break;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	assert.match(advisory, /idle \d+s after 14 tool calls, session still open/);
	assert.equal(await readFile(join(job, "result"), "utf8"), "hosted stall summary\n");
	assert.match(await readFile(join(job, "commits"), "utf8"), /stall work/);
	await assert.rejects(readFile(join(job, "finished-at")), "stall must not finalize");
	assert.equal((await readFile(join(job, "state"), "utf8")).trim(), "running");
	await new Promise((resolve) => setTimeout(resolve, 1_500));
	assert.equal((await readFile(join(job, "advisory"), "utf8")).trim(), advisory, "same stall must not rewrite");
	await writeFile(join(job, "session-ended"), `${new Date().toISOString()}\n`);
	await waitForState(scratch.root, id, "done");
});

test("hosted supervisor finalizes a clean tool-using idle without claiming the session ended", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const herdr = await installHostedFakeHerdr(scratch.root, scratch.fakeBin);
	const env = {
		HERDR_ENV: "1",
		LIMEN_HERDR: herdr.bin,
		FAKE_HERDR_STATE: herdr.dir,
		FAKE_HERDR_PERSIST: "1",
		HERDR_TAB_ID: "coord:t0",
		LIMEN_HOSTED_IDLE_MS: "200",
	};
	const launched = limenWithEnv(scratch, env, "spawn", "--label", "F065 idle", "finish the work");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	const job = join(scratch.root, ".limen/jobs", id);
	await waitForFile(join(job, "herdr/agent"), /./);
	await mkdir(join(job, "session"), { recursive: true });
	await writeFile(
		join(job, "session/2026-01-01T00-00-00-000Z_abc.jsonl"),
		`${JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "hosted idle handoff" }] } })}\n`,
	);
	await writeFile(join(job, "tool-calls"), "4\n");
	await writeFile(join(job, "last-turn-tools"), "4\n");
	await writeFile(join(job, "activity"), "wait\n");
	await waitForState(scratch.root, id, "done");
	const log = await readFile(join(job, "log"), "utf8");
	assert.match(log, /done: closed a clean idle session/);
	assert.doesNotMatch(log, /hosted session ended/);
	assert.equal(await readFile(join(job, "result"), "utf8"), "hosted idle handoff\n");
	await assert.rejects(readFile(join(job, "advisory")), "a clean tool-using idle must not write an advisory");
});

test("spawn --role opens that Herdr space and a second spawn reuses it", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	await writeFile(join(scratch.root, ".agents/limen/researcher.md"), "RESEARCH PREAMBLE\n");
	const herdr = await installHostedFakeHerdr(scratch.root, scratch.fakeBin);
	const env = { HERDR_ENV: "1", LIMEN_HERDR: herdr.bin, FAKE_HERDR_STATE: herdr.dir };
	const first = limenWithEnv(scratch, env, "spawn", "--detached", "--role", "researcher", "--label", "F069 role", "look around");
	assert.equal(first.status, 0, first.stderr);
	const id = onlyJobId(first.stdout);
	await waitForState(scratch.root, id, "done");
	assert.equal(await readFile(join(scratch.root, ".limen/jobs", id, "role"), "utf8"), "researcher\n");
	const second = limenWithEnv(scratch, env, "spawn", "--detached", "--role", "researcher", "--label", "F069 role 2", "look again");
	assert.equal(second.status, 0, second.stderr);
	await waitForState(scratch.root, onlyJobId(second.stdout), "done");
	const calls = await readFile(herdr.calls, "utf8");
	assert.match(calls, /workspace create .*--label repo researchers/);
	assert.equal([...calls.matchAll(/^workspace create /gm)].length, 1);
});

test("spawn --review in Herdr is hosted; --detached keeps a watch tab", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const worker = onlyJobId(limen(scratch, "spawn", "make commit").stdout);
	await waitForState(scratch.root, worker, "done");
	const branch = `limen/${worker}`;
	const herdr = await installHostedFakeHerdr(scratch.root, scratch.fakeBin);
	const env = { HERDR_ENV: "1", LIMEN_HERDR: herdr.bin, FAKE_HERDR_STATE: herdr.dir, HERDR_TAB_ID: "coord:t0" };
	const hosted = limenWithEnv(scratch, env, "spawn", "--review", "--branch", branch, "--label", "F029 review", "inspect candidate");
	assert.equal(hosted.status, 0, hosted.stderr);
	assert.match(hosted.stdout, /started F029 review \(hosted\)/);
	const hostedId = onlyJobId(hosted.stdout);
	const hostedJob = join(scratch.root, ".limen/jobs", hostedId);
	assert.match(await readFile(join(hostedJob, "hosted"), "utf8"), /weaker guarantees/);
	assert.equal(await readFile(join(hostedJob, "herdr/mode"), "utf8"), "hosted\n");
	assert.equal(await waitForFile(join(hostedJob, "herdr/agent"), /w1:p1/), "w1:p1\n");
	const hostedCalls = await readFile(herdr.calls, "utf8");
	assert.match(hostedCalls, /workspace create .*--label repo reviewers/);
	assert.match(hostedCalls, /--kind pi/);
	assert.doesNotMatch(hostedCalls, /pane run .*tail/);
	const hostedTree = git(scratch.root, "worktree", "list", "--porcelain")
		.split("\n\n")
		.find((block) => block.includes(hostedId));
	assert.match(hostedTree ?? "", /detached/);
	await waitForState(scratch.root, hostedId, "done");
	const tabbed = limenWithEnv(scratch, env, "spawn", "--tab", "--review", "--branch", branch, "--label", "F029 tab review", "inspect candidate");
	assert.equal(tabbed.status, 0, tabbed.stderr);
	assert.match(tabbed.stdout, /started F029 tab review \(hosted\)/);
	const tabbedId = onlyJobId(tabbed.stdout);
	assert.match(await readFile(join(scratch.root, ".limen/jobs", tabbedId, "hosted"), "utf8"), /weaker guarantees/);
	await waitForState(scratch.root, tabbedId, "done");
	const detached = limenWithEnv(scratch, env, "spawn", "--review", "--detached", "--branch", branch, "--label", "F029 detached review", "inspect candidate");
	assert.equal(detached.status, 0, detached.stderr);
	assert.doesNotMatch(detached.stdout, /\(hosted\)/);
	const detachedId = onlyJobId(detached.stdout);
	await waitForState(scratch.root, detachedId, "done");
	await assert.rejects(readFile(join(scratch.root, ".limen/jobs", detachedId, "hosted")));
	assert.equal(await readFile(join(scratch.root, ".limen/jobs", detachedId, "herdr/mode"), "utf8"), "watch\n");
});

test("a hosted job finalizes on session end, never on unseen idle after tools", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const herdr = await installHostedFakeHerdr(scratch.root, scratch.fakeBin);
	const env = { HERDR_ENV: "1", LIMEN_HERDR: herdr.bin, FAKE_HERDR_STATE: herdr.dir, FAKE_HERDR_PERSIST: "1", HERDR_TAB_ID: "coord:t0" };
	const launched = limenWithEnv(scratch, env, "spawn", "--label", "F017 hosted end", "work then idle");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	const job = join(scratch.root, ".limen/jobs", id);
	// Idle after tools must not finish the job: the F015 regression was `done` at 90s while the session kept working.
	await writeFile(join(job, "tool-calls"), "5\n");
	await new Promise((resolve) => setTimeout(resolve, 3_000));
	assert.equal((await readFile(join(job, "state"), "utf8")).trim(), "running", "unseen idle after tools must not read done");
	// The hosted hook (hook/hosted.ts) writes session-ended at pi session_shutdown; the supervisor then captures the result and finalizes.
	await mkdir(join(job, "session"), { recursive: true });
	const entries = [
		JSON.stringify({ type: "session", version: 3 }),
		JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "early note" }] } }),
		JSON.stringify({ type: "message", message: { role: "toolResult", content: [{ type: "text", text: "tool output" }] } }),
		JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "hosted final summary" }] } }),
	];
	await writeFile(join(job, "session/2026-01-01T00-00-00-000Z_abc.jsonl"), `${entries.join("\n")}\n`);
	await writeFile(join(job, "session-ended"), `${new Date().toISOString()}\n`);
	await waitForState(scratch.root, id, "done");
	assert.match(await waitForFile(join(job, "log"), /hosted session ended/), /hosted session ended/);
	assert.equal(await readFile(join(job, "result"), "utf8"), "hosted final summary\n");
	await assert.rejects(readFile(join(job, "stop-reason")), "a clean hosted session writes no stop-reason");
});

test("a hosted session error fails with its stop reason", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const herdr = await installHostedFakeHerdr(scratch.root, scratch.fakeBin);
	const env = { HERDR_ENV: "1", LIMEN_HERDR: herdr.bin, FAKE_HERDR_STATE: herdr.dir, FAKE_HERDR_PERSIST: "1", HERDR_TAB_ID: "coord:t0" };
	const launched = limenWithEnv(scratch, env, "spawn", "--label", "F024 hosted error", "work then die");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	const job = join(scratch.root, ".limen/jobs", id);
	await mkdir(join(job, "session"), { recursive: true });
	await writeFile(
		join(job, "session/2026-01-01T00-00-00-000Z_abc.jsonl"),
		`${JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "early" }], stopReason: "stop" } })}\n${JSON.stringify({ type: "message", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "usage limit reached" } })}\n`,
	);
	await writeFile(join(job, "session-ended"), `${new Date().toISOString()}\n`);
	await waitForState(scratch.root, id, "failed");
	assert.equal(await readFile(join(job, "stop-reason"), "utf8"), "error: usage limit reached\n");
	assert.equal((await readFile(join(job, "state"), "utf8")).trim(), "failed");
	await waitForFile(join(job, "log"), /failed: error: usage limit reached/);
});

test("supervisor does not stamp wait over a hook tool write", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const herdr = await installHostedFakeHerdr(scratch.root, scratch.fakeBin);
	const env = { HERDR_ENV: "1", LIMEN_HERDR: herdr.bin, FAKE_HERDR_STATE: herdr.dir, FAKE_HERDR_PERSIST: "1", HERDR_TAB_ID: "coord:t0" };
	const launched = limenWithEnv(scratch, env, "spawn", "--label", "F020 activity", "stay hosted");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	const job = join(scratch.root, ".limen/jobs", id);
	await writeFile(join(job, "activity"), "tool\n");
	await new Promise((resolve) => setTimeout(resolve, 1_500));
	assert.equal(await readFile(join(job, "activity"), "utf8"), "tool\n");
	assert.equal((await readFile(join(job, "state"), "utf8")).trim(), "running");
	await writeFile(join(job, "session-ended"), `${new Date().toISOString()}\n`);
	await waitForState(scratch.root, id, "done");
});

test("one failed agent get between good samples does not finalize", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const herdr = await installHostedFakeHerdr(scratch.root, scratch.fakeBin);
	const env = {
		HERDR_ENV: "1",
		LIMEN_HERDR: herdr.bin,
		FAKE_HERDR_STATE: herdr.dir,
		FAKE_HERDR_PERSIST: "1",
		FAKE_HERDR_BLIP: "1",
		HERDR_TAB_ID: "coord:t0",
	};
	const launched = limenWithEnv(scratch, env, "spawn", "--label", "F020 blip", "stay hosted");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	const job = join(scratch.root, ".limen/jobs", id);
	await new Promise((resolve) => setTimeout(resolve, 4_000));
	assert.equal((await readFile(join(job, "state"), "utf8")).trim(), "running", "one timeout between idle samples must not finalize");
	assert.match(await readFile(join(job, "log"), "utf8"), /herdr agent get failed: timeout/);
	await writeFile(join(job, "session-ended"), `${new Date().toISOString()}\n`);
	await waitForState(scratch.root, id, "done");
});

test("garbage agent get never counts toward missing", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const herdr = await installHostedFakeHerdr(scratch.root, scratch.fakeBin);
	const env = {
		HERDR_ENV: "1",
		LIMEN_HERDR: herdr.bin,
		FAKE_HERDR_STATE: herdr.dir,
		FAKE_HERDR_PERSIST: "1",
		FAKE_HERDR_GARBAGE: "1",
		HERDR_TAB_ID: "coord:t0",
	};
	const launched = limenWithEnv(scratch, env, "spawn", "--label", "F020 garbage", "stay hosted");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	const job = join(scratch.root, ".limen/jobs", id);
	await new Promise((resolve) => setTimeout(resolve, 4_000));
	assert.equal((await readFile(join(job, "state"), "utf8")).trim(), "running", "garbage CLI output must not finalize as vanished");
	await writeFile(join(job, "session-ended"), `${new Date().toISOString()}\n`);
	await waitForState(scratch.root, id, "done");
});

test("continue in Herdr is hosted and passes --continue, not @task", async (context) => {
	const continuing = `#!/usr/bin/env node
const { writeFileSync, mkdirSync } = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "auth") process.exit(1);
const dirIndex = args.indexOf("--session-dir");
if (dirIndex >= 0) {
  mkdirSync(args[dirIndex + 1], { recursive: true });
  writeFileSync(args[dirIndex + 1] + "/session.jsonl", JSON.stringify({ type: "session" }) + "\\n");
}
writeFileSync("pi-args.json", JSON.stringify(args));
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } }));
`;
	const scratch = await scratchRepo(continuing);
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const parent = onlyJobId(limen(scratch, "spawn", "--detached", "--label", "F037 parent", "first slice").stdout);
	await waitForState(scratch.root, parent, "done");
	const herdr = await installHostedFakeHerdr(scratch.root, scratch.fakeBin);
	const env = { HERDR_ENV: "1", LIMEN_HERDR: herdr.bin, FAKE_HERDR_STATE: herdr.dir, HERDR_TAB_ID: "coord:t0" };
	const launched = limenWithEnv(scratch, env, "continue", parent, "now refine the seam");
	assert.equal(launched.status, 0, launched.stderr);
	assert.match(launched.stdout, /\(hosted\)/);
	const id = onlyJobId(launched.stdout);
	const job = join(scratch.root, ".limen/jobs", id);
	assert.match(await readFile(join(job, "hosted"), "utf8"), /weaker guarantees/);
	assert.equal(await readFile(join(job, "continue"), "utf8"), "now refine the seam\n");
	const calls = await waitForFile(herdr.calls, /agent start /);
	assert.match(calls, /agent start /);
	assert.match(calls, /--continue now refine the seam/);
	assert.doesNotMatch(calls, /@/);
	await waitForState(scratch.root, id, "done");
});

test("makeJobId hoists a feature number from anywhere in the label", () => {
	const trailing = makeJobId("inline model setup in chat · F422");
	assert.match(trailing, /^\d{4}-\d{2}-\d{2}-f422-inline-model-setup-in-chat-[0-9a-f]{8}$/);
	assert.match(hostedAgentName(trailing), /^limen-f422-[0-9a-f]{8}$/);
	const leading = makeJobId("F001 implementation");
	assert.match(leading, /^\d{4}-\d{2}-\d{2}-f001-implementation-[0-9a-f]{8}$/);
	assert.match(hostedAgentName(leading), /^limen-f001-[0-9a-f]{8}$/);
	const only = makeJobId("F068");
	assert.match(only, /^\d{4}-\d{2}-\d{2}-f068-[0-9a-f]{8}$/);
	assert.match(hostedAgentName(only), /^limen-f068-[0-9a-f]{8}$/);
});

test("hostedAgentName keeps the hex suffix when the slug is long", () => {
	const a = hostedAgentName("2026-08-19-abcdefghijklmnopqrstuvwxyz-aaaaaaaa");
	const b = hostedAgentName("2026-08-19-abcdefghijklmnopqrstuvwxyz-bbbbbbbb");
	assert.equal(a, "limen-abcdefghijklmnopq-aaaaaaaa");
	assert.equal(b, "limen-abcdefghijklmnopq-bbbbbbbb");
	assert.equal(a.length, 32);
	assert.notEqual(a, b);
});

test("startHostedPi recovery does not adopt another pane by name", async () => {
	await withFakeHerdr(
		`const args = process.argv.slice(2);
const ok = (result) => console.log(JSON.stringify({ result }));
const fail = (code, message) => { console.log(JSON.stringify({ error: { code, message } })); process.exit(1); };
if (args[0] === "pane" && args[1] === "process-info") {
  ok({ type: "pane_process_info", process_info: { foreground_process_group_id: 1, shell_pid: 1, foreground_processes: [{ name: "zsh", pid: 1 }] } });
} else if (args[0] === "tab" && args[1] === "focus") {
  ok({ type: "tab_focused" });
} else if (args[0] === "agent" && args[1] === "start") {
  fail("agent_already_exists", "name taken");
} else if (args[0] === "agent" && args[1] === "get") {
  fail("agent_not_found", "missing");
} else if (args[0] === "agent" && args[1] === "list") {
  ok({ type: "agent_list", agents: [{ name: "limen-same", pane_id: "other:p0", agent_status: "working" }] });
} else process.exit(1);
`,
		() => {
			assert.throws(() => startHostedPi({ place: { workspace: "w1", tab: "w1:t1", pane: "w1:p1", mode: "hosted" }, name: "limen-same", args: ["--approve"] }));
		},
	);
});

test("spawn --tab --timeout errors before creating a job", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const refused = limen(scratch, "spawn", "--tab", "--timeout", "20m", "do work");
	assert.equal(refused.status, 1);
	assert.match(refused.stderr, /hosted jobs have no timeout/);
	assert.deepEqual(await readdir(join(scratch.root, ".limen/jobs")), []);
});

test("hosted stop before pi starts finalizes with the requested reason", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const herdr = await installHostedFakeHerdr(scratch.root, scratch.fakeBin);
	const env = {
		HERDR_ENV: "1",
		LIMEN_HERDR: herdr.bin,
		FAKE_HERDR_STATE: herdr.dir,
		FAKE_HERDR_SHELL_BUSY_MS: "6000",
		HERDR_TAB_ID: "coord:t0",
	};
	const launched = limenWithEnv(scratch, env, "spawn", "--label", "F048 early stop", "do not start");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	const job = join(scratch.root, ".limen/jobs", id);
	await waitForFile(join(herdr.dir, "shell-busy"), /\d+/);
	assert.doesNotMatch(await readFile(herdr.calls, "utf8"), /agent start /);
	const stopped = limenWithEnv(scratch, env, "stop", id, "cancel during start");
	assert.equal(stopped.status, 0, stopped.stderr);
	await waitForState(scratch.root, id, "stopped");
	await waitForFile(join(job, "log"), /stopped: cancel during start/);
	assert.doesNotMatch(await readFile(herdr.calls, "utf8"), /agent start /);
});

test("hosted stop while agent start resolves stops the appeared worker", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const herdr = await installHostedFakeHerdr(scratch.root, scratch.fakeBin);
	const env = {
		HERDR_ENV: "1",
		LIMEN_HERDR: herdr.bin,
		FAKE_HERDR_STATE: herdr.dir,
		FAKE_HERDR_PERSIST: "1",
		FAKE_HERDR_START_BUSY_MS: "8000",
		HERDR_TAB_ID: "coord:t0",
	};
	const launched = limenWithEnv(scratch, env, "spawn", "--label", "F048 resolving stop", "do not strand");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	const job = join(scratch.root, ".limen/jobs", id);
	await waitForFile(join(herdr.dir, "start-busy"), /\d+/);
	const stopped = limenWithEnv(scratch, env, "stop", id, "cancel resolving start");
	assert.equal(stopped.status, 0, stopped.stderr);
	await waitForState(scratch.root, id, "stopped");
	assert.equal(await readFile(join(job, "stop-requested"), "utf8"), "cancel resolving start\n");
	assert.equal([...(await readFile(herdr.calls, "utf8")).matchAll(/agent send-keys \S+ ctrl\+c/g)].length, 2);
});

test("hosted stop records stopped after two interrupts", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const herdr = await installHostedFakeHerdr(scratch.root, scratch.fakeBin);
	const env = { HERDR_ENV: "1", LIMEN_HERDR: herdr.bin, FAKE_HERDR_STATE: herdr.dir, FAKE_HERDR_PERSIST: "1", HERDR_TAB_ID: "coord:t0" };
	const launched = limenWithEnv(scratch, env, "spawn", "--label", "F021 stop", "stay hosted");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	const job = join(scratch.root, ".limen/jobs", id);
	await waitForFile(join(job, "herdr/agent"), /w1:p1/);
	const stopped = limenWithEnv(scratch, env, "stop", id, "please stop");
	assert.equal(stopped.status, 0, stopped.stderr);
	await waitForState(scratch.root, id, "stopped");
	assert.equal((await readFile(join(job, "stop-requested"), "utf8")).trim(), "please stop");
	await waitForFile(join(job, "log"), /stopped: please stop/);
	assert.equal([...(await readFile(herdr.calls, "utf8")).matchAll(/agent send-keys \S+ ctrl\+c/g)].length, 2);
});

test("hosted stop with a done: reason records done", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const herdr = await installHostedFakeHerdr(scratch.root, scratch.fakeBin);
	const env = { HERDR_ENV: "1", LIMEN_HERDR: herdr.bin, FAKE_HERDR_STATE: herdr.dir, FAKE_HERDR_PERSIST: "1", HERDR_TAB_ID: "coord:t0", PI_SESSION_ID: "coordinator-a" };
	const launched = limenWithEnv(scratch, env, "spawn", "--label", "F055 done stop", "stay hosted");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	const job = join(scratch.root, ".limen/jobs", id);
	await waitForFile(join(job, "herdr/agent"), /w1:p1/);
	const stopped = limenWithEnv(scratch, env, "stop", id, "done: merged as abc123");
	assert.equal(stopped.status, 0, stopped.stderr);
	await waitForState(scratch.root, id, "done");
	assert.match(await readFile(join(job, "log"), "utf8"), /done: done: merged as abc123/);
	assert.ok((await readdir(join(job, "notify/delivered"))).includes("coordinator-a"));
});

test("hosted stop leaves running when the agent ignores interrupts", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const herdr = await installHostedFakeHerdr(scratch.root, scratch.fakeBin);
	const env = {
		HERDR_ENV: "1",
		LIMEN_HERDR: herdr.bin,
		FAKE_HERDR_STATE: herdr.dir,
		FAKE_HERDR_PERSIST: "1",
		FAKE_HERDR_STUBBORN: "1",
		HERDR_TAB_ID: "coord:t0",
		LIMEN_HOSTED_STOP_WAIT_MS: "400",
	};
	const launched = limenWithEnv(scratch, env, "spawn", "--label", "F021 stubborn", "stay hosted");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	const job = join(scratch.root, ".limen/jobs", id);
	await waitForFile(join(job, "herdr/agent"), /w1:p1/);
	const stopped = limenWithEnv(scratch, env, "stop", id, "please stop");
	assert.equal(stopped.status, 1, stopped.stdout);
	assert.match(stopped.stderr, /agent is still up; closing the tab ends it/);
	assert.equal((await readFile(join(job, "state"), "utf8")).trim(), "running");
	assert.equal((await readFile(join(job, "stop-requested"), "utf8")).trim(), "please stop");
	assert.match(await readFile(join(job, "log"), "utf8"), /stop requested: please stop/);
	await writeFile(join(job, "session-ended"), `${new Date().toISOString()}\n`);
	await waitForState(scratch.root, id, "stopped");
});

test("hosted stop finalizes when the supervisor is gone and the agent is missing", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const herdr = await installHostedFakeHerdr(scratch.root, scratch.fakeBin);
	const env = { HERDR_ENV: "1", LIMEN_HERDR: herdr.bin, FAKE_HERDR_STATE: herdr.dir, FAKE_HERDR_PERSIST: "1", HERDR_TAB_ID: "coord:t0" };
	const launched = limenWithEnv(scratch, env, "spawn", "--label", "F021 orphan", "stay hosted");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	const job = join(scratch.root, ".limen/jobs", id);
	await waitForFile(join(job, "herdr/agent"), /w1:p1/);
	const pid = Number((await readFile(join(job, "pid"), "utf8")).trim());
	process.kill(pid, "SIGKILL");
	const goneBy = Date.now() + 2_000;
	while (Date.now() < goneBy) {
		try {
			process.kill(pid, 0);
			await new Promise((resolve) => setTimeout(resolve, 25));
		} catch {
			break;
		}
	}
	const statePath = join(herdr.dir, "state.json");
	const fake = JSON.parse(await readFile(statePath, "utf8")) as { agents: Record<string, unknown> };
	delete fake.agents[(await readFile(join(job, "herdr/agent"), "utf8")).trim()];
	await writeFile(statePath, JSON.stringify(fake));
	const stopped = limenWithEnv(scratch, env, "stop", id, "orphan stop");
	assert.equal(stopped.status, 0, stopped.stderr);
	assert.equal((await readFile(join(job, "state"), "utf8")).trim(), "stopped");
	assert.match(await readFile(join(job, "log"), "utf8"), /stopped: orphan stop/);
});

test("two long hosted labels keep distinct agent names", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const herdr = await installHostedFakeHerdr(scratch.root, scratch.fakeBin);
	const env = { HERDR_ENV: "1", LIMEN_HERDR: herdr.bin, FAKE_HERDR_STATE: herdr.dir, FAKE_HERDR_PERSIST: "1", HERDR_TAB_ID: "coord:t0" };
	const label = "abcdefghijklmnopqrstuvwxyz-long";
	const first = onlyJobId(limenWithEnv(scratch, env, "spawn", "--label", label, "stay hosted").stdout);
	const second = onlyJobId(limenWithEnv(scratch, env, "spawn", "--label", label, "stay hosted").stdout);
	const calls = await waitForFile(herdr.calls, (value) => [...value.matchAll(/agent start (\S+)/g)].length === 2);
	assert.equal([...calls.matchAll(/^workspace create /gm)].length, 1);
	const names = [...calls.matchAll(/agent start (\S+)/g)].map((match) => match[1]);
	assert.equal(names.length, 2);
	assert.notEqual(names[0], names[1]);
	const panes = [first, second].map(async (id) => (await waitForFile(join(scratch.root, ".limen/jobs", id, "herdr/agent"), /w1:p\d+/)).trim());
	const [paneA, paneB] = await Promise.all(panes);
	assert.notEqual(paneA, paneB);
	for (const [id, name] of [
		[first, names[0]],
		[second, names[1]],
	] as const) {
		assert.ok(name && name.length <= 32, name ?? "missing agent name");
		assert.equal(name.slice(-8), id.slice(-8));
		await writeFile(join(scratch.root, ".limen/jobs", id, "session-ended"), `${new Date().toISOString()}\n`);
		await waitForState(scratch.root, id, "done");
	}
});

async function waitForFile(path: string, expected: RegExp | ((value: string) => boolean), timeoutMs = 10_000): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = await readFile(path, "utf8").catch(() => "");
		if (typeof expected === "function" ? expected(value) : expected.test(value)) return value;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`file ${path} did not reach expected content`);
}

async function withFakeHerdr(source: string, run: () => void | Promise<void>): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "limen-herdr-status-"));
	const bin = join(dir, "herdr");
	await writeFile(bin, `#!/usr/bin/env node\n${source}`);
	await chmod(bin, 0o755);
	const previous = process.env.LIMEN_HERDR;
	process.env.LIMEN_HERDR = bin;
	try {
		await run();
	} finally {
		if (previous === undefined) delete process.env.LIMEN_HERDR;
		else process.env.LIMEN_HERDR = previous;
		await rm(dir, { recursive: true, force: true });
	}
}

async function installHostedFakeHerdr(root: string, fakeBin: string): Promise<{ readonly dir: string; readonly bin: string; readonly calls: string }> {
	const dir = join(root, "fake-herdr");
	await mkdir(dir);
	await writeFile(join(dir, "state.json"), JSON.stringify({ tabs: {}, agents: {} }));
	const bin = join(fakeBin, "herdr");
	await writeFile(
		bin,
		`#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
const dir = process.env.FAKE_HERDR_STATE;
appendFileSync(dir + "/calls", args.join(" ") + "\\n");
const path = dir + "/state.json";
const state = JSON.parse(readFileSync(path, "utf8"));
const ok = (result) => console.log(JSON.stringify({ result }));
const fail = (code, message) => { console.log(JSON.stringify({ error: { code, message } })); process.exit(1); };
if (args[0] === "workspace" && args[1] === "list") {
  ok({ type: "workspace_list", workspaces: state.workspace ? [{ label: state.workspaceLabel, workspace_id: state.workspace }] : [] });
} else if (args[0] === "workspace" && args[1] === "create") {
  state.workspace = "w1";
  state.workspaceLabel = args[args.indexOf("--label") + 1];
  writeFileSync(path, JSON.stringify(state));
  ok({ type: "workspace_created", workspace: { workspace_id: "w1" } });
} else if (args[0] === "workspace" && args[1] === "focus") {
  ok({ type: "workspace_focused", workspace: { workspace_id: args[2] } });
} else if (args[0] === "tab" && args[1] === "create") {
  state.n = (state.n || 0) + 1;
  const tab = "w1:t" + state.n;
  const pane = "w1:p" + state.n;
  state.tabs[tab] = { label: args[args.indexOf("--label") + 1], pane };
  writeFileSync(path, JSON.stringify(state));
  ok({ type: "tab_created", tab: { tab_id: tab }, root_pane: { pane_id: pane } });
} else if (args[0] === "tab" && args[1] === "get") {
  const tab = args[2];
  if (!state.tabs[tab]) fail("tab_not_found", "missing");
  ok({ type: "tab_info", tab: { tab_id: tab } });
} else if (args[0] === "tab" && args[1] === "rename") {
  ok({ type: "tab_renamed" });
} else if (args[0] === "tab" && args[1] === "focus") {
  const tab = args[2];
  for (const id of Object.keys(state.tabs)) state.tabs[id].focused = false;
  if (state.tabs[tab]) {
    state.tabs[tab].seen = true;
    state.tabs[tab].focused = true;
  }
  writeFileSync(path, JSON.stringify(state));
  ok({ type: "tab_focused" });
} else if (args[0] === "tab" && args[1] === "close") {
  delete state.tabs[args[2]];
  writeFileSync(path, JSON.stringify(state));
  ok({ type: "tab_closed" });
} else if (args[0] === "pane" && args[1] === "run") {
  ok({ type: "pane_ran" });
} else if (args[0] === "pane" && args[1] === "process-info") {
  const shellBusyMs = Number(process.env.FAKE_HERDR_SHELL_BUSY_MS || 0);
  if (shellBusyMs > 0) {
    writeFileSync(dir + "/shell-busy", String(process.pid));
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, shellBusyMs);
  }
  ok({ type: "pane_process_info", process_info: { foreground_process_group_id: 1, shell_pid: 1, foreground_processes: [{ name: "zsh", pid: 1 }] } });
} else if (args[0] === "agent" && args[1] === "start") {
  const pane = args[args.indexOf("--pane") + 1];
  const tab = Object.keys(state.tabs).find((id) => state.tabs[id].pane === pane);
  state.startAttempts = (state.startAttempts || 0) + 1;
  writeFileSync(path, JSON.stringify(state));
  if (state.startAttempts <= Number(process.env.FAKE_HERDR_START_PANE_FAILURES || 0)) fail("agent_pane_busy", "agent target pane " + pane + " is not an available shell");
  if (process.env.FAKE_HERDR_START_ERROR === "1") fail("auth_failed", "authentication denied");
  if (!tab || !state.tabs[tab].focused) fail("agent_pane_busy", "agent target pane " + pane + " is not an available shell");
  state.agents[pane] = { status: "working", ticks: 0 };
  writeFileSync(path, JSON.stringify(state));
  const busyMs = Number(process.env.FAKE_HERDR_START_BUSY_MS || 0);
  if (busyMs > 0) {
    writeFileSync(dir + "/start-busy", String(process.pid));
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, busyMs);
  }
  ok({ type: "agent_started", pane: { pane_id: pane }, agent_status: "working" });
} else if (args[0] === "agent" && args[1] === "get") {
  const target = args[2];
  const agent = state.agents[target];
  if (!agent) fail("agent_not_found", "missing");
  const info = (status) => ok({ type: "agent_info", agent: { agent_status: status, pane_id: target } });
  if (process.env.FAKE_HERDR_GARBAGE === "1") {
    console.log("not-json");
    process.exit(1);
  }
  if (process.env.FAKE_HERDR_PERSIST === "1") {
    if (process.env.FAKE_HERDR_BLIP === "1") {
      agent.ticks = (agent.ticks || 0) + 1;
      writeFileSync(path, JSON.stringify(state));
      if (agent.ticks === 2) fail("timeout", "herdr timeout");
    }
    // A background tab Herdr never focused reports unseen-idle; the agent stays alive.
    info("idle");
    return;
  }
  agent.ticks = (agent.ticks || 0) + 1;
  if (agent.ticks >= 2) {
    delete state.agents[target];
    writeFileSync(path, JSON.stringify(state));
    fail("agent_not_found", "missing");
  }
  writeFileSync(path, JSON.stringify(state));
  info(agent.status);
} else if (args[0] === "agent" && args[1] === "send-keys") {
  const target = args[2];
  const agent = state.agents[target];
  if (agent && process.env.FAKE_HERDR_STUBBORN !== "1") {
    agent.interrupts = (agent.interrupts || 0) + 1;
    if (agent.interrupts >= 2) delete state.agents[target];
  }
  writeFileSync(path, JSON.stringify(state));
  ok({ type: "keys_sent" });
} else fail("unknown", args.join(" "));
`,
	);
	await chmod(bin, 0o755);
	return { dir, bin, calls: join(dir, "calls") };
}
