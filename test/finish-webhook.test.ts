import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmod, copyFile, cp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { finishEvent } from "../src/finish-receipt.ts";
import { finishWebhookEnv } from "../src/finish-webhook.ts";
import { git, onlyJobId, scratchRepo, waitForState } from "./scratch.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TIP_A = "a".repeat(40);
const TIP_B = "b".repeat(40);
const sender = `#!/bin/sh
exec node --input-type=commonjs - "$@" <<'SENDER'
const fs = require("node:fs");
const config = JSON.parse(fs.readFileSync(process.env.LIMEN_FINISH_WEBHOOK_ENV, "utf8"));
const job = process.env.LIMEN_JOB_DIR || process.env.TEST_JOB_DIR;
fs.appendFileSync(config.observations, JSON.stringify({ args: process.argv.slice(2), config: process.env.LIMEN_FINISH_WEBHOOK_ENV, state: fs.readFileSync(job + "/state", "utf8").trim(), finished: fs.existsSync(job + "/finished-at"), pid: fs.existsSync(job + "/pid") }) + "\\n");
console.log("synthetic-secret-must-not-leak");
console.error("synthetic-secret-must-not-leak");
if (config.receipts) fs.writeSync(3, config.receipts);
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
		if (/^(accepted|failed|skipped):/.test(text)) return text;
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
async function bareJob(root: string, id = "direct") {
	const job = join(root, ".limen/jobs", id);
	await mkdir(job, { recursive: true });
	for (const [name, value] of Object.entries({ state: "running", label: "finish label", branch: "main", pid: "1", log: "", "task.md": "Synthetic finish test" }))
		await writeFile(join(job, name), `${value}\n`);
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

for (const state of ["failed", "stopped", "done"]) {
	for (const result of [undefined, "", " \n\t", "Failure investigated; see committed repair.", "unreadable"] as const) {
		test(`automatic finish decision: ${state} with ${result === undefined ? "missing" : JSON.stringify(result)} result`, async (context) => {
			const f = await fixture(context);
			const job = await bareJob(f.root);
			const selected = await f.config(join(f.parent, "decision.env"));
			await writeFile(join(job, "finish-webhook-env"), `${selected}\n`);
			if (result === "unreadable") await mkdir(join(job, "result"));
			else if (result !== undefined) await writeFile(join(job, "result"), result);
			await mkdir(join(job, "notify/subscribers"), { recursive: true });
			await writeFile(join(job, "notify/subscribers/owner"), "subscribed\n");
			await writeFile(join(job, "notify/ready"), "1\n");
			const code = `const { finalizeJob } = await import('./src/wrapper.ts'); await finalizeJob(${JSON.stringify(job)}, '${state}', 'synthetic terminal detail');`;
			await runModule(f.pkg, { ...f.env, TEST_JOB_DIR: job }, code);
			const skip = state !== "done" && !result?.trim();
			const receipt = await readFile(join(job, "finish-webhook"), "utf8");
			if (skip) {
				await assert.rejects(readFile(f.observations), { code: "ENOENT" }, "empty failed/stopped jobs must not invoke the sender");
				await assert.rejects(readFile(join(job, "finish-webhook-targets")), { code: "ENOENT" });
				assert.match(receipt, new RegExp(`^skipped: ${state} with empty result; not sent`));
				assert.doesNotMatch(receipt, /Manual finish-ping retry/);
				assert.match(await readFile(join(job, "log"), "utf8"), /finish webhook: skipped:/);
				for (const view of ["compact", "human"]) assert.match(f.command(["jobs", "direct"], { LIMEN_VIEW: view }), /skipped: .* with empty result; not sent/);
			} else {
				assert.match(receipt, /^accepted:/);
				assert.deepEqual(await observe(f.observations), [{ args: ["finish label", state, "main"], config: selected, state, finished: true, pid: false }]);
			}
			assert.equal(await readFile(join(job, "state"), "utf8"), `${state}\n`);
			assert.equal(await readFile(join(job, "notify/ready"), "utf8"), "1\n");
			assert.equal(await readFile(join(job, "notify/subscribers/owner"), "utf8"), "subscribed\n");
			const claim = await readFile(join(job, "finish-webhook-attempt"), "utf8");
			// A late result cannot re-arm a skipped job; a removed handoff cannot replace an accepted receipt.
			await rm(join(job, "result"), { recursive: true, force: true });
			await writeFile(join(job, "result"), skip ? "Late handoff" : "");
			await Promise.all(
				Array.from({ length: 4 }, () =>
					runModule(
						f.pkg,
						{ ...f.env, TEST_JOB_DIR: job },
						`const { deliverFinishWebhook } = await import('./src/finish-webhook.ts'); await deliverFinishWebhook(${JSON.stringify(job)});`,
					),
				),
			);
			await runModule(f.pkg, { ...f.env, TEST_JOB_DIR: job }, code);
			assert.equal(await readFile(join(job, "finish-webhook"), "utf8"), receipt);
			assert.equal(await readFile(join(job, "finish-webhook-attempt"), "utf8"), claim);
			if (skip) await assert.rejects(readFile(f.observations), { code: "ENOENT" });
			else assert.equal((await observe(f.observations)).length, 1);
		});
	}
}

test("second job at the same recorded tip skips automatic ping", async (context) => {
	const f = await fixture(context);
	const selected = await f.config(join(f.parent, "same-tip.env"));
	const first = await bareJob(f.root, "first");
	const second = await bareJob(f.root, "second");
	for (const job of [first, second]) {
		await writeFile(join(job, "finish-webhook-env"), `${selected}\n`);
		await writeFile(join(job, "tip"), `${TIP_A}\n`);
	}
	const finalize = (job: string) =>
		runModule(
			f.pkg,
			{ ...f.env, TEST_JOB_DIR: job },
			`const { finalizeJob } = await import('./src/wrapper.ts'); await finalizeJob(${JSON.stringify(job)}, 'done', 'synthetic terminal detail');`,
		);
	await finalize(first);
	assert.match(await readFile(join(first, "finish-webhook"), "utf8"), /^accepted:/);
	await finalize(second);
	const receipt = await readFile(join(second, "finish-webhook"), "utf8");
	assert.match(receipt, /^skipped: same settled tip already notified; not sent/);
	assert.doesNotMatch(receipt, /Manual finish-ping retry/);
	assert.match(await readFile(join(second, "log"), "utf8"), /finish webhook: skipped: same settled tip already notified; not sent/);
	await assert.rejects(readFile(join(second, "finish-webhook-targets")), { code: "ENOENT" });
	assert.equal((await observe(f.observations)).length, 1);
	for (const view of ["compact", "human"]) assert.match(f.command(["jobs", "second"], { LIMEN_VIEW: view }), /skipped: same settled tip already notified; not sent/);
	assert.equal(await readFile(join(f.root, ".limen/finish-webhook-tips", TIP_A), "utf8"), "first\n");
});

test("a job that settles at a different recorded tip still sends", async (context) => {
	const f = await fixture(context);
	const selected = await f.config(join(f.parent, "diff-tip.env"));
	const first = await bareJob(f.root, "first");
	const second = await bareJob(f.root, "second");
	await writeFile(join(first, "finish-webhook-env"), `${selected}\n`);
	await writeFile(join(second, "finish-webhook-env"), `${selected}\n`);
	await writeFile(join(first, "tip"), `${TIP_A}\n`);
	await writeFile(join(second, "tip"), `${TIP_B}\n`);
	for (const job of [first, second]) {
		await runModule(
			f.pkg,
			{ ...f.env, TEST_JOB_DIR: job },
			`const { finalizeJob } = await import('./src/wrapper.ts'); await finalizeJob(${JSON.stringify(job)}, 'done', 'synthetic terminal detail');`,
		);
	}
	assert.match(await readFile(join(first, "finish-webhook"), "utf8"), /^accepted:/);
	assert.match(await readFile(join(second, "finish-webhook"), "utf8"), /^accepted:/);
	assert.equal((await observe(f.observations)).length, 2);
});

test("empty failed skip does not quiet a later job at the same tip", async (context) => {
	const f = await fixture(context);
	const selected = await f.config(join(f.parent, "empty-tip.env"));
	const first = await bareJob(f.root, "first");
	const second = await bareJob(f.root, "second");
	for (const job of [first, second]) {
		await writeFile(join(job, "finish-webhook-env"), `${selected}\n`);
		await writeFile(join(job, "tip"), `${TIP_A}\n`);
	}
	await runModule(
		f.pkg,
		{ ...f.env, TEST_JOB_DIR: first },
		`const { finalizeJob } = await import('./src/wrapper.ts'); await finalizeJob(${JSON.stringify(first)}, 'failed', 'synthetic terminal detail');`,
	);
	assert.match(await readFile(join(first, "finish-webhook"), "utf8"), /^skipped: failed with empty result; not sent/);
	await assert.rejects(readFile(f.observations), { code: "ENOENT" });
	await runModule(
		f.pkg,
		{ ...f.env, TEST_JOB_DIR: second },
		`const { finalizeJob } = await import('./src/wrapper.ts'); await finalizeJob(${JSON.stringify(second)}, 'done', 'synthetic terminal detail');`,
	);
	assert.match(await readFile(join(second, "finish-webhook"), "utf8"), /^accepted:/);
	assert.equal((await observe(f.observations)).length, 1);
});

test("concurrent jobs at the same recorded tip send at most once", async (context) => {
	const f = await fixture(context);
	const selected = await f.config(join(f.parent, "race-tip.env"));
	const first = await bareJob(f.root, "first");
	const second = await bareJob(f.root, "second");
	for (const job of [first, second]) {
		await writeFile(join(job, "finish-webhook-env"), `${selected}\n`);
		await writeFile(join(job, "tip"), `${TIP_A}\n`);
	}
	const finalize = (job: string) =>
		runModule(
			f.pkg,
			{ ...f.env, TEST_JOB_DIR: job },
			`const { finalizeJob } = await import('./src/wrapper.ts'); await finalizeJob(${JSON.stringify(job)}, 'done', 'synthetic terminal detail');`,
		);
	await Promise.all([finalize(first), finalize(second)]);
	assert.equal((await observe(f.observations)).length, 1);
	const receipts = [await readFile(join(first, "finish-webhook"), "utf8"), await readFile(join(second, "finish-webhook"), "utf8")];
	assert.equal(receipts.filter((text) => /^accepted:/.test(text)).length, 1);
	assert.equal(receipts.filter((text) => /^skipped: same settled tip already notified; not sent/.test(text)).length, 1);
});

test("two detached jobs that settle at the same HEAD send one automatic ping", async (context) => {
	const f = await fixture(context);
	await f.config(join(f.root, ".limen/finish-webhook.env"));
	const first = onlyJobId(f.command(["spawn", "--detached", "--label", "first quiet", "finish"]));
	const job1 = join(f.root, ".limen/jobs", first);
	assert.match(await delivery(job1), /^accepted:/);
	const tip = (await readFile(join(job1, "tip"), "utf8")).trim();
	assert.match(tip, /^[0-9a-f]{40}$/);
	const second = onlyJobId(f.command(["spawn", "--detached", "--label", "second quiet", "finish"]));
	const job2 = join(f.root, ".limen/jobs", second);
	assert.match(await delivery(job2), /^skipped: same settled tip already notified; not sent/);
	assert.equal((await readFile(join(job2, "tip"), "utf8")).trim(), tip);
	assert.equal((await observe(f.observations)).length, 1);
	assert.match(await readFile(join(job2, "log"), "utf8"), /finish webhook: skipped: same settled tip already notified; not sent/);
});

test("a detached job that commits still sends after another job at the previous tip", async (context) => {
	const f = await fixture(context);
	await f.config(join(f.root, ".limen/finish-webhook.env"));
	const first = onlyJobId(f.command(["spawn", "--detached", "--label", "base tip", "finish"]));
	const job1 = join(f.root, ".limen/jobs", first);
	assert.match(await delivery(job1), /^accepted:/);
	const second = onlyJobId(f.command(["spawn", "--detached", "--label", "new tip", "make commit"]));
	const job2 = join(f.root, ".limen/jobs", second);
	assert.match(await delivery(job2), /^accepted:/);
	assert.equal((await observe(f.observations)).length, 2);
	assert.notEqual((await readFile(join(job1, "tip"), "utf8")).trim(), (await readFile(join(job2, "tip"), "utf8")).trim());
});

test("automatic delivery invokes the real canonical helper with synthetic dotenv and intercepted transport", async (context) => {
	const f = await fixture(context);
	await copyFile(join(ROOT, "bin/tony-finish-ping.sh"), join(f.pkg, "bin/tony-finish-ping.sh"));
	const config = join(f.root, ".limen/finish-webhook.env");
	await writeFile(config, "LIMEN_FINISH_WEBHOOK_URL='https://synthetic.example.invalid/finish'\nLIMEN_FINISH_WEBHOOK_AUTH='Bearer synthetic-only'\n", { mode: 0o600 });
	const transport = join(f.parent, "transport.mjs");
	await writeFile(
		transport,
		`import { appendFileSync, readFileSync } from 'node:fs'; globalThis.fetch = async (url, options) => { appendFileSync(${JSON.stringify(f.observations)}, JSON.stringify({ url: String(url), method: options.method, redirect: options.redirect, headers: options.headers, body: JSON.parse(options.body), state: readFileSync(process.env.LIMEN_JOB_DIR + '/state', 'utf8').trim() }) + '\\n'); return { status: 204 }; };`,
	);
	const id = onlyJobId(f.command(["spawn", "--detached", "--label", 'real helper "quoted" \\', "finish without manual ping"], { NODE_OPTIONS: `--import=${transport}` }));
	const job = join(f.root, ".limen/jobs", id);
	assert.match(await delivery(job), /^accepted:/);
	const request = (await observe(f.observations))[0];
	assert.deepEqual(
		{ job: request.body.job, status: request.body.status, jobState: request.body.jobState, branch: request.body.branch, finishEvent: request.body.finishEvent },
		{ job: 'real helper "quoted" \\', status: "waiting", jobState: "done", branch: (await readFile(join(job, "branch"), "utf8")).trim(), finishEvent: finishEvent(job) },
	);
	assert.deepEqual(request.headers, { Authorization: "Bearer synthetic-only", "Content-Type": "application/json" });
	assert.equal(request.state, "done");
	assert.equal(request.method, "POST");
	assert.equal(request.redirect, "manual");
	assert.equal((await observe(f.observations)).length, 1);
	assert.doesNotMatch(await readFile(join(job, "log"), "utf8"), /synthetic-only|synthetic\.example/);
});

test("automatic delivery finds Limen's Node runtime when the inherited PATH cannot run node", async (context) => {
	const f = await fixture(context);
	await copyFile(join(ROOT, "bin/tony-finish-ping.sh"), join(f.pkg, "bin/tony-finish-ping.sh"));
	const job = await bareJob(f.root);
	const config = join(f.parent, "runtime.env");
	await writeFile(config, "LIMEN_FINISH_WEBHOOK_URL='https://synthetic.example.invalid/finish'\nLIMEN_FINISH_WEBHOOK_AUTH='Bearer synthetic-only'\n", { mode: 0o600 });
	await writeFile(join(job, "finish-webhook-env"), `${config}\n`);
	// Simulate a stale/missing node in a service PATH, independently of the host's installed binaries.
	await writeFile(join(f.fakeBin, "node"), "#!/bin/sh\nexit 127\n", { mode: 0o755 });
	const transport = join(f.parent, "runtime-transport.mjs");
	await writeFile(
		transport,
		`import { appendFileSync } from 'node:fs'; globalThis.fetch = async () => { appendFileSync(${JSON.stringify(f.observations)}, 'accepted\\n'); return { status: 204 }; };`,
	);
	await runModule(
		f.pkg,
		{ ...f.env, PATH: f.fakeBin, NODE_OPTIONS: `--import=${transport}` },
		`const { finalizeJob } = await import('./src/wrapper.ts'); await finalizeJob(${JSON.stringify(job)}, 'done', 'runtime probe');`,
	);
	assert.match(await delivery(job), /^accepted: sender exited 0 \(owner wake unobserved\)/);
	assert.equal(await readFile(f.observations, "utf8"), "accepted\n");
	assert.equal(await readFile(join(job, "state"), "utf8"), "done\n");
});

for (const firstStatus of [204, 503, "stall"]) {
	test(`automatic fan-out reaches two bot routes after terminal state; first HTTP ${firstStatus} stays HTTP-only`, async (context) => {
		const f = await fixture(context);
		await copyFile(join(ROOT, "bin/tony-finish-ping.sh"), join(f.pkg, "bin/tony-finish-ping.sh"));
		const targets = [
			{ url: "https://synthetic.example.invalid/grok-one", auth: "Bearer synthetic-one" },
			{ url: "https://synthetic.example.invalid/grok-two", auth: "Bearer synthetic-two" },
		];
		await writeFile(join(f.root, ".limen/finish-webhook.env"), `LIMEN_FINISH_WEBHOOK_TARGETS='${JSON.stringify(targets)}'\n`, { mode: 0o600 });
		const transport = join(f.parent, "transport.mjs");
		await writeFile(
			transport,
			`import { appendFileSync, readFileSync } from 'node:fs'; globalThis.fetch = async (url, options) => {
				appendFileSync(${JSON.stringify(f.observations)}, JSON.stringify({ url: String(url), auth: options.headers.Authorization, body: JSON.parse(options.body), state: readFileSync(process.env.LIMEN_JOB_DIR + '/state', 'utf8').trim() }) + '\\n');
				if (String(url).endsWith('/grok-one')) return ${firstStatus === "stall" ? "new Promise(() => {})" : `{ status: ${firstStatus} }`};
				return { status: 204 };
			};`,
		);
		const id = onlyJobId(f.command(["spawn", "--detached", "--label", "two bots", "finish without manual ping"], { NODE_OPTIONS: `--import=${transport}` }));
		const job = join(f.root, ".limen/jobs", id);
		const result = await delivery(job);
		assert.match(
			result,
			firstStatus === 204
				? /^accepted: sender exited 0 \(owner wake unobserved\)/
				: firstStatus === "stall"
					? /^failed: sender exceeded 3000ms; acceptance unknown/
					: /^failed: sender exited 1/,
		);
		const requests = await observe(f.observations);
		assert.deepEqual(
			requests.map(({ url, auth }) => ({ url, auth })),
			targets,
		);
		for (const request of requests) {
			assert.equal(request.state, "done");
			assert.equal(request.body.status, "waiting");
			assert.equal(request.body.jobState, "done");
			assert.equal(request.body.finishEvent, finishEvent(job));
		}
		assert.equal(await readFile(join(job, "state"), "utf8"), "done\n");
		assert.doesNotMatch(result + (await readFile(join(job, "log"), "utf8")), /synthetic-one|synthetic-two|synthetic\.example/);
		// The receiver only accepts HTTP: no bot session/turn is created by this fixture or claimed by the receipt.
		assert.match(result, /Acceptance is not proof of owner wake/);
		const receipts = await readFile(join(job, "finish-webhook-targets"), "utf8");
		assert.equal((await stat(join(job, "finish-webhook-targets"))).mode & 0o777, 0o600);
		const inspections: string[] = [];
		for (const view of ["compact", "human"]) {
			const detail = f.command(["jobs", id], { LIMEN_VIEW: view });
			assert.match(detail, /configured: yes/);
			assert.ok(detail.includes(finishEvent(job)));
			assert.match(detail, /target 2: transport accepted · HTTP 2xx/);
			assert.match(
				detail,
				firstStatus === 204
					? /target 1: transport accepted/
					: firstStatus === "stall"
						? /target 1: transport unknown \(attempt started; no result\)/
						: /target 1: transport rejected · HTTP 5xx/,
			);
			assert.match(detail, /bot-turn: unobserved/);
			assert.doesNotMatch(detail + receipts, /synthetic-one|synthetic-two|synthetic\.example|Bearer|grok-one|grok-two/);
			inspections.push(detail);
		}
		// Offline file exchange, not actual Johnny/Tony history. The operator explicitly selects this source.
		const source = join(f.parent, "receiver-exports");
		await mkdir(source);
		await writeFile(
			join(source, "receivers.json"),
			JSON.stringify({
				version: 1,
				targets: [
					{ target: 1, receiver: "johnny" },
					{ target: 2, receiver: "tony" },
				],
			}),
		);
		const completed = {
			version: 1,
			event: finishEvent(job),
			target: 1,
			receiver: "johnny",
			state: "completed",
			session: "synthetic-session",
			turn: "synthetic-turn",
			completedAt: "2026-09-11T12:00:00.000Z",
		};
		await writeFile(join(source, `${finishEvent(job)}.1.json`), JSON.stringify(completed));
		await writeFile(join(source, `${finishEvent(job)}.2.json`), JSON.stringify({ ...completed, target: 2, receiver: "tony", event: finishEvent("wrong-job") }));
		const promoted: string[] = [];
		for (const view of ["compact", "human"]) {
			const detail = f.command(["jobs", id], { LIMEN_VIEW: view, LIMEN_FINISH_EVIDENCE_DIR: source });
			assert.match(detail, /target 1: transport [^\n]*bot-turn observed[^\n]*receiver johnny[^\n]*turn synthetic-turn/);
			assert.match(detail, /target 2: transport accepted[^\n]*bot-turn unobserved/);
			assert.doesNotMatch(detail, /synthetic-one|synthetic-two|synthetic\.example|Bearer|wrong-job/);
			promoted.push(detail);
		}
		await writeFile(join(source, `${finishEvent(job)}.2.json`), JSON.stringify({ ...completed, target: 2, receiver: "tony", turn: "synthetic-turn-2" }));
		const both: string[] = [];
		for (const view of ["compact", "human"]) {
			const detail = f.command(["jobs", id], { LIMEN_VIEW: view, LIMEN_FINISH_EVIDENCE_DIR: source });
			assert.match(detail, /target 2: transport accepted[^\n]*bot-turn observed[^\n]*receiver tony[^\n]*turn synthetic-turn-2/);
			assert.match(detail, /bot-turn: observed for 2 target\(s\)/);
			both.push(detail);
		}
		await runModule(f.pkg, f.env, `const { finalizeJob } = await import('./src/wrapper.ts'); await finalizeJob(${JSON.stringify(job)}, 'done', 'repeat');`);
		assert.equal((await observe(f.observations)).length, 2, "repeat finalization sends nothing");
		assert.equal(await readFile(join(job, "finish-webhook-targets"), "utf8"), receipts);
		if (process.env.LIMEN_TEST_FINISH_EVIDENCE) {
			const evidence = join(process.env.LIMEN_TEST_FINISH_EVIDENCE, `two-target-${firstStatus}`);
			await mkdir(evidence, { recursive: true });
			await writeFile(join(evidence, "targets.jsonl"), receipts);
			await writeFile(join(evidence, "aggregate.txt"), result);
			await writeFile(join(evidence, "inspection.txt"), inspections.join("\n\n"));
			await writeFile(join(evidence, "one-observed.txt"), promoted.join("\n\n"));
			await writeFile(join(evidence, "both-observed.txt"), both.join("\n\n"));
			await cp(source, join(evidence, "synthetic-exports"), { recursive: true });
			await writeFile(
				join(evidence, "proof.txt"),
				`job=${id}\nevent=${finishEvent(job)}\nautomatic requests=2; after repeat=2\nactual receiver turns=0; synthetic exports only\nBoth views: no export -> unobserved; matching target 1 + mismatched target 2 -> only target 1 observed; both matching -> both observed\n`,
			);
		}
	});
}

test("private receipt channel discards malformed, secret-bearing, duplicate and overflowing sender output", async (context) => {
	const f = await fixture(context);
	const job = await bareJob(f.root);
	const pending = { target: 1, at: "2026-09-11T12:00:00.000Z", transport: "pending", http: "none" };
	const accepted = { ...pending, transport: "accepted", http: "2xx" };
	const safe = `${JSON.stringify(pending)}\n${JSON.stringify(accepted)}\n`;
	const selected = await f.config(join(f.parent, "channel.env"), {
		receipts:
			safe +
			[accepted, { ...accepted, token: "synthetic-secret" }, { ...accepted, target: 65 }, { ...accepted, transport: "observed" }].map((value) => JSON.stringify(value)).join("\n") +
			`\n${"synthetic-secret".repeat(3000)}\n`,
	});
	await writeFile(join(job, "finish-webhook-env"), `${selected}\n`);
	await runModule(
		f.pkg,
		{ ...f.env, TEST_JOB_DIR: job },
		`const { finalizeJob } = await import('./src/wrapper.ts'); await finalizeJob(${JSON.stringify(job)}, 'done', 'channel');`,
	);
	// The OS may coalesce the oversized stream: dropping the entire chunk is also safe.
	const retained = await readFile(join(job, "finish-webhook-targets"), "utf8").catch(() => "");
	assert.ok(["", `${JSON.stringify(pending)}\n`, safe].includes(retained), retained);
	assert.doesNotMatch(retained + (await readFile(join(job, "log"), "utf8")), /synthetic-secret|observed"|target":65/);
});

test("detached completion sends exact arguments only after durable state using an absolute explicit config snapshot", async (context) => {
	const f = await fixture(context);
	await f.config(join(f.root, ".limen/finish-webhook.env"), { exit: 99 });
	const selected = await f.config(join(f.root, "private config.env"));
	const label = 'quote " slash \\ $(no-shell) ☃';
	const branch = 'limen/quote"branch';
	const id = onlyJobId(f.command(["spawn", "--detached", "--label", label, "--branch", branch, "finish without manual ping"], { LIMEN_FINISH_WEBHOOK_ENV: "private config.env" }));
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

test("a retired env-path override does not opt an unconfigured job into delivery", async (context) => {
	const f = await fixture(context);
	const ignored = await f.config(join(f.parent, "ignored.env"));
	const id = onlyJobId(f.command(["spawn", "--detached", "finish"], { TONY_FINISH_WEBHOOK_ENV: ignored }));
	await waitForState(f.root, id, "done");
	const job = join(f.root, ".limen/jobs", id);
	await runModule(f.pkg, f.env, `const { finalizeJob } = await import('./src/wrapper.ts'); await finalizeJob(${JSON.stringify(job)}, 'done', 'repeat');`);
	await assert.rejects(readFile(join(job, "finish-webhook-env")));
	await assert.rejects(readFile(join(job, "finish-webhook-attempt")));
	await assert.rejects(readFile(f.observations));
});

test("unconfigured jobs never inherit home config or a later finalizer environment", async (context) => {
	const f = await fixture(context);
	const homeConfig = await f.config(join(f.parent, ".overment/finish-webhook.env"));
	const id = onlyJobId(f.command(["spawn", "--detached", "finish"]));
	await waitForState(f.root, id, "done");
	const job = join(f.root, ".limen/jobs", id);
	await runModule(
		f.pkg,
		{ ...f.env, LIMEN_FINISH_WEBHOOK_ENV: homeConfig },
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
	await writeFile(join(job, "result"), "Investigated worker failure; partial repair committed.\n");
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
	await writeFile(join(job, "result"), "Stopped after committing partial work.\n");
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
	await writeFile(join(job, "result"), "Stopped with a handoff but no delivery budget.\n");
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

test("detached exhaustion without a result skips delivery before its self-kill grace", async (context) => {
	const f = await fixture(context, '#!/usr/bin/env node\nprocess.on("SIGTERM", () => {}); setInterval(() => {}, 1000);\n');
	const selected = await f.config(join(f.parent, "exhaust.env"), { hang: true, descendant: join(f.parent, "descendant") });
	const id = onlyJobId(f.command(["spawn", "--detached", "--timeout", "1s", "exhaust"], { LIMEN_FINISH_WEBHOOK_ENV: selected }));
	const job = join(f.root, ".limen/jobs", id);
	assert.match(await delivery(job), /^skipped: failed with empty result; not sent/);
	assert.equal(await readFile(join(job, "state"), "utf8"), "failed\n");
	await assert.rejects(readFile(f.observations), { code: "ENOENT" });
	assert.equal(await readFile(join(job, "notify/ready"), "utf8"), "1\n");
	const log = await readFile(join(job, "log"), "utf8");
	assert.match(log, /failed: timeout after 1000ms/);
	assert.match(log, /finish webhook: skipped:/);
});

test("continuation retains only its parent's config path even when the caller selects another destination", async (context) => {
	const f = await fixture(context);
	const selected = await f.config(join(f.parent, "first.env"));
	const other = await f.config(join(f.parent, "other.env"), { exit: 99 });
	const id = onlyJobId(f.command(["spawn", "--detached", "finish"], { LIMEN_FINISH_WEBHOOK_ENV: selected }));
	const parentJob = join(f.root, ".limen/jobs", id);
	await delivery(parentJob);
	await mkdir(join(parentJob, "session"));
	await writeFile(join(parentJob, "session/one.jsonl"), "{}\n");
	const next = onlyJobId(f.command(["continue", "--detached", id, "follow up"], { LIMEN_FINISH_WEBHOOK_ENV: other }));
	const job = join(f.root, ".limen/jobs", next);
	assert.match(await delivery(job), /^skipped: same settled tip already notified; not sent/);
	assert.equal(await readFile(join(job, "finish-webhook-env"), "utf8"), `${selected}\n`);
	assert.equal((await observe(f.observations)).length, 1);
});

async function fileTicket(root: string, path: string, author: string) {
	await mkdir(dirname(join(root, path)), { recursive: true });
	await writeFile(join(root, path), `# ${path}\n\noutcome\n`);
	git(root, "add", path);
	git(root, "commit", "--author", author, "-m", `file ${path}`);
	return git(root, "rev-parse", "HEAD");
}
function authorDotenv(targets: readonly { url: string; auth: string }[], map: unknown) {
	return `LIMEN_FINISH_WEBHOOK_TARGETS='${JSON.stringify(targets)}'\nLIMEN_FINISH_WEBHOOK_AUTHOR_TARGETS='${JSON.stringify(map)}'\n`;
}

