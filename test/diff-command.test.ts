import assert from "node:assert/strict";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { git, limen, limenWithEnv, onlyJobId, scratchRepo, waitForState } from "./scratch.ts";

test("diff resolves a pruned job and prints its exact recorded changeset", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const id = onlyJobId(limen(scratch, "spawn", "--label", "F050 fallback", "make commit").stdout);
	await waitForState(scratch.root, id, "done");
	assert.equal(limen(scratch, "prune").status, 0);
	const job = join(scratch.root, ".limen/jobs", id);
	const base = (await readFile(join(job, "base"), "utf8")).trim();
	const branch = (await readFile(join(job, "branch"), "utf8")).trim();
	assert.equal(git(scratch.root, "worktree", "list").includes(id), false);

	const shown = limen(scratch, "diff", "F050 fallback");
	assert.equal(shown.status, 0, shown.stderr);
	assert.equal(shown.stdout, `git diff ${base}...${branch}\n`);
});

test("diff does not launch hunk without a TTY and fresh jobs record its version", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const calls = join(scratch.root, "hunk-calls");
	const hunk = join(scratch.fakeBin, "hunk");
	await writeFile(
		hunk,
		`#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv[2] === "--version") console.log("0.20.0-test");
else fs.appendFileSync(${JSON.stringify(calls)}, process.argv.slice(2).join(" ") + "\\n");
`,
	);
	await chmod(hunk, 0o755);
	const env = { LIMEN_HUNK: hunk };
	const id = onlyJobId(limenWithEnv(scratch, env, "spawn", "--label", "F050 no tty", "make commit").stdout);
	await waitForState(scratch.root, id, "done");
	const job = join(scratch.root, ".limen/jobs", id);
	assert.match(await readFile(join(job, "versions"), "utf8"), /^pi 0\.0\.0-test\nhunk 0\.20\.0-test\n$/);

	const shown = limenWithEnv(scratch, env, "diff", id.slice(-8));
	assert.equal(shown.status, 0, shown.stderr);
	assert.match(shown.stdout, /^git diff \S+\.\.\.\S+\n$/);
	await assert.rejects(readFile(calls));
});

test("diff opens one Herdr review tab, focuses it again, and close sweeps it", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const hunk = join(scratch.fakeBin, "hunk");
	await writeFile(hunk, "#!/usr/bin/env node\nif (process.argv[2] === '--version') console.log('0.20.0-test');\n");
	await chmod(hunk, 0o755);
	const id = onlyJobId(limenWithEnv(scratch, { LIMEN_HUNK: hunk }, "spawn", "--label", "F050 review", "make commit").stdout);
	await waitForState(scratch.root, id, "done");
	assert.equal(limen(scratch, "prune").status, 0);
	const job = join(scratch.root, ".limen/jobs", id);
	const base = (await readFile(join(job, "base"), "utf8")).trim();
	const branch = (await readFile(join(job, "branch"), "utf8")).trim();
	const herdr = await installReviewHerdr(scratch.root, scratch.fakeBin);
	const env = { HERDR_ENV: "1", LIMEN_HERDR: herdr.bin, LIMEN_HUNK: hunk, FAKE_HERDR_STATE: herdr.dir };

	const opened = limenWithEnv(scratch, env, "diff", "F050 review");
	assert.equal(opened.status, 0, opened.stderr);
	assert.match(opened.stdout, /opened F050 review diff/);
	assert.match(await readFile(herdr.calls, "utf8"), /workspace create .*--label repo workers/);
	assert.equal(await readFile(join(job, "herdr/diff/mode"), "utf8"), "diff\n");
	assert.equal(await readFile(join(job, "herdr/diff/tab"), "utf8"), "w1:t1\n");
	let calls = await readFile(herdr.calls, "utf8");
	assert.match(calls, new RegExp(`pane run w1:p1 ${escapeRegExp(hunk)} diff ${base}\\.\\.\\.${escapeRegExp(branch)}`));

	const focused = limenWithEnv(scratch, env, "diff", id);
	assert.match(focused.stdout, /focused F050 review diff/);
	calls = await readFile(herdr.calls, "utf8");
	assert.equal([...calls.matchAll(/^tab create /gm)].length, 1);
	assert.equal([...calls.matchAll(/^pane run /gm)].length, 1);
	assert.match(calls, /tab focus w1:t1/);

	await mkdir(join(scratch.root, "spec/features/done/2026-09/F050-hunk-diff-tab"), { recursive: true });
	const closed = limenWithEnv(scratch, env, "close", "F050");
	assert.equal(closed.status, 0, closed.stderr);
	assert.match(closed.stdout, /closed 1 leftover tab for F050/);
	assert.match(await readFile(herdr.calls, "utf8"), /tab close w1:t1/);
});

