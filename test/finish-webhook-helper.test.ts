import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HELPER = fileURLToPath(new URL("../bin/tony-finish-ping.sh", import.meta.url));
const AUTH = "Bearer synthetic-secret._~+/-==";
const DESTINATION = "https://finish.example.test/private-destination";

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "limen-finish-"));
	const home = join(root, "home");
	await mkdir(home);
	const capture = join(root, "request.json");
	const preload = join(root, "transport.mjs");
	await writeFile(
		preload,
		`import { appendFileSync, writeFileSync } from 'node:fs';
const setTimer = globalThis.setTimeout;
globalThis.setTimeout = (callback, ms, ...args) => {
  writeFileSync(process.env.CAPTURE + '.timeout', String(ms));
  return setTimer(callback, process.env.TRANSPORT === 'timeout' ? 35 : ms, ...args);
};
globalThis.fetch = async (url, options) => {
  appendFileSync(process.env.CAPTURE + '.requests', JSON.stringify({ url: String(url), headers: options.headers, body: options.body }) + '\\n');
  writeFileSync(process.env.CAPTURE, JSON.stringify({
    url: String(url), method: options.method, redirect: options.redirect,
    headers: options.headers, body: options.body, argv: process.argv,
    hasSignal: options.signal instanceof AbortSignal,
  }));
  if (process.env.TRANSPORT === 'timeout') return new Promise(() => {});
  if (process.env.TRANSPORT === 'error') throw new Error(options.headers.Authorization + ' ' + url);
  return {
    status: Number(process.env.HTTP_STATUS ?? '204'),
    get body() { throw new Error('response bodies must not be read'); },
  };
};
`,
	);
	const env: NodeJS.ProcessEnv = {
		PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
		HOME: home,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		NODE_OPTIONS: `--import=${preload}`,
		CAPTURE: capture,
	};
	return {
		root,
		home,
		capture,
		env,
		async config(path: string, content = `TONY_FINISH_WEBHOOK_URL='${DESTINATION}'\nexport TONY_FINISH_WEBHOOK_AUTH="${AUTH}"\n`) {
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, content, { mode: 0o600 });
			return path;
		},
		git(cwd: string, ...args: readonly string[]) {
			return execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
		},
		run(override: NodeJS.ProcessEnv = {}, cwd = root, args = ["label", "done", "topic"]) {
			const result = spawnSync(HELPER, args, { cwd, env: { ...env, ...override }, encoding: "utf8", timeout: 4000 });
			assert.ifError(result.error);
			assert.equal(result.signal, null);
			assert.doesNotMatch(result.stdout + result.stderr, /synthetic-secret|private-destination|finish\.example\.test/);
			return result;
		},
		request() {
			return JSON.parse(readFileSync(capture, "utf8"));
		},
		cleanup: () => rm(root, { recursive: true, force: true }),
	};
}

test("helper safely encodes all CLI fields, sends Bearer in memory, and reports only HTTP acceptance", async (t) => {
	const f = await fixture();
	t.after(f.cleanup);
	const path = await f.config(join(f.root, "private config.env"));
	const args = ['job "quoted"\\\n\t🙂', "done\r\n", 'feature/\\branch"\n'];
	const result = f.run({ TONY_FINISH_WEBHOOK_ENV: path }, f.root, args);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout, "finish webhook: accepted (HTTP 204)\n");
	assert.equal(result.stderr, "");
	const request = f.request();
	assert.deepEqual(JSON.parse(request.body), { job: args[0], status: args[1], branch: args[2] });
	assert.deepEqual(request.headers, { Authorization: AUTH, "Content-Type": "application/json" });
	assert.equal(request.url, DESTINATION);
	assert.equal(request.method, "POST");
	assert.equal(request.redirect, "manual");
	assert.equal(request.hasSignal, true);
	assert.deepEqual(request.argv.slice(2), args);
	assert.ok(!request.argv.join(" ").includes(AUTH));
	assert.equal(readFileSync(`${f.capture}.timeout`, "utf8"), "10000");
});