test("two collaborators' finishes reach only their mapped targets after edits and lane moves", async (context) => {
	const f = await fixture(context);
	await copyFile(join(ROOT, "bin/tony-finish-ping.sh"), join(f.pkg, "bin/tony-finish-ping.sh"));
	const first = "spec/features/active/F001-first/ticket.md";
	const second = "spec/features/active/F002-second/ticket.md";
	const aliceCommit = await fileTicket(f.root, first, "Alice Filer <1234+alice@users.noreply.github.com>");
	await fileTicket(f.root, second, "Bob Filer <bob@users.noreply.github.com>");
	const moved = "spec/features/done/F001-first/ticket.md";
	await mkdir(dirname(join(f.root, moved)), { recursive: true });
	git(f.root, "mv", first, moved);
	git(f.root, "commit", "--author", "Bob Filer <bob@users.noreply.github.com>", "-m", "move first ticket");
	await writeFile(join(f.root, moved), "# First ticket\n\nReviewed by Bob.\n");
	git(f.root, "commit", "-am", "edit first ticket", "--author", "Bob Filer <bob@users.noreply.github.com>");
	const targets = [
		{ url: "https://synthetic.example.invalid/alice-primary", auth: "Bearer synthetic-alice-1" },
		{ url: "https://synthetic.example.invalid/alice-secondary", auth: "Bearer synthetic-alice-2" },
		{ url: "https://synthetic.example.invalid/bob", auth: "Bearer synthetic-bob" },
	];
	await writeFile(join(f.root, ".limen/finish-webhook.env"), authorDotenv(targets, { "@alice": [1, 2], "@bob": [3] }), { mode: 0o600 });
	const transport = join(f.parent, "transport.mjs");
	await writeFile(
		transport,
		`import { appendFileSync } from 'node:fs'; globalThis.fetch = async (url, options) => { appendFileSync(${JSON.stringify(f.observations)}, JSON.stringify({ url: String(url), auth: options.headers.Authorization }) + '\\n'); return { status: 204 }; };`,
	);
	const extra = { NODE_OPTIONS: `--import=${transport}` };
	const aliceId = onlyJobId(f.command(["spawn", "--detached", "--label", "alice job", `make commit Ticket: ${moved}`], extra));
	const aliceJob = join(f.root, ".limen/jobs", aliceId);
	assert.match(await delivery(aliceJob), /^accepted:/);
	assert.match(await readFile(join(aliceJob, "finish-webhook-author"), "utf8"), new RegExp(`^@alice\\n${aliceCommit}\\n$`));
	assert.equal(await readFile(join(aliceJob, "finish-webhook-route"), "utf8"), "mapped @alice -> 1, 2\n");
	const bobId = onlyJobId(f.command(["spawn", "--detached", "--label", "bob job", `make commit Ticket: ${second}`], extra));
	const bobJob = join(f.root, ".limen/jobs", bobId);
	assert.match(await delivery(bobJob), /^accepted:/);
	assert.match(await readFile(join(bobJob, "finish-webhook-author"), "utf8"), /^@bob\n[0-9a-f]{40}\n$/);
	assert.equal(await readFile(join(bobJob, "finish-webhook-route"), "utf8"), "mapped @bob -> 3\n");
	assert.deepEqual(
		(await observe(f.observations)).map(({ url }) => url),
		targets.map((target) => target.url),
	);
	const bobReceipts = (await readFile(join(bobJob, "finish-webhook-targets"), "utf8"))
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line).target);
	assert.deepEqual([...new Set(bobReceipts)], [3]);
	assert.match(f.command(["jobs", bobId]), /target 3: transport accepted/);
	assert.doesNotMatch(f.command(["jobs", bobId]), /target 1:|target 2:/);
	assert.doesNotMatch((await readFile(join(aliceJob, "log"), "utf8")) + (await readFile(join(bobJob, "log"), "utf8")), /synthetic-alice|synthetic-bob|synthetic\.example/);
});