test("diff watches a running job from its live worktree without touching the job", async (context) => {
	const scratch = await scratchRepo(`#!/usr/bin/env node
process.on("SIGTERM", () => process.exit(0));
setInterval(() => {}, 1000);
`);
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const hunk = join(scratch.fakeBin, "hunk");
	await writeFile(hunk, "#!/usr/bin/env node\nif (process.argv[2] === '--version') console.log('0.20.0-test');\n");
	await chmod(hunk, 0o755);
	const id = onlyJobId(limenWithEnv(scratch, { LIMEN_HUNK: hunk }, "spawn", "--label", "F050 live", "long work").stdout);
	const job = join(scratch.root, ".limen/jobs", id);
	const base = (await readFile(join(job, "base"), "utf8")).trim();
	const worktree = (await readFile(join(job, "worktree"), "utf8")).trim();
	const herdr = await installReviewHerdr(scratch.root, scratch.fakeBin);
	const env = { HERDR_ENV: "1", LIMEN_HERDR: herdr.bin, LIMEN_HUNK: hunk, FAKE_HERDR_STATE: herdr.dir };

	const opened = limenWithEnv(scratch, env, "diff", id.slice(-8));
	assert.equal(opened.status, 0, opened.stderr);
	const calls = await readFile(herdr.calls, "utf8");
	assert.match(calls, new RegExp(`tab create .*--cwd ${escapeRegExp(worktree)}`));
	assert.match(calls, new RegExp(`pane run w1:p1 ${escapeRegExp(hunk)} diff ${base} --watch`));
	assert.equal((await readFile(join(job, "state"), "utf8")).trim(), "running");
	limen(scratch, "stop", id, "test cleanup");
	await waitForState(scratch.root, id, "stopped");
});

test("diff requires one job selector", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	assert.match(limen(scratch, "diff").stderr, /diff requires exactly one job id/);
	assert.match(limen(scratch, "diff", "one", "two").stderr, /diff requires exactly one job id/);
});

async function installReviewHerdr(root: string, fakeBin: string): Promise<{ readonly dir: string; readonly bin: string; readonly calls: string }> {
	const dir = join(root, "fake-herdr");
	await mkdir(dir);
	await writeFile(join(dir, "state.json"), JSON.stringify({ tabs: {}, n: 0 }));
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
const fail = (message) => { console.log(JSON.stringify({ error: { code: "missing", message } })); process.exit(1); };
if (args[0] === "workspace" && args[1] === "list") ok({ workspaces: state.workspace ? [{ label: state.label, workspace_id: "w1" }] : [] });
else if (args[0] === "workspace" && args[1] === "create") {
  state.workspace = true; state.label = args[args.indexOf("--label") + 1]; writeFileSync(path, JSON.stringify(state));
  ok({ workspace: { workspace_id: "w1" } });
} else if (args[0] === "tab" && args[1] === "create") {
  state.n += 1; const tab = "w1:t" + state.n; const pane = "w1:p" + state.n; state.tabs[tab] = { pane }; writeFileSync(path, JSON.stringify(state));
  ok({ tab: { tab_id: tab }, root_pane: { pane_id: pane } });
} else if (args[0] === "tab" && args[1] === "get") {
  if (!state.tabs[args[2]]) fail("tab not found"); else ok({ tab: { tab_id: args[2] } });
} else if (args[0] === "tab" && args[1] === "focus") ok({ tab: { tab_id: args[2] } });
else if (args[0] === "tab" && args[1] === "close") { delete state.tabs[args[2]]; writeFileSync(path, JSON.stringify(state)); ok({}); }
else if (args[0] === "pane" && args[1] === "run") ok({});
else fail("unexpected call");
`,
	);
	await chmod(bin, 0o755);
	return { dir, bin, calls: join(dir, "calls") };
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
