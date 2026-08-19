import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { hostedAgentStatus, hostedTerminalReason, stopHostedAgent } from "../src/herdr.ts";
import { limen, limenWithEnv, onlyJobId, scratchRepo, waitForState } from "./scratch.ts";

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
		assert.equal(await readFile(calls, "utf8"), "agent send-keys w1:p1 ctrl+c\n");
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
	assert.equal(await readFile(join(job, "herdr/agent"), "utf8"), "w1:p1\n");
	const calls = await readFile(herdr.calls, "utf8");
	const lines = calls.split("\n");
	const focusNew = lines.findIndex((line) => line === "tab focus w1:t1");
	const start = lines.findIndex((line) => line.startsWith("agent start "));
	const focusCoord = lines.findIndex((line) => line === "tab focus coord:t0");
	assert.match(calls, /tab create /);
	assert.match(calls, /--no-focus/);
	assert.doesNotMatch(calls, /tab create .*--focus/);
	assert.ok(focusNew >= 0 && start > focusNew && focusCoord > start, calls);
	assert.match(calls, /--kind pi/);
	assert.doesNotMatch(calls, /pane run .*tail/);
	await waitForState(scratch.root, id, "done");
	assert.match(await readFile(join(job, "log"), "utf8"), /hosted supervisor started/);
	assert.match(await readFile(join(job, "log"), "utf8"), /hosted agent done|hosted agent ended/);
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
	assert.match(await readFile(join(job, "log"), "utf8"), /hosted session ended/);
	assert.equal(await readFile(join(job, "result"), "utf8"), "hosted final summary\n");
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
  ok({ type: "pane_process_info", process_info: { foreground_process_group_id: 1, shell_pid: 1, foreground_processes: [{ name: "zsh", pid: 1 }] } });
} else if (args[0] === "agent" && args[1] === "start") {
  const pane = args[args.indexOf("--pane") + 1];
  const tab = Object.keys(state.tabs).find((id) => state.tabs[id].pane === pane);
  if (!tab || !state.tabs[tab].focused) fail("agent_pane_busy", "agent target pane " + pane + " is not an available shell");
  state.agents[pane] = { status: "working", ticks: 0 };
  writeFileSync(path, JSON.stringify(state));
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
  if (state.agents[target]) state.agents[target].status = "done";
  writeFileSync(path, JSON.stringify(state));
  ok({ type: "keys_sent" });
} else fail("unknown", args.join(" "));
`,
	);
	await chmod(bin, 0o755);
	return { dir, bin, calls: join(dir, "calls") };
}