test("missing attribution and unmapped logins skip unless fallback is explicit", async (context) => {
	const f = await fixture(context);
	await copyFile(join(ROOT, "bin/tony-finish-ping.sh"), join(f.pkg, "bin/tony-finish-ping.sh"));
	const ordinary = "spec/features/active/F003-ordinary/ticket.md";
	const extraTicket = "spec/features/active/F004-extra/ticket.md";
	const ordinaryCommit = await fileTicket(f.root, ordinary, "Dana Filer <dana@example.test>");
	await fileTicket(f.root, extraTicket, "Dana Filer <dana@example.test>");
	const targets = [
		{ url: "https://synthetic.example.invalid/mapped", auth: "Bearer synthetic-mapped" },
		{ url: "https://synthetic.example.invalid/fallback", auth: "Bearer synthetic-fallback" },
	];
	await writeFile(join(f.root, ".limen/finish-webhook.env"), authorDotenv(targets, { "@alice": [1] }), { mode: 0o600 });
	const transport = join(f.parent, "transport.mjs");
	await writeFile(
		transport,
		`import { appendFileSync } from 'node:fs'; globalThis.fetch = async (url) => { appendFileSync(${JSON.stringify(f.observations)}, String(url) + '\\n'); return { status: 204 }; };`,
	);
	const extra = { NODE_OPTIONS: `--import=${transport}` };
	const missing = onlyJobId(f.command(["spawn", "--detached", "--label", "missing pointer", "make commit finish"], extra));
	const missingJob = join(f.root, ".limen/jobs", missing);
	assert.match(await delivery(missingJob), /^skipped: not sent: no author route/);
	assert.equal(await readFile(join(missingJob, "finish-webhook-author"), "utf8"), "unavailable\nmissing Ticket: pointer\n");
	assert.equal(await readFile(join(missingJob, "state"), "utf8"), "done\n");
	const ambiguous = onlyJobId(f.command(["spawn", "--detached", "--label", "ambiguous", `make commit Ticket: ${ordinary} Ticket: ${extraTicket}`], extra));
	assert.match(await delivery(join(f.root, ".limen/jobs", ambiguous)), /^skipped: not sent: no author route/);
	assert.equal(await readFile(join(f.root, ".limen/jobs", ambiguous, "finish-webhook-author"), "utf8"), "unavailable\nambiguous Ticket: pointer\n");
	const email = onlyJobId(f.command(["spawn", "--detached", "--label", "ordinary email", `make commit Ticket: ${ordinary}`], extra));
	const emailJob = join(f.root, ".limen/jobs", email);
	assert.match(await delivery(emailJob), /^skipped: not sent: no author route/);
	assert.equal(await readFile(join(emailJob, "finish-webhook-author"), "utf8"), `unavailable\nordinary email\n${ordinaryCommit}\n`);
	await writeFile(join(f.root, ".limen/finish-webhook.env"), authorDotenv(targets, { "@alice": [1], "*": [2] }), { mode: 0o600 });
	const fallback = onlyJobId(f.command(["spawn", "--detached", "--label", "fallback", "make commit finish"], extra));
	assert.match(await delivery(join(f.root, ".limen/jobs", fallback)), /^accepted:/);
	assert.equal(await readFile(join(f.root, ".limen/jobs", fallback, "finish-webhook-route"), "utf8"), "fallback * -> 2\n");
	assert.equal((await readFile(f.observations, "utf8").catch(() => "")).trim(), targets.at(1)?.url);
	await assert.rejects(readFile(join(missingJob, "finish-webhook-targets")), { code: "ENOENT" });
});

