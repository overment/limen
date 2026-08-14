import assert from "node:assert/strict";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import limenWake from "../hook/wake.ts";

type TestContext = {
	readonly cwd: string;
	isIdle(): boolean;
	readonly ui: {
		notify(message: string, level: "info"): void;
		setStatus(key: string, value: string | undefined): void;
	};
};

test("wake ignores history, announces start, and steers once on terminal change", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	stashEnv(context, "LIMEN_HERDR", "0");
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-wake-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	const jobs = join(root, ".limen/jobs");
	await mkdir(join(jobs, "old"), { recursive: true });
	await writeFile(join(jobs, "old/state"), "done\n");
	await writeFile(join(jobs, "old/branch"), "old-branch\n");
	const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
	const notifications: string[] = [];
	const statuses: Array<string | undefined> = [];
	const messages: Array<{ content: string; deliverAs?: string }> = [];
	limenWake({
		on(event, handler) {
			handlers.set(event, handler);
		},
		sendUserMessage(content, options) {
			messages.push({ content, ...(options ? { deliverAs: options.deliverAs } : {}) });
		},
	});
	const session = {
		cwd: root,
		isIdle: () => false,
		ui: {
			notify: (message: string) => notifications.push(message),
			setStatus: (_key: string, value: string | undefined) => statuses.push(value),
		},
	};
	handlers.get("session_start")?.({}, session);
	context.after(() => handlers.get("session_shutdown")?.({}, session));
	assert.deepEqual(messages, []);
	await mkdir(join(jobs, "new"));
	await writeFile(join(jobs, "new/label"), "F001 implementation\n");
	await writeFile(join(jobs, "new/branch"), "candidate\n");
	await writeFile(join(jobs, "new/state"), "running\n");
	await waitUntil(() => notifications.length === 1);
	assert.deepEqual(notifications, ["limen: F001 implementation started (new)"]);
	await writeFile(join(jobs, "new/activity"), "tool\n");
	await writeFile(join(jobs, "new/last-tool"), "bash\n");
	await waitUntil(() => new Set(statuses.filter((value) => value?.includes("limen 1 · F001 starting"))).size >= 2);
	assert.match(statuses.find((value) => value?.includes("limen 1 · F001 starting")) ?? "", /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] /);
	await writeFile(join(jobs, "new/state"), "done\n");
	await waitUntil(() => messages.length === 1);
	assert.equal(statuses.at(-1), undefined);
	assert.deepEqual(messages, [
		{
			content: "limen: F001 implementation is done (new); inspect .limen/jobs/new/ and branch candidate.",
			deliverAs: "steer",
		},
	]);
	await writeFile(join(jobs, "new/state"), "failed\n");
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.equal(messages.length, 1, "a corrected terminal state must not send another wake");
	handlers.get("session_shutdown")?.({}, session);
	assert.deepEqual((await import("node:fs/promises").then(({ readdir }) => readdir(join(jobs, "new")))).sort(), ["activity", "branch", "label", "last-tool", "state"]);
});

test("wake recreates the ignored jobs directory on session start", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	stashEnv(context, "LIMEN_HERDR", "0");
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-wake-empty-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
	limenWake({
		on(event, handler) {
			handlers.set(event, handler);
		},
		sendUserMessage() {},
	});
	const session = { cwd: root, isIdle: () => true, ui: { notify() {}, setStatus() {} } };
	handlers.get("session_start")?.({}, session);
	context.after(() => handlers.get("session_shutdown")?.({}, session));
	await import("node:fs/promises").then(({ access }) => access(join(root, ".limen/jobs")));
});

