import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { finalizeJob } from "../src/wrapper.ts";
import { limen, limenWithEnv, onlyJobId, type Scratch, scratchRepo, waitForState } from "./scratch.ts";

function wipeScratch(scratch: Scratch): void {
	spawnSync("pkill", ["-9", "-f", `${scratch.fakeBin}/herdr`], { stdio: "ignore" });
	spawnSync("/bin/rm", ["-rf", dirname(scratch.root)], { stdio: "ignore" });
}

const errorPi = `#!/usr/bin/env node
const { execFileSync } = require("node:child_process");
require("node:fs").writeFileSync("partial.txt", "useful work before the error\\n");
execFileSync("git", ["add", "partial.txt"]);
execFileSync("git", ["commit", "-m", "partial before provider error"]);
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "usage limit reached" } }));
`;

const abortedPi = `#!/usr/bin/env node
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [], stopReason: "aborted" } }));
`;

const recoveredPi = `#!/usr/bin/env node
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "temporary" } }));
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [], stopReason: "stop" } }));
`;

const lateSteerPi = `#!/usr/bin/env node
setTimeout(() => {
  console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "finishing" }] } }));
}, 400);
`;

const burstPi = `#!/usr/bin/env node
process.on("SIGTERM", () => process.exit(0));
let n = 0;
setInterval(() => {
  n += 1;
  console.log(JSON.stringify({ type: "tool_execution_start", toolName: "read", args: { path: "file" + n } }));
}, 5);
`;

test("finalizeJob writes state before a hanging rename, once, and sweeps leftovers", async (context) => {
	const scratch = await scratchRepo();
	context.after(() => wipeScratch(scratch));
	limen(scratch, "init");
	const job = join(scratch.root, ".limen/jobs/hang");
	await mkdir(join(job, "herdr"), { recursive: true });
	await mkdir(join(job, "steer/inbox"), { recursive: true });
	await writeFile(join(job, "state"), "running\n");
	await writeFile(join(job, "label"), "hang\n");
	await writeFile(join(job, "branch"), "main\n");
	await writeFile(join(job, "task.md"), "hang\n");
	await writeFile(join(job, "log"), "");
	await writeFile(join(job, "pid"), "1\n");
	await writeFile(join(job, "born"), "1.000000\n");
	await writeFile(join(job, "herdr/workspace"), "w1\n");
	await writeFile(join(job, "herdr/tab"), "w1:t1\n");
	await writeFile(join(job, "herdr/pane"), "w1:p1\n");
	await writeFile(join(job, "herdr/mode"), "watch\n");
	await writeFile(join(job, "state.12345.abc.tmp"), "stale\n");
	await writeFile(join(job, "steer/inbox/0001"), "turn left\n");
	const herdr = join(scratch.fakeBin, "herdr");
	await writeFile(
		herdr,
		`#!/usr/bin/env node
require("node:fs").appendFileSync(${JSON.stringify(join(scratch.root, "herdr-calls"))}, process.argv.slice(2).join(" ") + "\\n");
if (process.argv[2] === "tab" && process.argv[3] === "rename") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
`,
	);
	await chmod(herdr, 0o755);
	const previous = process.env.LIMEN_HERDR;
	process.env.LIMEN_HERDR = herdr;
	context.after(() => {
		if (previous === undefined) delete process.env.LIMEN_HERDR;
		else process.env.LIMEN_HERDR = previous;
	});
	const started = Date.now();
	await finalizeJob(job, "done", "pi exited 0");
	assert.ok(Date.now() - started < 750, "finalize must not wait for the tab close");
	assert.equal(await readFile(join(job, "state"), "utf8"), "done\n");
	const finished = await readFile(join(job, "finished-at"), "utf8");
	await finalizeJob(job, "failed", "second writer");
	assert.equal(await readFile(join(job, "finished-at"), "utf8"), finished);
	assert.equal(await readFile(join(job, "state"), "utf8"), "done\n");
	await assert.rejects(readFile(join(job, "state.12345.abc.tmp")));
	await assert.rejects(readFile(join(job, "pid")));
	await assert.rejects(readFile(join(job, "born")));
	const log = await readFile(join(job, "log"), "utf8");
	assert.match(log, /done: pi exited 0; 1 steer\(s\) never delivered/);
	assert.doesNotMatch(log, /failed: second writer/);
	assert.equal((log.match(/\] (?:done|failed|stopped):/g) ?? []).length, 1);
});

test("a provider-error stream fails with its stop reason and preserves prior commits", async (context) => {
	const scratch = await scratchRepo(errorPi);
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const id = onlyJobId(limen(scratch, "spawn", "hit the limit").stdout);
	await waitForState(scratch.root, id, "failed");
	const job = join(scratch.root, ".limen/jobs", id);
	assert.equal(await readFile(join(job, "stop-reason"), "utf8"), "error: usage limit reached\n");
	assert.equal((await readFile(join(job, "state"), "utf8")).trim(), "failed");
	assert.match(await readFile(join(job, "log"), "utf8"), /failed: error: usage limit reached/);
	assert.match(await readFile(join(job, "commits"), "utf8"), /partial before provider error/);
	const detail = limen(scratch, "jobs", id);
	assert.equal(detail.status, 0, detail.stderr);
	assert.match(detail.stdout, /FAILED .*hit the limit/);
	assert.match(detail.stdout, /stop-reason:\n    error: usage limit reached/);
	assert.match(detail.stdout, /commits:\n.*partial before provider error/s);
});