test("invalid author maps make zero requests and leave the job result intact", async (context) => {
	const f = await fixture(context);
	await copyFile(join(ROOT, "bin/tony-finish-ping.sh"), join(f.pkg, "bin/tony-finish-ping.sh"));
	const path = "spec/features/active/F005-invalid/ticket.md";
	await fileTicket(f.root, path, "Alice Filer <alice@users.noreply.github.com>");
	const targets = [
		{ url: "https://synthetic.example.invalid/one", auth: "Bearer synthetic-one" },
		{ url: "https://synthetic.example.invalid/two", auth: "Bearer synthetic-two" },
	];
	await writeFile(join(f.root, ".limen/finish-webhook.env"), authorDotenv(targets, { "@alice": [1, 9] }), { mode: 0o600 });
	const transport = join(f.parent, "transport.mjs");
	await writeFile(
		transport,
		`import { appendFileSync } from 'node:fs'; globalThis.fetch = async (url) => { appendFileSync(${JSON.stringify(f.observations)}, String(url) + '\\n'); return { status: 204 }; };`,
	);
	const id = onlyJobId(f.command(["spawn", "--detached", "--label", "invalid map", `make commit Ticket: ${path}`], { NODE_OPTIONS: `--import=${transport}` }));
	const job = join(f.root, ".limen/jobs", id);
	assert.match(await delivery(job), /^failed: invalid author map; not sent/);
	assert.equal(await readFile(join(job, "state"), "utf8"), "done\n");
	assert.equal(await readFile(join(job, "result"), "utf8"), "fake pi completed\n");
	await assert.rejects(readFile(f.observations), { code: "ENOENT" });
	await assert.rejects(readFile(join(job, "finish-webhook-targets")), { code: "ENOENT" });
	assert.match(f.command(["jobs", id]), /author: @alice/);
});