test("explicit targets fan out to two bot routes without sending to legacy Tony", async (t) => {
	const f = await fixture();
	t.after(f.cleanup);
	const targets = [
		{ url: "https://finish.example.test/grok-one", auth: AUTH },
		{ url: "https://finish.example.test/grok-two", auth: "Bearer second-synthetic-secret" },
	];
	const path = await f.config(join(f.root, "multi.env"), `LIMEN_FINISH_WEBHOOK_TARGETS='${JSON.stringify(targets)}'\nTONY_FINISH_WEBHOOK_URL='${DESTINATION}'\nTONY_FINISH_WEBHOOK_AUTH='${AUTH}'\n`);
	const result = f.run({ TONY_FINISH_WEBHOOK_ENV: path });
	assert.equal(result.status, 0, result.stderr);
	const requests = readFileSync(`${f.capture}.requests`, "utf8").trim().split("\n").map((line) => JSON.parse(line));
	assert.deepEqual(requests.map(({ url, headers }) => ({ url, auth: headers.Authorization })), targets);
	for (const request of requests) assert.deepEqual(JSON.parse(request.body), { job: "label", status: "done", branch: "topic" });
	assert.match(result.stdout, /target 1 accepted \(HTTP 204\); owner wake unobserved/);
	assert.match(result.stdout, /target 2 accepted \(HTTP 204\); owner wake unobserved/);
});

test("helper rejects missing, raw, Basic and malformed Bearer auth before transport", async (t) => {
	const invalid = [
		undefined,
		"",
		"synthetic-secret",
		"Basic synthetic-secret",
		"bearer synthetic-secret",
		"Bearer",
		"Bearer ",
		"Bearer  synthetic-secret",
		"Bearer synthetic-secret extra",
		"Bearer synthetic-secret=bad",
		"Bearer synthetic-secret\n",
		"Bearer synthetic-secret\r\nX-Evil: yes",
		"Bearer synthetic-secret\t",
		"Bearer sécret",
	];
	for (const auth of invalid) {
		await t.test(JSON.stringify(auth) ?? "missing", async (t) => {
			const f = await fixture();
			t.after(f.cleanup);
			const path = await f.config(join(f.root, "invalid.env"), `TONY_FINISH_WEBHOOK_URL='${DESTINATION}'\n${auth === undefined ? "" : `TONY_FINISH_WEBHOOK_AUTH='${auth}'`}\n`);
			const result = f.run({ TONY_FINISH_WEBHOOK_ENV: path, TONY_FINISH_WEBHOOK_AUTH: AUTH });
			assert.equal(result.status, 1);
			assert.match(result.stderr, /must be a complete Bearer value/);
			assert.equal(existsSync(f.capture), false);
		});
	}
});

test("helper rejects missing or unsafe destinations without revealing their contents", async (t) => {
	for (const url of [
		"",
		"not-a-url",
		"http://finish.example.test",
		"ftp://finish.example.test",
		"https://user:synthetic-secret@finish.example.test",
		"https://finish.example.test/#synthetic-secret",
	]) {
		await t.test(url, async (t) => {
			const f = await fixture();
			t.after(f.cleanup);
			const path = await f.config(join(f.root, "invalid.env"), `TONY_FINISH_WEBHOOK_AUTH='${AUTH}'\nTONY_FINISH_WEBHOOK_URL='${url}'\n`);
			assert.equal(f.run({ TONY_FINISH_WEBHOOK_ENV: path }).status, 1);
			assert.equal(existsSync(f.capture), false);
		});
	}
});

test("helper fails redirects, non-2xx, transport errors and a bounded stalled request", async (t) => {
	for (const status of [200, 299, 300, 302, 307, 400, 401, 500]) {
		await t.test(`HTTP ${status}`, async (t) => {
			const f = await fixture();
			t.after(f.cleanup);
			const path = await f.config(join(f.root, "config.env"));
			const result = f.run({ TONY_FINISH_WEBHOOK_ENV: path, HTTP_STATUS: String(status) });
			assert.equal(result.status, status < 300 ? 0 : 1);
			assert.match(result.stdout + result.stderr, new RegExp(`HTTP ${status}`));
			assert.equal(f.request().redirect, "manual");
		});
	}
	for (const transport of ["error", "timeout"]) {
		await t.test(transport, async (t) => {
			const f = await fixture();
			t.after(f.cleanup);
			const path = await f.config(join(f.root, "config.env"));
			const result = f.run({ TONY_FINISH_WEBHOOK_ENV: path, TRANSPORT: transport });
			assert.equal(result.status, 1);
			assert.match(result.stderr, transport === "timeout" ? /timed out after 10000ms/ : /request failed/);
			assert.equal(readFileSync(`${f.capture}.timeout`, "utf8"), "10000");
		});
	}
});

