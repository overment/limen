import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmod, copyFile, cp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { finishWebhookEnv } from "../src/finish-webhook.ts";
import { git, onlyJobId, scratchRepo, waitForState } from "./scratch.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const sender = `#!/bin/sh
exec node --input-type=commonjs - "$@" <<'SENDER'
const fs = require("node:fs");
const config = JSON.parse(fs.readFileSync(process.env.TONY_FINISH_WEBHOOK_ENV, "utf8"));
const job = process.env.LIMEN_JOB_DIR || process.env.TEST_JOB_DIR;
fs.appendFileSync(config.observations, JSON.stringify({ args: process.argv.slice(2), config: process.env.TONY_FINISH_WEBHOOK_ENV, state: fs.readFileSync(job + "/state", "utf8").trim(), finished: fs.existsSync(job + "/finished-at"), pid: fs.existsSync(job + "/pid") }) + "\\n");
console.log("synthetic-secret-must-not-leak");
console.error("synthetic-secret-must-not-leak");
if (config.hang) {
  const child = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  fs.writeFileSync(config.descendant, String(child.pid));
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
  setTimeout(() => { child.kill("SIGKILL"); process.exit(99); }, 15000);
} else process.exit(config.exit || 0);
SENDER
`;
async function fixture(context: TestContext, fakePi?: string) {
	const scratch = await scratchRepo(fakePi);
	context.after(scratch.cleanup);
	const parent = dirname(scratch.root);
	const pkg = join(parent, "package");
	await mkdir(join(pkg, "bin"), { recursive: true });
	await cp(join(ROOT, "src"), join(pkg, "src"), { recursive: true });
	await cp(join(ROOT, "hook"), join(pkg, "hook"), { recursive: true });
	await cp(join(ROOT, "templates"), join(pkg, "templates"), { recursive: true });
	await copyFile(join(ROOT, "package.json"), join(pkg, "package.json"));
	await copyFile(join(ROOT, "bin/limen"), join(pkg, "bin/limen"));
	await writeFile(join(pkg, "bin/tony-finish-ping.sh"), sender, { mode: 0o755 });
	const env = { ...process.env };
	for (const key of Object.keys(env)) if (/^(LIMEN_|PI_|HERDR_|TONY_)/.test(key)) delete env[key];
	Object.assign(env, { PATH: `${scratch.fakeBin}:${process.env.PATH}`, HOME: parent, LIMEN_HOME: parent, LIMEN_HERDR: "0", LIMEN_HUNK: "0" });
	const command = (args: string[], extra: NodeJS.ProcessEnv = {}, cwd = scratch.root) => {
		const result = spawnSync(process.execPath, [join(pkg, "bin/limen"), ...args], { cwd, env: { ...env, ...extra }, encoding: "utf8", timeout: 15_000 });
		assert.equal(result.status, 0, result.stderr || result.error?.message);
		return result.stdout;
	};
	command(["init"]);
	const observations = join(parent, "observations");
	const config = async (path: string, extra: Record<string, unknown> = {}) => {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify({ observations, token: "synthetic-secret-must-not-leak", ...extra }), { mode: 0o600 });
		return realpath(path);
	};
	return { ...scratch, parent, pkg, env, command, config, observations };
}
async function delivery(job: string): Promise<string> {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		const text = await readFile(join(job, "finish-webhook"), "utf8").catch(() => "");
		if (/^(accepted|failed):/.test(text)) return text;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`no terminal webhook status in ${job}: ${await readFile(join(job, "log"), "utf8").catch(() => "no log")}`);
}
async function observe(path: string) {
	return (await readFile(path, "utf8"))
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
}
async function bareJob(root: string) {
	const job = join(root, ".limen/jobs/direct");
	await mkdir(job, { recursive: true });
	for (const [name, value] of Object.entries({ state: "running", label: "finish label", branch: "main", pid: "1", log: "" })) await writeFile(join(job, name), `${value}\n`);
	return job;
}
async function runModule(pkg: string, env: NodeJS.ProcessEnv, code: string): Promise<void> {
	const child = spawn(process.execPath, ["--input-type=module", "-e", code], { cwd: pkg, env, stdio: ["ignore", "ignore", "pipe"] });
	let stderr = "";
	child.stderr?.on("data", (chunk) => (stderr += chunk));
	await new Promise<void>((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr || `exit ${code}`))));
	});
}

test("automatic delivery invokes the real canonical helper with synthetic dotenv and intercepted transport", async (context) => {
	const f = await fixture(context);
	await copyFile(join(ROOT, "bin/tony-finish-ping.sh"), join(f.pkg, "bin/tony-finish-ping.sh"));
	const config = join(f.root, ".limen/finish-webhook.env");
	await writeFile(config, "TONY_FINISH_WEBHOOK_URL='https://synthetic.example.invalid/finish'\nTONY_FINISH_WEBHOOK_AUTH='Bearer synthetic-only'\n", { mode: 0o600 });
	const transport = join(f.parent, "transport.mjs");
	await writeFile(
		transport,
		`import { appendFileSync, readFileSync } from 'node:fs'; globalThis.fetch = async (url, options) => { appendFileSync(${JSON.stringify(f.observations)}, JSON.stringify({ url: String(url), method: options.method, redirect: options.redirect, headers: options.headers, body: JSON.parse(options.body), state: readFileSync(process.env.LIMEN_JOB_DIR + '/state', 'utf8').trim() }) + '\\n'); return { status: 204 }; };`,
	);
	const id = onlyJobId(f.command(["spawn", "--detached", "--label", 'real helper "quoted" \\', "finish without manual ping"], { NODE_OPTIONS: `--import=${transport}` }));
	const job = join(f.root, ".limen/jobs", id);
	assert.match(await delivery(job), /^accepted:/);
	const request = (await observe(f.observations))[0];
	assert.deepEqual(request.body, { job: 'real helper "quoted" \\', status: "done", branch: (await readFile(join(job, "branch"), "utf8")).trim() });
	assert.deepEqual(request.headers, { Authorization: "Bearer synthetic-only", "Content-Type": "application/json" });
	assert.equal(request.state, "done");
	assert.equal(request.method, "POST");
	assert.equal(request.redirect, "manual");
	assert.equal((await observe(f.observations)).length, 1);
	assert.doesNotMatch(await readFile(join(job, "log"), "utf8"), /synthetic-only|synthetic\.example/);
});

test("detached completion sends exact arguments only after durable state using an absolute explicit config snapshot", async (context) => {
	const f = await fixture(context);
	await f.config(join(f.root, ".limen/finish-webhook.env"), { exit: 99 });
	const selected = await f.config(join(f.root, "private config.env"));
	const label = 'quote " slash \\ $(no-shell) ☃';
	const branch = 'limen/quote"branch';
	const id = onlyJobId(f.command(["spawn", "--detached", "--label", label, "--branch", branch, "finish without manual ping"], { TONY_FINISH_WEBHOOK_ENV: "private config.env" }));
	const job = join(f.root, ".limen/jobs", id);
	assert.match(await delivery(job), /^accepted: sender exited 0 \(owner wake unobserved\)/);
	assert.deepEqual(await observe(f.observations), [{ args: [label, "done", branch], config: selected, state: "done", finished: true, pid: false }]);
	assert.equal(await readFile(join(job, "finish-webhook-env"), "utf8"), `${selected}\n`);
	assert.equal((await stat(join(job, "finish-webhook-env"))).mode & 0o777, 0o600);
	assert.doesNotMatch(await readFile(join(job, "log"), "utf8"), /synthetic-secret/);
	assert.equal(await readFile(join(job, "notify/ready"), "utf8"), "1\n");
	assert.match(f.command(["jobs", id]), /finish webhook: accepted:/);
});

test("canonical project config is selected from a linked worktree, never the worktree-local decoy", async (context) => {
	const f = await fixture(context);
	const selected = await f.config(join(f.root, ".limen/finish-webhook.env"));
	const linked = join(f.parent, "linked");
	git(f.root, "worktree", "add", "-b", "linked", linked);
	await f.config(join(linked, ".limen/finish-webhook.env"), { exit: 99 });
	assert.equal(finishWebhookEnv(linked, linked, ""), "");
	const id = onlyJobId(f.command(["spawn", "--detached", "finish"], {}, linked));
	const job = join(linked, ".limen/jobs", id);
	assert.match(await delivery(job), /^accepted:/);
	assert.equal(await readFile(join(job, "finish-webhook-env"), "utf8"), `${selected}\n`);
	assert.equal((await observe(f.observations))[0].config, selected);
});

test("workspace jobs use the coordinator project's config rather than a child repository destination", async (context) => {
	const f = await fixture(context);
	f.command(["workspace", "init"], {}, f.parent);
	const selected = await f.config(join(f.parent, ".limen/finish-webhook.env"));
	await f.config(join(f.root, ".limen/finish-webhook.env"), { exit: 99 });
	const id = onlyJobId(f.command(["spawn", "--detached", "--repo", "repo", "finish"], {}, f.parent));
	const job = join(f.parent, ".limen/jobs", id);
	assert.match(await delivery(job), /^accepted:/);
	assert.equal(await readFile(join(job, "finish-webhook-env"), "utf8"), `${selected}\n`);
	assert.equal((await observe(f.observations))[0].config, selected);
});

test("unconfigured jobs never inherit home config or a later finalizer environment", async (context) => {
	const f = await fixture(context);
	const homeConfig = await f.config(join(f.parent, ".overment/finish-webhook.env"));
	const id = onlyJobId(f.command(["spawn", "--detached", "finish"]));
	await waitForState(f.root, id, "done");
	const job = join(f.root, ".limen/jobs", id);
	await runModule(
		f.pkg,
		{ ...f.env, TONY_FINISH_WEBHOOK_ENV: homeConfig },
		`const { finalizeJob } = await import('./src/wrapper.ts'); await finalizeJob(${JSON.stringify(job)}, 'failed', 'repeat');`,
	);
	await assert.rejects(readFile(join(job, "finish-webhook-env")));
	await assert.rejects(readFile(join(job, "finish-webhook-attempt")));
	await assert.rejects(readFile(f.observations));
});

test("concurrent processes and repeated finalization make one automatic attempt; failure preserves outcome and routing", async (context) => {
	const f = await fixture(context);
	const job = await bareJob(f.root);
	const selected = await f.config(join(f.parent, "private.env"), { exit: 22 });
	await writeFile(join(job, "finish-webhook-env"), `${selected}\n`);
	await mkdir(join(job, "notify/subscribers"), { recursive: true });
	await writeFile(join(job, "notify/subscribers/owner"), "subscribed\n");
	const code = `const { finalizeJob } = await import('./src/wrapper.ts'); await finalizeJob(${JSON.stringify(job)}, 'failed', 'synthetic worker failure');`;
	await Promise.all(Array.from({ length: 4 }, () => runModule(f.pkg, { ...f.env, TEST_JOB_DIR: job }, code)));
	assert.match(await delivery(job), /^failed: sender exited 22/);
	assert.match(await readFile(join(job, "finish-webhook"), "utf8"), /Manual finish-ping retry:/);
	await runModule(f.pkg, { ...f.env, TEST_JOB_DIR: job }, code);
	assert.equal((await observe(f.observations)).length, 1);
	assert.equal(await readFile(join(job, "state"), "utf8"), "failed\n");
	assert.equal(await readFile(join(job, "notify/subscribers/owner"), "utf8"), "subscribed\n");
	assert.doesNotMatch(await readFile(join(job, "finish-webhook"), "utf8"), /synthetic-secret/);
	assert.doesNotMatch(await readFile(join(job, "log"), "utf8"), /synthetic-secret/);
});

test("hosted supervisor completion uses the same automatic path without a worker manual ping", async (context) => {
	const f = await fixture(context);
	const job = await bareJob(f.root);
	const selected = await f.config(join(f.parent, "hosted.env"));
	await writeFile(join(job, "finish-webhook-env"), `${selected}\n`);
	await writeFile(join(job, "session-ended"), "1\n");
	const herdr = join(f.fakeBin, "herdr");
	await writeFile(herdr, '#!/usr/bin/env node\nconsole.log(JSON.stringify({ result: { status: "done" } }));\n');
	await chmod(herdr, 0o755);
	await runModule(
		f.pkg,
		{ ...f.env, LIMEN_HERDR: herdr, LIMEN_JOB_DIR: job, LIMEN_HOSTED_TARGET: "synthetic:p1" },
		"const { runHostedSupervisor } = await import('./src/supervisor.ts'); await runHostedSupervisor();",
	);
	assert.match(await delivery(job), /^accepted:/);
	assert.equal((await observe(f.observations))[0].state, "done");
});

test("hanging sender and its descendant are killed within shutdown grace without changing stopped state", async (context) => {
	const f = await fixture(context);
	const job = await bareJob(f.root);
	const descendant = join(f.parent, "descendant");
	const selected = await f.config(join(f.parent, "hang.env"), { hang: true, descendant });
	await writeFile(join(job, "finish-webhook-env"), `${selected}\n`);
	const started = Date.now();
	await runModule(
		f.pkg,
		{ ...f.env, TEST_JOB_DIR: job },
		`const { finalizeJob } = await import('./src/wrapper.ts'); await finalizeJob(${JSON.stringify(job)}, 'stopped', 'bounded stop');`,
	);
	assert.ok(Date.now() - started < 4_500, "sender must leave room within the wrapper's 5s grace");
	assert.match(await delivery(job), /^failed: sender exceeded 3000ms; acceptance unknown/);
	assert.equal(await readFile(join(job, "state"), "utf8"), "stopped\n");
	const pid = Number(await readFile(descendant, "utf8"));
	const status = spawnSync("ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8" });
	assert.ok(status.status !== 0 || status.stdout.trim().startsWith("Z"), `sender descendant is still running: ${status.stdout}`);
});

test("an exhausted shutdown budget records not sent without launching the helper", async (context) => {
	const f = await fixture(context);
	const job = await bareJob(f.root);
	const selected = await f.config(join(f.parent, "late.env"));
	await writeFile(join(job, "finish-webhook-env"), `${selected}\n`);
	await runModule(
		f.pkg,
		{ ...f.env, TEST_JOB_DIR: job },
		`const { finalizeJob } = await import('./src/wrapper.ts'); await finalizeJob(${JSON.stringify(job)}, 'stopped', 'late stop', Date.now() - 1);`,
	);
	assert.match(await delivery(job), /^failed: no shutdown time remains; not sent/);
	assert.equal(await readFile(join(job, "state"), "utf8"), "stopped\n");
	await assert.rejects(readFile(f.observations));
});

test("missing config and unavailable sender fail safely, while an interrupted claim is never retried automatically", async (context) => {
	const f = await fixture(context);
	const job = await bareJob(f.root);
	await writeFile(join(job, "finish-webhook-env"), `${join(f.parent, "missing.env")}\n`);
	const finalize = `const { finalizeJob } = await import('./src/wrapper.ts'); await finalizeJob(${JSON.stringify(job)}, 'done', 'finish');`;
	await runModule(f.pkg, { ...f.env, TEST_JOB_DIR: job }, finalize);
	assert.match(await delivery(job), /^failed: sender exited 1/);
	assert.doesNotMatch(await readFile(join(job, "log"), "utf8"), /ENOENT|missing\.env|synthetic-secret/);
	await rm(join(job, "finish-webhook-attempt"));
	await writeFile(join(job, "state"), "running\n");
	await rm(join(f.pkg, "bin/tony-finish-ping.sh"));
	await runModule(f.pkg, { ...f.env, TEST_JOB_DIR: job }, finalize);
	assert.match(await delivery(job), /^failed: sender could not start/);
	const receipt = await readFile(join(job, "finish-webhook"), "utf8");
	await writeFile(join(job, "state"), "running\n");
	await runModule(f.pkg, { ...f.env, TEST_JOB_DIR: job }, finalize);
	assert.equal(await readFile(join(job, "finish-webhook"), "utf8"), receipt);
	await assert.rejects(readFile(f.observations));
});

test("detached exhaustion records a bounded delivery failure before its self-kill grace", async (context) => {
	const f = await fixture(context, '#!/usr/bin/env node\nprocess.on("SIGTERM", () => {}); setInterval(() => {}, 1000);\n');
	const selected = await f.config(join(f.parent, "exhaust.env"), { hang: true, descendant: join(f.parent, "descendant") });
	const id = onlyJobId(f.command(["spawn", "--detached", "--timeout", "1s", "exhaust"], { TONY_FINISH_WEBHOOK_ENV: selected }));
	const job = join(f.root, ".limen/jobs", id);
	assert.match(await delivery(job), /^failed: (sender exceeded \d+ms; acceptance unknown|no shutdown time remains; not sent)/);
	assert.equal(await readFile(join(job, "state"), "utf8"), "failed\n");
	const log = await readFile(join(job, "log"), "utf8");
	assert.match(log, /failed: timeout after 1000ms/);
	assert.match(log, /finish webhook: failed:/);
});

test("continuation retains only its parent's config path even when the caller selects another destination", async (context) => {
	const f = await fixture(context);
	const selected = await f.config(join(f.parent, "first.env"));
	const other = await f.config(join(f.parent, "other.env"), { exit: 99 });
	const id = onlyJobId(f.command(["spawn", "--detached", "finish"], { TONY_FINISH_WEBHOOK_ENV: selected }));
	const parentJob = join(f.root, ".limen/jobs", id);
	await delivery(parentJob);
	await mkdir(join(parentJob, "session"));
	await writeFile(join(parentJob, "session/one.jsonl"), "{}\n");
	const next = onlyJobId(f.command(["continue", "--detached", id, "follow up"], { TONY_FINISH_WEBHOOK_ENV: other }));
	const job = join(f.root, ".limen/jobs", next);
	assert.match(await delivery(job), /^accepted:/);
	assert.equal(await readFile(join(job, "finish-webhook-env"), "utf8"), `${selected}\n`);
	assert.equal((await observe(f.observations)).length, 2);
	assert.equal((await observe(f.observations))[1].config, selected);
});