test("continuation keeps captured author after the ticket is removed", async (context) => {
	const f = await fixture(context);
	const path = "spec/features/active/F006-continue/ticket.md";
	const commit = await fileTicket(f.root, path, "Alice Filer <alice@users.noreply.github.com>");
	const id = onlyJobId(f.command(["spawn", "--detached", `Ticket: ${path}`]));
	const parentJob = join(f.root, ".limen/jobs", id);
	await waitForState(f.root, id, "done");
	assert.equal(await readFile(join(parentJob, "finish-webhook-author"), "utf8"), `@alice\n${commit}\n`);
	git(f.root, "rm", path);
	git(f.root, "commit", "-m", "remove ticket");
	await mkdir(join(parentJob, "session"));
	await writeFile(join(parentJob, "session/one.jsonl"), "{}\n");
	const next = onlyJobId(f.command(["continue", "--detached", id, "follow up"]));
	const job = join(f.root, ".limen/jobs", next);
	await waitForState(f.root, next, "done");
	assert.equal(await readFile(join(job, "finish-webhook-author"), "utf8"), `@alice\n${commit}\n`);
	const fresh = onlyJobId(f.command(["spawn", "--detached", "fresh without ticket"]));
	assert.equal(await readFile(join(f.root, ".limen/jobs", fresh, "finish-webhook-author"), "utf8"), "unavailable\nmissing Ticket: pointer\n");
});