test("an aborted stream fails with its stop reason", async (context) => {
	const scratch = await scratchRepo(abortedPi);
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const id = onlyJobId(limen(scratch, "spawn", "abort now").stdout);
	await waitForState(scratch.root, id, "failed");
	const job = join(scratch.root, ".limen/jobs", id);
	assert.equal(await readFile(join(job, "stop-reason"), "utf8"), "aborted\n");
	assert.match(await readFile(join(job, "log"), "utf8"), /failed: aborted/);
});

test("a recovered provider error follows the clean final turn", async (context) => {
	const scratch = await scratchRepo(recoveredPi);
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const id = onlyJobId(limen(scratch, "spawn", "recover").stdout);
	await waitForState(scratch.root, id, "done");
	await assert.rejects(readFile(join(scratch.root, ".limen/jobs", id, "stop-reason")));
});

test("a clean run writes no stop-reason", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const id = onlyJobId(limen(scratch, "spawn", "make commit").stdout);
	await waitForState(scratch.root, id, "done");
	await assert.rejects(readFile(join(scratch.root, ".limen/jobs", id, "stop-reason")));
});

test("an unseen steer is counted at finalize", async (context) => {
	const scratch = await scratchRepo(lateSteerPi);
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const id = onlyJobId(limen(scratch, "spawn", "almost done").stdout);
	const job = join(scratch.root, ".limen/jobs", id);
	await mkdir(join(job, "steer/inbox"), { recursive: true });
	await writeFile(join(job, "steer/inbox/0001"), "turn left\n");
	await waitForState(scratch.root, id, "done");
	assert.match(await readFile(join(job, "log"), "utf8"), /1 steer\(s\) never delivered/);
});

test("exhaustion finalizes failed while tab close hangs", async (context) => {
	const scratch = await scratchRepo(burstPi);
	context.after(() => wipeScratch(scratch));
	limen(scratch, "init");
	const herdr = join(scratch.fakeBin, "herdr");
	await writeFile(
		herdr,
		`#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "workspace" && args[1] === "list") console.log(JSON.stringify({ result: { workspaces: [] } }));
else if (args[0] === "workspace" && args[1] === "create") console.log(JSON.stringify({ result: { workspace: { workspace_id: "w1" }, tab: { tab_id: "w1:t1" }, root_pane: { pane_id: "w1:p1" } } }));
else if (args[0] === "tab" && args[1] === "create") console.log(JSON.stringify({ result: { tab: { tab_id: "w1:t2" }, root_pane: { pane_id: "w1:p2" } } }));
else if (args[0] === "tab" && args[1] === "close") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 8000);
else console.log(JSON.stringify({ result: {} }));
`,
	);
	await chmod(herdr, 0o755);
	const launched = limenWithEnv(scratch, { LIMEN_MAX_TOOL_CALLS: "5", HERDR_ENV: "1", LIMEN_HERDR: herdr }, "spawn", "--detached", "loop");
	assert.equal(launched.status, 0, launched.stderr);
	const id = onlyJobId(launched.stdout);
	const started = Date.now();
	await waitForState(scratch.root, id, "failed", 8_000);
	assert.ok(Date.now() - started < 6_000, "failed state must land before a slow rename or the 5s self-SIGKILL");
	assert.match(await readFile(join(scratch.root, `.limen/jobs/${id}/log`), "utf8"), /tool-call cap reached after \d+ calls/);
});

test("limen stop leaves one finished-at and one terminal state line", async (context) => {
	const waiting = `#!/usr/bin/env node
process.on("SIGTERM", () => {});
console.log("waiting");
setInterval(() => {}, 1000);
`;
	const scratch = await scratchRepo(waiting);
	context.after(scratch.cleanup);
	limen(scratch, "init");
	const id = onlyJobId(limen(scratch, "spawn", "wait").stdout);
	const job = join(scratch.root, ".limen/jobs", id);
	const stopped = limen(scratch, "stop", id, "one writer");
	assert.equal(stopped.status, 0, stopped.stderr);
	await waitForState(scratch.root, id, "stopped");
	const finished = await readFile(join(job, "finished-at"), "utf8");
	assert.ok(Number.isFinite(Date.parse(finished.trim())));
	assert.equal((await readFile(join(job, "finished-at"), "utf8")).trim(), finished.trim());
	assert.equal((await readFile(join(job, "log"), "utf8")).match(/\] (?:done|failed|stopped):/g)?.length, 1);
});