test("absolute override wins; missing, empty and relative overrides never fall back", async (t) => {
	const f = await fixture();
	t.after(f.cleanup);
	await f.config(join(f.home, ".overment", "tony-finish-webhook.env"));
	const selected = await f.config(join(f.root, "explicit.env"), `TONY_FINISH_WEBHOOK_URL='https://explicit.example.test'\nTONY_FINISH_WEBHOOK_AUTH='${AUTH}'\n`);
	assert.equal(f.run({ TONY_FINISH_WEBHOOK_ENV: selected }).status, 0);
	assert.equal(f.request().url, "https://explicit.example.test/");
	await rm(f.capture);
	for (const override of ["", "explicit.env", join(f.root, "missing.env"), f.root]) {
		assert.equal(f.run({ TONY_FINISH_WEBHOOK_ENV: override }).status, 1);
		assert.equal(existsSync(f.capture), false);
	}
});

test("Git common directory selects the canonical project's config from an external worktree", async (t) => {
	const f = await fixture();
	t.after(f.cleanup);
	const repo = join(f.root, "canonical repo");
	await mkdir(repo);
	f.git(repo, "init", "-b", "main");
	f.git(repo, "-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.test", "commit", "--allow-empty", "-m", "initial");
	const worktree = join(f.root, "outside checkout");
	f.git(repo, "worktree", "add", "-b", "topic", worktree);
	const nested = join(worktree, "nested");
	await mkdir(nested);
	await f.config(join(f.home, ".overment", "tony-finish-webhook.env"));
	await f.config(join(worktree, ".limen", "finish-webhook.env"));
	assert.equal(f.run({}, nested).status, 1, "missing canonical config must not use worktree or home config");
	assert.equal(existsSync(f.capture), false);
	const canonical = await f.config(join(repo, ".limen", "finish-webhook.env"), `TONY_FINISH_WEBHOOK_URL='https://canonical.example.test'\nTONY_FINISH_WEBHOOK_AUTH='${AUTH}'\n`);
	assert.equal(f.run({}, nested).status, 0);
	assert.equal(f.request().url, "https://canonical.example.test/");
	assert.equal(f.run({}, repo).status, 0);
	assert.equal(f.request().url, "https://canonical.example.test/");
	const selected = await f.config(join(f.root, "selected.env"));
	assert.equal(f.run({ TONY_FINISH_WEBHOOK_ENV: selected }, nested).status, 0);
	assert.equal(f.request().url, DESTINATION);
	await f.config(canonical, "# empty config\n");
	await rm(f.capture);
	assert.equal(f.run({}, nested).status, 1);
	assert.equal(existsSync(f.capture), false);
});

test("legacy home config is available only for manual invocation outside Git, not inherited credentials", async (t) => {
	const f = await fixture();
	t.after(f.cleanup);
	assert.equal(f.run({ TONY_FINISH_WEBHOOK_URL: DESTINATION, TONY_FINISH_WEBHOOK_AUTH: AUTH }).status, 1);
	assert.equal(existsSync(f.capture), false);
	await f.config(join(f.home, ".overment", "tony-finish-webhook.env"));
	assert.equal(f.run().status, 0);
	assert.equal(f.request().url, DESTINATION);
});

test("env files are data, never shell scripts, and the CLI requires exactly three arguments", async (t) => {
	const f = await fixture();
	t.after(f.cleanup);
	const marker = join(f.root, "executed");
	const path = await f.config(join(f.root, "shell.env"), `touch '${marker}'\nTONY_FINISH_WEBHOOK_URL='${DESTINATION}'\nTONY_FINISH_WEBHOOK_AUTH="Bearer $(touch '${marker}')"\n`);
	assert.equal(f.run({ TONY_FINISH_WEBHOOK_ENV: path }).status, 1);
	assert.equal(existsSync(marker), false);
	assert.equal(existsSync(f.capture), false);
	for (const args of [[], ["label"], ["label", "done"], ["label", "done", "branch", "extra"]]) {
		const result = f.run({ TONY_FINISH_WEBHOOK_ENV: path }, f.root, args);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /usage:/);
	}
});