test("hosted completion filters by captured author and preserves ordinals on partial failure", async (context) => {
	const f = await fixture(context);
	await copyFile(join(ROOT, "bin/tony-finish-ping.sh"), join(f.pkg, "bin/tony-finish-ping.sh"));
	const job = await bareJob(f.root);
	const targets = [
		{ url: "https://synthetic.example.invalid/one", auth: "Bearer synthetic-one" },
		{ url: "https://synthetic.example.invalid/two", auth: "Bearer synthetic-two" },
		{ url: "https://synthetic.example.invalid/three", auth: "Bearer synthetic-three" },
	];
	const config = join(f.parent, "hosted-authors.env");
	await writeFile(config, authorDotenv(targets, { "@alice": [1, 3] }), { mode: 0o600 });
	await writeFile(join(job, "finish-webhook-env"), `${config}\n`);
	await writeFile(join(job, "finish-webhook-author"), `@alice\n${"a".repeat(40)}\n`);
	await writeFile(join(job, "session-ended"), "1\n");
	const herdr = join(f.fakeBin, "herdr");
	await writeFile(herdr, '#!/usr/bin/env node\nconsole.log(JSON.stringify({ result: { status: "done" } }));\n');
	await chmod(herdr, 0o755);
	const transport = join(f.parent, "hosted-transport.mjs");
	await writeFile(
		transport,
		`import { appendFileSync } from 'node:fs'; globalThis.fetch = async (url) => { appendFileSync(${JSON.stringify(f.observations)}, String(url) + '\\n'); return { status: String(url).endsWith('/one') ? 503 : 204 }; };`,
	);
	await runModule(
		f.pkg,
		{ ...f.env, LIMEN_HERDR: herdr, LIMEN_JOB_DIR: job, LIMEN_HOSTED_TARGET: "synthetic:p1", NODE_OPTIONS: `--import=${transport}` },
		"const { runHostedSupervisor } = await import('./src/supervisor.ts'); await runHostedSupervisor();",
	);
	assert.match(await delivery(job), /^failed: sender exited 1/);
	assert.equal(await readFile(join(job, "state"), "utf8"), "done\n");
	assert.deepEqual(
		(await readFile(f.observations, "utf8")).trim().split("\n"),
		targets.filter((_, index) => index !== 1).map((target) => target.url),
	);
	assert.equal(await readFile(join(job, "finish-webhook-route"), "utf8"), "mapped @alice -> 1, 3\n");
	const receipts = (await readFile(join(job, "finish-webhook-targets"), "utf8"))
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	assert.deepEqual(
		[...new Set(receipts.map((row) => row.target))].sort((a, b) => a - b),
		[1, 3],
	);
	assert.match(f.command(["jobs", "direct"]), /target 1: transport rejected/);
	assert.match(f.command(["jobs", "direct"]), /target 3: transport accepted/);
	assert.doesNotMatch(f.command(["jobs", "direct"]), /target 2:/);
});