test("wake remains inert inside workers", () => {
	const inheritedJob = process.env.LIMEN_JOB;
	process.env.LIMEN_JOB = "1";
	try {
		const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
		const statuses: Array<string | undefined> = [];
		limenWake({
			on(event, handler) {
				handlers.set(event, handler);
			},
			sendUserMessage() {
				assert.fail("worker must not receive coordinator wakes");
			},
		});
		const session = {
			cwd: "/missing",
			isIdle: () => true,
			ui: { notify() {}, setStatus: (_key: string, value: string | undefined) => statuses.push(value) },
		};
		handlers.get("session_start")?.({}, session);
		handlers.get("session_shutdown")?.({}, session);
		assert.deepEqual(statuses, []);
	} finally {
		if (inheritedJob === undefined) delete process.env.LIMEN_JOB;
		else process.env.LIMEN_JOB = inheritedJob;
	}
});

test("wake stays out of foreign projects and honors LIMEN_WAKE=0", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	stashEnv(context, "LIMEN_HERDR", "0");
	const start = async (prepare: (root: string) => Promise<unknown>) => {
		const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-wake-inert-")));
		context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
		await prepare(root);
		const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
		const statuses: Array<string | undefined> = [];
		limenWake({
			on(event, handler) {
				handlers.set(event, handler);
			},
			sendUserMessage() {
				assert.fail("an inert session must not receive wakes");
			},
		});
		const session = { cwd: root, isIdle: () => true, ui: { notify() {}, setStatus: (_key: string, value: string | undefined) => statuses.push(value) } };
		handlers.get("session_start")?.({}, session);
		context.after(() => handlers.get("session_shutdown")?.({}, session));
		return { root, statuses };
	};
	const foreign = await start(async () => {});
	await assert.rejects(
		import("node:fs/promises").then(({ access }) => access(join(foreign.root, ".limen"))),
		"a project without .agents/limen must stay untouched",
	);
	assert.deepEqual(foreign.statuses, []);
	stashEnv(context, "LIMEN_WAKE", "0");
	const disabled = await start((root) => mkdir(join(root, ".agents/limen"), { recursive: true }));
	await assert.rejects(
		import("node:fs/promises").then(({ access }) => access(join(disabled.root, ".limen"))),
		"LIMEN_WAKE=0 must keep the session silent",
	);
	assert.deepEqual(disabled.statuses, []);
});

test("/limen off mutes the session and /limen on catches up once", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	stashEnv(context, "LIMEN_HERDR", "0");
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-mute-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	const jobs = join(root, ".limen/jobs");
	const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
	let command: ((args: string, context: { ui: { notify(message: string, level: "info"): void } }) => void) | undefined;
	const messages: string[] = [];
	const statuses: Array<string | undefined> = [];
	limenWake({
		on(event, handler) {
			handlers.set(event, handler);
		},
		sendUserMessage(content) {
			messages.push(content);
		},
		registerCommand(name, options) {
			assert.equal(name, "limen");
			command = options.handler;
		},
	});
	assert.ok(command, "the /limen command must register");
	const confirmations: string[] = [];
	const commandUi = { ui: { notify: (message: string) => confirmations.push(message) } };
	const session = { cwd: root, isIdle: () => true, ui: { notify() {}, setStatus: (_key: string, value: string | undefined) => statuses.push(value) } };
	handlers.get("session_start")?.({}, session);
	context.after(() => handlers.get("session_shutdown")?.({}, session));
	command("off", commandUi);
	assert.deepEqual(confirmations, ["limen wake off"]);
	await mkdir(join(jobs, "quiet"), { recursive: true });
	await writeFile(join(jobs, "quiet/label"), "F002 quiet work\n");
	await writeFile(join(jobs, "quiet/branch"), "candidate\n");
	await writeFile(join(jobs, "quiet/state"), "done\n");
	await new Promise((resolve) => setTimeout(resolve, 150));
	assert.deepEqual(messages, [], "a muted session must not receive wakes");
	assert.deepEqual(
		statuses.filter((value) => value !== undefined),
		[],
		"a muted session must not draw the footer",
	);
	command("on", commandUi);
	assert.deepEqual(confirmations, ["limen wake off", "limen wake on"]);
	await waitUntil(() => messages.length === 1);
	assert.match(messages[0] ?? "", /F002 quiet work is done \(quiet\)/);
	command("", commandUi);
	assert.equal(confirmations.at(-1), "limen wake off", "bare /limen must toggle");
});

