import assert from "node:assert/strict";
import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { limen, limenWithEnv, onlyJobId, scratchRepo, waitForState } from "./scratch.ts";

test("spawn --tab refuses without Herdr and leaves no job record", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const refused = limen(scratch, "spawn", "--tab", "--label", "F010 noherdr", "do work");
	assert.equal(refused.status, 1);
	assert.match(refused.stderr, /hosted spawn requires Herdr/);
	assert.deepEqual(await readdir(join(scratch.root, ".limen/jobs")), []);
});

test("spawn --tab starts a hosted agent in a shell tab", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.equal(limen(scratch, "init").status, 0);
	const herdr = await installHostedFakeHerdr(scratch.root, scratch.fakeBin);
	const env = { HERDR_ENV: "1", LIMEN_HERDR: herdr.bin, FAKE_HERDR_STATE: herdr.dir };
	const launched = limenWithEnv(scratch, env, "spawn", "--tab", "--label", "F010 hosted", "make a tiny commit");
	assert.equal(launched.status, 0, launched.stderr);
	assert.match(launched.stdout, /started F010 hosted \(hosted\)/);
	const id = onlyJobId(launched.stdout);
	const job = join(scratch.root, ".limen/jobs", id);
	assert.match(await readFile(join(job, "hosted"), "utf8"), /weaker guarantees/);
	assert.equal(await readFile(join(job, "herdr/mode"), "utf8"), "hosted\n");
	assert.equal(await readFile(join(job, "herdr/agent"), "utf8"), "w1:p1\n");
	const calls = await readFile(herdr.calls, "utf8");
	assert.match(calls, /tab create /);
	assert.match(calls, /agent start /);
	assert.match(calls, /--kind pi/);
	assert.doesNotMatch(calls, /pane run .*tail/);
	await waitForState(scratch.root, id, "done");
	assert.match(await readFile(join(job, "log"), "utf8"), /hosted supervisor started/);
	assert.match(await readFile(join(job, "log"), "utf8"), /hosted agent done|hosted agent ended/);
});

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
  ok({ type: "tab_focused" });
} else if (args[0] === "tab" && args[1] === "close") {
  delete state.tabs[args[2]];
  writeFileSync(path, JSON.stringify(state));
  ok({ type: "tab_closed" });
} else if (args[0] === "pane" && args[1] === "run") {
  ok({ type: "pane_ran" });
} else if (args[0] === "agent" && args[1] === "start") {
  const pane = args[args.indexOf("--pane") + 1];
  state.agents[pane] = { status: "working", ticks: 0 };
  writeFileSync(path, JSON.stringify(state));
  ok({ type: "agent_started", pane: { pane_id: pane }, agent_status: "working" });
} else if (args[0] === "agent" && args[1] === "get") {
  const target = args[2];
  const agent = state.agents[target];
  if (!agent) fail("agent_not_found", "missing");
  agent.ticks = (agent.ticks || 0) + 1;
  if (agent.ticks >= 2) agent.status = "done";
  writeFileSync(path, JSON.stringify(state));
  ok({ type: "agent_info", agent_status: agent.status, pane_id: target });
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