test("workspace, shallow, and later ticket evidence do not invent an author", async (context) => {
	const f = await fixture(context);
	const path = "spec/features/active/F007-child/ticket.md";
	const commit = await fileTicket(f.root, path, "Alice Filer <alice@users.noreply.github.com>");
	f.command(["workspace", "init"], {}, f.parent);
	const workspaceId = onlyJobId(f.command(["spawn", "--detached", "--repo", "repo", `Ticket: ${path}`], {}, f.parent));
	assert.equal(await readFile(join(f.parent, ".limen/jobs", workspaceId, "finish-webhook-author"), "utf8"), "unavailable\nnon-Git workspace ticket\n");
	const clone = join(f.parent, "shallow");
	git(f.root, "clone", "--depth=1", pathToFileURL(f.root).href, clone);
	const shallowId = onlyJobId(f.command(["spawn", "--detached", `Ticket: ${path}`], {}, clone));
	assert.equal(await readFile(join(clone, ".limen/jobs", shallowId, "finish-webhook-author"), "utf8"), "unavailable\nshallow history\n");
	const id = onlyJobId(f.command(["spawn", "--detached", `Ticket: ${path}`]));
	assert.equal(await readFile(join(f.root, ".limen/jobs", id, "finish-webhook-author"), "utf8"), `@alice\n${commit}\n`);
});