test("herdr pane naming follows running jobs and each terminal state notifies once", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-herdr-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	const calls = join(root, "herdr-calls");
	await mkdir(calls);
	const fake = join(root, "herdr");
	await writeFile(fake, `#!/bin/sh\nout=$(mktemp "${calls}/call.XXXXXX")\nprintf '%s\\n' "$@" > "$out"\n`);
	await chmod(fake, 0o755);
	stashEnv(context, "LIMEN_HERDR", fake);
	stashEnv(context, "HERDR_ENV", "1");
	stashEnv(context, "HERDR_PANE_ID", "w1:p1");
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	const jobs = join(root, ".limen/jobs");
	const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
	limenWake({
		on(event, handler) {
			handlers.set(event, handler);
		},
		sendUserMessage() {},
	});
	const session = { cwd: root, isIdle: () => true, ui: { notify() {}, setStatus() {} } };
	handlers.get("session_start")?.({}, session);
	context.after(() => handlers.get("session_shutdown")?.({}, session));
	await mkdir(join(jobs, "new"), { recursive: true });
	await writeFile(join(jobs, "new/label"), "F001 implementation\n");
	await writeFile(join(jobs, "new/branch"), "candidate\n");
	await writeFile(join(jobs, "new/state"), "running\n");
	await waitUntilAsync(async () => (await readCalls(calls)).some((call) => call.includes("limen=1 · F001 starting")));
	const naming = (await readCalls(calls)).find((call) => call.includes("limen=1 · F001 starting"));
	assert.ok(naming, "pane metadata call expected");
	assert.deepEqual(naming.slice(0, 5), ["pane", "report-metadata", "w1:p1", "--source", "limen"]);
	const tokenAt = naming.indexOf("limen=1 · F001 starting");
	assert.equal(naming[tokenAt - 1], "--token");
	assert.equal(naming[tokenAt + 1], "--ttl-ms");
	await writeFile(join(jobs, "new/state"), "done\n");
	await waitUntilAsync(async () => (await readCalls(calls)).some((call) => call[0] === "notification"));
	await waitUntilAsync(async () => (await readCalls(calls)).some((call) => call.includes("--clear-token")));
	const done = (await readCalls(calls)).filter((call) => call[0] === "notification");
	assert.equal(done.length, 1, "one notification per terminal state");
	assert.deepEqual(done[0], ["notification", "show", "limen: F001 implementation is done", "--body", "job new · branch candidate", "--sound", "done"]);
	const clear = (await readCalls(calls)).find((call) => call.includes("--clear-token"));
	assert.ok(clear, "clear-token call expected");
	assert.deepEqual(clear.slice(0, 5), ["pane", "report-metadata", "w1:p1", "--source", "limen"]);
	assert.equal(clear[clear.indexOf("--clear-token") + 1], "limen");
});

function stashEnv(context: { after(fn: () => void): void }, name: string, value: string | undefined): void {
	const inherited = process.env[name];
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
	context.after(() => {
		if (inherited === undefined) delete process.env[name];
		else process.env[name] = inherited;
	});
}

async function readCalls(directory: string): Promise<string[][]> {
	const { readdir } = await import("node:fs/promises");
	const names = await readdir(directory).catch(() => [] as string[]);
	const calls = await Promise.all(names.sort().map((name) => readFile(join(directory, name), "utf8").catch(() => "")));
	return calls.filter((call) => call !== "").map((call) => call.split("\n").filter((line) => line !== ""));
}

async function waitUntilAsync(predicate: () => Promise<boolean>): Promise<void> {
	const deadline = Date.now() + 2_000;
	while (!(await predicate()) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
	assert.ok(await predicate(), "timed out waiting for herdr call");
}

async function waitUntil(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 2_000;
	while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
	assert.ok(predicate(), "timed out waiting for wake event");
}
