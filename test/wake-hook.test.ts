import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import limenWake from "../hook/wake.ts";

const WAKE_HOME = await mkdtemp(join(tmpdir(), "limen-wake-home-"));
const PREVIOUS_LIMEN_HOME = process.env.LIMEN_HOME;
process.env.LIMEN_HOME = WAKE_HOME;
test.after(async () => {
	if (PREVIOUS_LIMEN_HOME === undefined) delete process.env.LIMEN_HOME;
	else process.env.LIMEN_HOME = PREVIOUS_LIMEN_HOME;
	await rm(WAKE_HOME, { recursive: true, force: true });
});

type TestContext = {
	readonly cwd: string;
	isIdle(): boolean;
	readonly sessionManager: { getSessionId(): string };
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
		// Wake delivery must still be explicitly steered if this check says idle:
		// the agent may begin another prompt before the extension hands it to Pi.
		isIdle: () => true,
		sessionManager: sessionManager("coordinator-a"),
		ui: {
			notify: (message: string) => notifications.push(message),
			setStatus: (_key: string, value: string | undefined) => statuses.push(value),
		},
	};
	handlers.get("session_start")?.({}, session);
	context.after(() => handlers.get("session_shutdown")?.({}, session));
	await waitUntilAsync(async () => (await readFile(join(WAKE_HOME, ".limen/projects"), "utf8").catch(() => "")).split("\n").includes(root));
	assert.equal(messages.length, 0);
	await mkdir(join(jobs, "new"));
	await writeFile(join(jobs, "new/label"), "F001 implementation\n");
	await writeFile(join(jobs, "new/branch"), "candidate\n");
	await subscribe(jobs, "new", "coordinator-a");
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
	// Idle coordinators get a normal user message (visible turn), not a buried steer.
	assert.equal(messages[0]?.deliverAs, undefined);
	assert.match(messages[0]?.content ?? "", /Limen job "F001 implementation" is done \(new\).*take the next safe step.*ask only when genuine product ambiguity/);
	assert.ok(notifications.some((value) => value.includes("is done (new)")));
	await writeFile(join(jobs, "new/state"), "failed\n");
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.equal(messages.length, 1, "a corrected terminal state must not send another wake");
	handlers.get("session_shutdown")?.({}, session);
	assert.deepEqual((await import("node:fs/promises").then(({ readdir }) => readdir(join(jobs, "new")))).sort(), ["activity", "branch", "label", "last-tool", "notify", "state"]);
});

test("a completion wake carries bounded commits and the worker's final message", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	stashEnv(context, "LIMEN_HERDR", "0");
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-wake-handoff-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	const jobs = join(root, ".limen/jobs");
	const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
	const messages: string[] = [];
	limenWake({
		on(event, handler) {
			handlers.set(event, handler);
		},
		sendUserMessage(content) {
			messages.push(content);
		},
	});
	const session = { cwd: root, isIdle: () => true, sessionManager: sessionManager("coordinator-a"), ui: { notify() {}, setStatus() {} } };
	handlers.get("session_start")?.({}, session);
	context.after(() => handlers.get("session_shutdown")?.({}, session));
	await mkdir(join(jobs, "handoff"), { recursive: true });
	await writeFile(join(jobs, "handoff/label"), "F017 handoff\n");
	await writeFile(join(jobs, "handoff/branch"), "limen/handoff\n");
	await subscribe(jobs, "handoff", "coordinator-a");
	await writeFile(join(jobs, "handoff/state"), "running\n");
	const commitLines = Array.from({ length: 12 }, (_, index) => `${(index + 1).toString(16).padStart(7, "0")} commit ${index + 1}`);
	await writeFile(join(jobs, "handoff/commits"), `${commitLines.join("\n")}\n`);
	const resultLines = Array.from({ length: 20 }, (_, index) => `result line ${index + 1}`);
	await writeFile(join(jobs, "handoff/result"), `${resultLines.join("\n")}\n`);
	await writeFile(join(jobs, "handoff/stop-reason"), "error: usage limit reached\n");
	await mkdir(join(jobs, "handoff/steer/inbox"), { recursive: true });
	await writeFile(join(jobs, "handoff/steer/inbox/0001"), "turn left\n");
	await writeFile(join(jobs, "handoff/state"), "done\n");
	await waitUntil(() => messages.length === 1);
	const wake = messages[0] ?? "";
	assert.match(wake, /Stop reason: error: usage limit reached/);
	assert.match(wake, /1 steer\(s\) never delivered/);
	assert.match(wake, /Commits:\n0000001 commit 1/);
	assert.match(wake, /000000a commit 10\n… 2 more/);
	assert.doesNotMatch(wake, /commit 11/);
	assert.match(wake, /Final message:\nresult line 1\n/);
	assert.match(wake, /result line 15\n…/);
	assert.doesNotMatch(wake, /result line 16/);
	assert.match(wake, /Inspect the job record/, "the pointer sentence stays");
	// A stopped job without commits or result keeps a plain state-only wake.
	await mkdir(join(jobs, "bare"), { recursive: true });
	await writeFile(join(jobs, "bare/label"), "F017 bare\n");
	await writeFile(join(jobs, "bare/branch"), "limen/bare\n");
	await subscribe(jobs, "bare", "coordinator-a");
	await writeFile(join(jobs, "bare/state"), "stopped\n");
	await waitUntil(() => messages.length === 2);
	assert.doesNotMatch(messages[1] ?? "", /Commits:|Final message:|Stop reason:|never delivered/);
});

test("a completion wake says when a terminal job produced nothing", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	stashEnv(context, "LIMEN_HERDR", "0");
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-wake-empty-handoff-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	const jobs = join(root, ".limen/jobs");
	const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
	const messages: string[] = [];
	limenWake({
		on(event, handler) {
			handlers.set(event, handler);
		},
		sendUserMessage(content) {
			messages.push(content);
		},
	});
	const session = { cwd: root, isIdle: () => true, sessionManager: sessionManager("coordinator-a"), ui: { notify() {}, setStatus() {} } };
	handlers.get("session_start")?.({}, session);
	context.after(() => handlers.get("session_shutdown")?.({}, session));

	const empty = join(jobs, "empty");
	await mkdir(empty, { recursive: true });
	await writeFile(join(empty, "label"), "F011 empty\n");
	await writeFile(join(empty, "branch"), "limen/empty\n");
	await writeFile(join(empty, "tool-calls"), "0\n");
	await writeFile(join(empty, "commits"), "");
	await writeFile(join(empty, "stop-reason"), "error: usage limit reached\n");
	await subscribe(jobs, "empty", "coordinator-a");
	await writeFile(join(empty, "state"), "done\n");
	await waitUntil(() => messages.length === 1);
	assert.match(messages[0] ?? "", /is done \(empty\).*It produced nothing \(0 tool calls, no commits\)/);
	assert.match(messages[0] ?? "", /Stop reason: error: usage limit reached/);

	const survey = join(jobs, "survey");
	await mkdir(survey, { recursive: true });
	await writeFile(join(survey, "label"), "F011 survey\n");
	await writeFile(join(survey, "branch"), "limen/survey\n");
	await writeFile(join(survey, "tool-calls"), "1\n");
	await writeFile(join(survey, "commits"), "");
	await subscribe(jobs, "survey", "coordinator-a");
	await writeFile(join(survey, "state"), "done\n");
	await waitUntil(() => messages.length === 2);
	assert.doesNotMatch(messages[1] ?? "", /produced nothing/);
});

test("wake shows existing unwatched jobs without claiming their notifications", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	stashEnv(context, "LIMEN_HERDR", "0");
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-wake-unwatched-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	const jobs = join(root, ".limen/jobs");
	const job = join(jobs, "existing");
	await mkdir(job, { recursive: true });
	await writeFile(join(job, "label"), "F005 existing review\n");
	await writeFile(join(job, "branch"), "candidate\n");
	await writeFile(join(job, "state"), "running\n");
	const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
	const notices: string[] = [];
	const statuses: Array<string | undefined> = [];
	const messages: string[] = [];
	limenWake({
		on(event, handler) {
			handlers.set(event, handler);
		},
		sendUserMessage(content) {
			messages.push(content);
		},
	});
	const session = {
		cwd: root,
		isIdle: () => true,
		sessionManager: sessionManager("coordinator-b"),
		ui: { notify: (message: string) => notices.push(message), setStatus: (_key: string, value: string | undefined) => statuses.push(value) },
	};
	handlers.get("session_start")?.({}, session);
	context.after(() => handlers.get("session_shutdown")?.({}, session));
	await waitUntil(() => statuses.some((status) => status?.includes("limen 1 · F005 starting (unwatched)")) ?? false);
	assert.deepEqual(notices, []);
	assert.deepEqual(messages, []);
	await assert.rejects(import("node:fs/promises").then(({ access }) => access(join(job, "notify/subscribers/coordinator-b"))));
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
	const session = { cwd: root, isIdle: () => true, sessionManager: sessionManager("coordinator-a"), ui: { notify() {}, setStatus() {} } };
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
			sessionManager: sessionManager("coordinator-a"),
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
		const session = {
			cwd: root,
			isIdle: () => true,
			sessionManager: sessionManager("coordinator-a"),
			ui: { notify() {}, setStatus: (_key: string, value: string | undefined) => statuses.push(value) },
		};
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

test("wake finds the project root from a subdirectory", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	stashEnv(context, "LIMEN_HERDR", "0");
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-wake-subdir-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	await mkdir(join(root, "src"), { recursive: true });
	const jobs = join(root, ".limen/jobs");
	const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
	const messages: string[] = [];
	const statuses: Array<string | undefined> = [];
	limenWake({
		on(event, handler) {
			handlers.set(event, handler);
		},
		sendUserMessage(content) {
			messages.push(content);
		},
	});
	const session = {
		cwd: join(root, "src"),
		isIdle: () => true,
		sessionManager: sessionManager("coordinator-a"),
		ui: { notify() {}, setStatus: (_key: string, value: string | undefined) => statuses.push(value) },
	};
	handlers.get("session_start")?.({}, session);
	context.after(() => handlers.get("session_shutdown")?.({}, session));
	await import("node:fs/promises").then(({ access }) => access(jobs));
	await mkdir(join(jobs, "sub"), { recursive: true });
	await writeFile(join(jobs, "sub/label"), "F023 from src\n");
	await writeFile(join(jobs, "sub/branch"), "candidate\n");
	await subscribe(jobs, "sub", "coordinator-a");
	await writeFile(join(jobs, "sub/state"), "running\n");
	await waitUntil(() => statuses.some((status) => status?.includes("limen 1 · F023 starting")) ?? false);
	await writeFile(join(jobs, "sub/state"), "done\n");
	await waitUntil(() => messages.length === 1);
	assert.match(messages[0] ?? "", /F023 from src.*is done \(sub\)/);
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
	const session = {
		cwd: root,
		isIdle: () => true,
		sessionManager: sessionManager("coordinator-a"),
		ui: { notify() {}, setStatus: (_key: string, value: string | undefined) => statuses.push(value) },
	};
	handlers.get("session_start")?.({}, session);
	context.after(() => handlers.get("session_shutdown")?.({}, session));
	command("off", commandUi);
	assert.deepEqual(confirmations, ["limen wake off"]);
	await mkdir(join(jobs, "quiet"), { recursive: true });
	await writeFile(join(jobs, "quiet/label"), "F002 quiet work\n");
	await writeFile(join(jobs, "quiet/branch"), "candidate\n");
	await subscribe(jobs, "quiet", "coordinator-a");
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
	assert.match(messages[0] ?? "", /F002 quiet work.*is done \(quiet\)/);
	command("", commandUi);
	assert.equal(confirmations.at(-1), "limen wake off", "bare /limen must toggle");
});

test("subscriptions scope wakes and one idle coordinator receives fallback", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	stashEnv(context, "LIMEN_HERDR", "0");
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-routing-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	const jobs = join(root, ".limen/jobs");
	const handlersA = new Map<string, (event: unknown, context: TestContext) => void>();
	const handlersB = new Map<string, (event: unknown, context: TestContext) => void>();
	const messagesA: string[] = [];
	const messagesB: string[] = [];
	const startsA: string[] = [];
	const startsB: string[] = [];
	limenWake({
		on(event, handler) {
			handlersA.set(event, handler);
		},
		sendUserMessage(content) {
			messagesA.push(content);
		},
	});
	limenWake({
		on(event, handler) {
			handlersB.set(event, handler);
		},
		sendUserMessage(content) {
			messagesB.push(content);
		},
	});
	const sessionA = {
		cwd: root,
		isIdle: () => true,
		sessionManager: sessionManager("coordinator-a"),
		ui: { notify: (message: string) => startsA.push(message), setStatus() {} },
	};
	const sessionB = {
		cwd: root,
		isIdle: () => true,
		sessionManager: sessionManager("coordinator-b"),
		ui: { notify: (message: string) => startsB.push(message), setStatus() {} },
	};
	handlersA.get("session_start")?.({}, sessionA);
	handlersB.get("session_start")?.({}, sessionB);
	context.after(() => handlersA.get("session_shutdown")?.({}, sessionA));
	context.after(() => handlersB.get("session_shutdown")?.({}, sessionB));

	await mkdir(join(jobs, "owned"), { recursive: true });
	await writeFile(join(jobs, "owned/label"), "F010 owned\n");
	await writeFile(join(jobs, "owned/branch"), "candidate-owned\n");
	await subscribe(jobs, "owned", "coordinator-a");
	await writeFile(join(jobs, "owned/state"), "running\n");
	await waitUntil(() => startsA.length === 1);
	assert.deepEqual(startsB, []);
	await writeFile(join(jobs, "owned/state"), "done\n");
	await waitUntil(() => messagesA.length === 1);
	assert.deepEqual(messagesB, []);

	await mkdir(join(jobs, "shared"), { recursive: true });
	await writeFile(join(jobs, "shared/label"), "F011 shared\n");
	await writeFile(join(jobs, "shared/branch"), "candidate-shared\n");
	await subscribe(jobs, "shared", "coordinator-a");
	await subscribe(jobs, "shared", "coordinator-b");
	await writeFile(join(jobs, "shared/state"), "done\n");
	await waitUntil(() => messagesA.length === 2 && messagesB.length === 1);

	await mkdir(join(jobs, "fallback"), { recursive: true });
	await writeFile(join(jobs, "fallback/label"), "F012 fallback\n");
	await writeFile(join(jobs, "fallback/branch"), "candidate-fallback\n");
	await subscribe(jobs, "fallback", "closed-session");
	await writeFile(join(jobs, "fallback/finished-at"), "2000-01-01T00:00:00.000Z\n");
	await writeFile(join(jobs, "fallback/state"), "done\n");
	await waitUntil(() => messagesA.length + messagesB.length === 4);
	const fallback = [...messagesA, ...messagesB].find((message) => message.includes("routed here"));
	assert.ok(fallback, "one idle unrelated coordinator must receive the fallback handoff");

	handlersA.get("session_shutdown")?.({}, sessionA);
	handlersB.get("session_shutdown")?.({}, sessionB);
	await mkdir(join(jobs, "pending"), { recursive: true });
	await writeFile(join(jobs, "pending/label"), "F013 pending\n");
	await writeFile(join(jobs, "pending/branch"), "candidate-pending\n");
	await subscribe(jobs, "pending", "closed-session");
	await writeFile(join(jobs, "pending/finished-at"), "2000-01-01T00:00:00.000Z\n");
	await writeFile(join(jobs, "pending/state"), "done\n");
	const handlersC = new Map<string, (event: unknown, context: TestContext) => void>();
	const messagesC: string[] = [];
	limenWake({
		on(event, handler) {
			handlersC.set(event, handler);
		},
		sendUserMessage(content) {
			messagesC.push(content);
		},
	});
	const sessionC = { cwd: root, isIdle: () => true, sessionManager: sessionManager("coordinator-c"), ui: { notify() {}, setStatus() {} } };
	handlersC.get("session_start")?.({}, sessionC);
	context.after(() => handlersC.get("session_shutdown")?.({}, sessionC));
	await waitUntil(() => messagesC.length === 1);
	assert.match(messagesC[0] ?? "", /F013 pending.*routed here/);
});

test("already-delivered jobs never re-enter the fallback claim path", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	stashEnv(context, "LIMEN_HERDR", "0");
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-wake-delivered-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	const jobs = join(root, ".limen/jobs");
	const job = join(jobs, "old");
	await mkdir(join(job, "notify/delivered"), { recursive: true });
	await mkdir(join(job, "notify/subscribers"), { recursive: true });
	await writeFile(join(job, "label"), "F023 already delivered\n");
	await writeFile(join(job, "branch"), "old-branch\n");
	await writeFile(join(job, "state"), "done\n");
	await writeFile(join(job, "finished-at"), "2000-01-01T00:00:00.000Z\n");
	await writeFile(join(job, "notify/ready"), "1\n");
	await writeFile(join(job, "notify/subscribers/old-session"), "1\n");
	await writeFile(join(job, "notify/delivered/old-session"), "1\n");
	const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
	const messages: string[] = [];
	limenWake({
		on(event, handler) {
			handlers.set(event, handler);
		},
		sendUserMessage(content) {
			messages.push(content);
		},
	});
	const session = { cwd: root, isIdle: () => true, sessionManager: sessionManager("coordinator-new"), ui: { notify() {}, setStatus() {} } };
	handlers.get("session_start")?.({}, session);
	context.after(() => handlers.get("session_shutdown")?.({}, session));
	const seen: string[] = [];
	const { watch, existsSync, readdirSync } = await import("node:fs");
	const watcher = watch(join(job, "notify"), { recursive: true }, (_event, filename) => {
		if (filename && (filename === "claims" || filename.startsWith("claims/") || filename.includes("/claims"))) seen.push(String(filename));
	});
	context.after(() => watcher.close());
	await new Promise((resolve) => setTimeout(resolve, 1600));
	assert.deepEqual(messages, []);
	assert.equal(existsSync(join(job, "notify/claims")), false, "repeated sweeps must not create notify/claims");
	assert.deepEqual(seen, [], "the claims directory must stay untouched");
	assert.deepEqual(readdirSync(join(job, "notify/delivered")), ["old-session"]);
});

test("two windows on one Pi session share start and completion receipts", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	stashEnv(context, "LIMEN_HERDR", "0");
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-same-session-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	const jobs = join(root, ".limen/jobs");
	const handlers = [new Map<string, (event: unknown, context: TestContext) => void>(), new Map<string, (event: unknown, context: TestContext) => void>()];
	const starts: string[] = [];
	const messages: string[] = [];
	for (const events of handlers) {
		limenWake({
			on(event, handler) {
				events.set(event, handler);
			},
			sendUserMessage(content) {
				messages.push(content);
			},
		});
	}
	const sessions = handlers.map((_events, index) => ({
		cwd: root,
		isIdle: () => true,
		sessionManager: sessionManager("coordinator-shared"),
		ui: { notify: (message: string) => starts.push(`${index}:${message}`), setStatus() {} },
	}));
	for (const [index, events] of handlers.entries()) events.get("session_start")?.({}, sessions[index] as TestContext);
	context.after(() => {
		for (const [index, events] of handlers.entries()) events.get("session_shutdown")?.({}, sessions[index] as TestContext);
	});
	await mkdir(join(jobs, "shared-window"), { recursive: true });
	await writeFile(join(jobs, "shared-window/label"), "F014 shared window\n");
	await writeFile(join(jobs, "shared-window/branch"), "candidate-shared-window\n");
	await subscribe(jobs, "shared-window", "coordinator-shared");
	await writeFile(join(jobs, "shared-window/state"), "running\n");
	await waitUntil(() => starts.length === 1);
	await writeFile(join(jobs, "shared-window/state"), "done\n");
	await waitUntil(() => messages.length === 1);
});

test("herdr pane naming follows running jobs and each terminal state notifies once", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-herdr-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	const calls = join(root, "herdr-calls");
	await mkdir(calls);
	const fake = join(root, "herdr");
	await writeFile(fake, `#!/bin/sh\nout="${calls}/call.$$"\nprintf '%s\\n' "$@" > "$out"\n`);
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
	const session = { cwd: root, isIdle: () => true, sessionManager: sessionManager("coordinator-a"), ui: { notify() {}, setStatus() {} } };
	handlers.get("session_start")?.({}, session);
	context.after(() => handlers.get("session_shutdown")?.({}, session));
	await mkdir(join(jobs, "new"), { recursive: true });
	await writeFile(join(jobs, "new/label"), "F001 implementation\n");
	await writeFile(join(jobs, "new/branch"), "candidate\n");
	await subscribe(jobs, "new", "coordinator-a");
	await writeFile(join(jobs, "new/state"), "running\n");
	await waitUntilAsync(async () => (await readCalls(calls)).some((call) => call.includes("limen=1 · F001 starting")));
	const naming = (await readCalls(calls)).find((call) => call.includes("limen=1 · F001 starting"));
	assert.ok(naming, "pane metadata call expected");
	assert.deepEqual(naming.slice(0, 5), ["pane", "report-metadata", "w1:p1", "--source", "limen"]);
	const titleAt = naming.indexOf("--title");
	assert.equal(naming[titleAt + 1], "Limen · F001 implementation");
	assert.equal(naming[naming.indexOf("--display-agent") + 1], "✦ Limen · 1 waking");
	const tokenAt = naming.indexOf("limen=1 · F001 starting");
	assert.equal(naming[tokenAt - 1], "--token");
	assert.equal(naming[tokenAt + 1], "--state-label");
	assert.equal(naming[tokenAt + 2], "idle=1 · F001 starting");
	assert.equal(naming[tokenAt + 4], "done=1 · F001 starting");
	assert.equal(naming[naming.indexOf("--ttl-ms") + 1], "180000");
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
	assert.ok(clear.includes("--clear-title"), "finished jobs must restore the pane's own title");
	assert.equal(clear[clear.indexOf("--display-agent") + 1], "Limen coordinator");
	assert.ok(clear.includes("--clear-state-labels"), "finished jobs must restore the pane's own state label");
	assert.equal(clear[clear.indexOf("--ttl-ms") + 1], "180000");
	handlers.get("session_shutdown")?.({}, session);
	await waitUntilAsync(async () => (await readCalls(calls)).some((call) => call.includes("--clear-display-agent")));
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
	const deadline = Date.now() + 5_000;
	while (!(await predicate()) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
	assert.ok(await predicate(), "timed out waiting for herdr call");
}

test("herdr surfaces stay live while the conversation is muted", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-herdr-mute-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	const calls = join(root, "herdr-calls");
	await mkdir(calls);
	const fake = join(root, "herdr");
	await writeFile(fake, `#!/bin/sh\nout="${calls}/call.$$"\nprintf '%s\\n' "$@" > "$out"\n`);
	await chmod(fake, 0o755);
	stashEnv(context, "LIMEN_HERDR", fake);
	stashEnv(context, "HERDR_ENV", "1");
	stashEnv(context, "HERDR_PANE_ID", "w1:p1");
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	const jobs = join(root, ".limen/jobs");
	const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
	let command: ((args: string, context: { ui: { notify(message: string, level: "info"): void } }) => void) | undefined;
	const messages: string[] = [];
	const notifications: string[] = [];
	const statuses: Array<string | undefined> = [];
	limenWake({
		on(event, handler) {
			handlers.set(event, handler);
		},
		sendUserMessage(content) {
			messages.push(content);
		},
		registerCommand(_name, options) {
			command = options.handler;
		},
	});
	assert.ok(command);
	const commandUi = { ui: { notify() {} } };
	const session = {
		cwd: root,
		isIdle: () => true,
		sessionManager: sessionManager("coordinator-a"),
		ui: { notify: (message: string) => notifications.push(message), setStatus: (_key: string, value: string | undefined) => statuses.push(value) },
	};
	handlers.get("session_start")?.({}, session);
	context.after(() => handlers.get("session_shutdown")?.({}, session));
	command("off", commandUi);
	await mkdir(join(jobs, "new"), { recursive: true });
	await writeFile(join(jobs, "new/label"), "F001 implementation\n");
	await writeFile(join(jobs, "new/branch"), "candidate\n");
	await subscribe(jobs, "new", "coordinator-a");
	await writeFile(join(jobs, "new/state"), "running\n");
	await waitUntilAsync(async () => (await readCalls(calls)).some((call) => call.includes("limen=1 · F001 starting")));
	assert.deepEqual(
		statuses.filter((value) => value !== undefined),
		[],
		"the muted footer must stay clear while herdr still gets the token",
	);
	assert.deepEqual(notifications, [], "a muted session must not show start notices");
	await writeFile(join(jobs, "new/state"), "done\n");
	await new Promise((resolve) => setTimeout(resolve, 200));
	assert.equal((await readCalls(calls)).filter((call) => call[0] === "notification").length, 0, "mute must silence herdr toasts");
	assert.deepEqual(messages, [], "a muted session must not receive wakes");
	command("on", commandUi);
	await waitUntil(() => messages.length === 1);
	assert.match(messages[0] ?? "", /F001 implementation.*is done/);
	await waitUntilAsync(async () => (await readCalls(calls)).some((call) => call[0] === "notification"));
	assert.equal((await readCalls(calls)).filter((call) => call[0] === "notification").length, 1, "unmute delivers the herdr toast once");
});

test("a dead running job past grace is reaped once and wakes", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	stashEnv(context, "LIMEN_HERDR", "0");
	stashEnv(context, "LIMEN_REAP_CONFIRM_MS", "30");
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-wake-reap-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	const jobs = join(root, ".limen/jobs");
	const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
	const messages: string[] = [];
	limenWake({
		on(event, handler) {
			handlers.set(event, handler);
		},
		sendUserMessage(content) {
			messages.push(content);
		},
	});
	const session = { cwd: root, isIdle: () => true, sessionManager: sessionManager("coordinator-a"), ui: { notify() {}, setStatus() {} } };
	handlers.get("session_start")?.({}, session);
	context.after(() => handlers.get("session_shutdown")?.({}, session));
	const young = join(jobs, "young");
	await mkdir(young, { recursive: true });
	await writeFile(join(young, "label"), "F025 young\n");
	await writeFile(join(young, "branch"), "limen/young\n");
	await writeFile(join(young, "pid"), "999999999\n");
	await writeFile(join(young, "started-at"), `${new Date(Date.now() - 60_000).toISOString()}\n`);
	await writeFile(join(young, "log"), "");
	await subscribe(jobs, "young", "coordinator-a");
	await writeFile(join(young, "state"), "running\n");
	const gone = join(jobs, "gone");
	await mkdir(join(gone, "session"), { recursive: true });
	await writeFile(join(gone, "label"), "F025 gone\n");
	await writeFile(join(gone, "branch"), "limen/gone\n");
	await writeFile(join(gone, "pid"), "999999999\n");
	await writeFile(join(gone, "started-at"), `${new Date(Date.now() - 60 * 60_000).toISOString()}\n`);
	await writeFile(join(gone, "log"), "");
	await writeFile(join(gone, "hosted"), "hosted\n");
	await writeFile(
		join(gone, "session", "2026-08-19.jsonl"),
		`${JSON.stringify({
			type: "message",
			message: { role: "assistant", content: [{ type: "text", text: "worker final" }], stopReason: "error", errorMessage: "usage limit reached" },
		})}\n`,
	);
	await subscribe(jobs, "gone", "coordinator-a");
	await writeFile(join(gone, "state"), "running\n");
	await waitUntil(() => messages.some((message) => message.includes("is failed (gone)")));
	assert.equal(await readFile(join(young, "state"), "utf8"), "running\n");
	assert.equal(await readFile(join(gone, "state"), "utf8"), "failed\n");
	assert.equal(await readFile(join(gone, "result"), "utf8"), "worker final\n");
	assert.equal(await readFile(join(gone, "stop-reason"), "utf8"), "error: usage limit reached\n");
	const wake = messages.find((message) => message.includes("is failed (gone)")) ?? "";
	assert.match(wake, /Stop reason: error: usage limit reached/);
	assert.match(wake, /Final message:\nworker final/);
	assert.equal(messages.filter((message) => message.includes("is failed (gone)")).length, 1);
	await new Promise((resolve) => setTimeout(resolve, 200));
	assert.equal(messages.filter((message) => message.includes("is failed (gone)")).length, 1, "a reaped job must wake once");
});

test("an idle advisory wakes once, stays running, and does not block completion", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	stashEnv(context, "LIMEN_HERDR", "0");
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-wake-advisory-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	const jobs = join(root, ".limen/jobs");
	const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
	const messages: Array<{ content: string; deliverAs?: string }> = [];
	const notifications: string[] = [];
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
		isIdle: () => true,
		sessionManager: sessionManager("coordinator-a"),
		ui: { notify: (message: string) => notifications.push(message), setStatus() {} },
	};
	handlers.get("session_start")?.({}, session);
	context.after(() => handlers.get("session_shutdown")?.({}, session));
	await mkdir(join(jobs, "stall"), { recursive: true });
	await writeFile(join(jobs, "stall/label"), "F027 stall\n");
	await writeFile(join(jobs, "stall/branch"), "limen/stall\n");
	await subscribe(jobs, "stall", "coordinator-a");
	await writeFile(join(jobs, "stall/state"), "running\n");
	await writeFile(join(jobs, "stall/result"), "hosted stall summary\n");
	await writeFile(join(jobs, "stall/commits"), "abc1234 stall work\n");
	await writeFile(join(jobs, "stall/advisory"), "idle 10m after 14 tool calls, session still open\n");
	await waitUntil(() => messages.length === 1);
	assert.equal(messages[0]?.deliverAs, undefined);
	assert.match(messages[0]?.content ?? "", /still running \(stall\).*idle 10m after 14 tool calls, session still open/);
	assert.match(messages[0]?.content ?? "", /Inspect the job record and continue the loop; steer; or open the tab and exit if you mean the session to end/);
	assert.match(messages[0]?.content ?? "", /Final message:\nhosted stall summary/);
	assert.match(messages[0]?.content ?? "", /Commits:\nabc1234 stall work/);
	assert.ok(notifications.some((value) => value.includes("is idle (stall)")));
	assert.equal(await readFile(join(jobs, "stall/state"), "utf8"), "running\n");
	emitWakeTurn(handlers, session, messages[0]?.content ?? "");
	await writeFile(join(jobs, "stall/state"), "done\n");
	await waitUntil(() => messages.length === 2);
	assert.match(messages[1]?.content ?? "", /is done \(stall\)/);
	assert.doesNotMatch(messages[1]?.content ?? "", /continue the loop/);
	emitWakeTurn(handlers, session, messages[1]?.content ?? "");
	const { existsSync } = await import("node:fs");
	assert.equal(existsSync(join(jobs, "stall/notify/delivered/coordinator-a")), true);
	assert.equal(existsSync(join(jobs, "stall/notify/delivered/_advisory.coordinator-a")), true);
});

test("work resuming then stalling again re-arms one further advisory wake", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	stashEnv(context, "LIMEN_HERDR", "0");
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-wake-rearm-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	const jobs = join(root, ".limen/jobs");
	const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
	const messages: string[] = [];
	limenWake({
		on(event, handler) {
			handlers.set(event, handler);
		},
		sendUserMessage(content) {
			messages.push(content);
		},
	});
	const session = { cwd: root, isIdle: () => true, sessionManager: sessionManager("coordinator-a"), ui: { notify() {}, setStatus() {} } };
	handlers.get("session_start")?.({}, session);
	context.after(() => handlers.get("session_shutdown")?.({}, session));
	const job = join(jobs, "again");
	await mkdir(job, { recursive: true });
	await writeFile(join(job, "label"), "F027 again\n");
	await writeFile(join(job, "branch"), "limen/again\n");
	await subscribe(jobs, "again", "coordinator-a");
	await writeFile(join(job, "state"), "running\n");
	await writeFile(join(job, "advisory"), "idle 10m after 4 tool calls, session still open\n");
	await waitUntil(() => messages.length === 1);
	const { rm } = await import("node:fs/promises");
	await rm(join(job, "advisory"), { force: true });
	await rm(join(job, "notify/delivered/_advisory.coordinator-a"), { recursive: true, force: true });
	await rm(join(job, "notify/claims/_advisory.coordinator-a"), { recursive: true, force: true });
	await writeFile(join(job, "advisory"), "idle 10m after 8 tool calls, session still open\n");
	await waitUntil(() => messages.length === 2);
	assert.match(messages[1] ?? "", /idle 10m after 8 tool calls/);
});

test("first idle wake in a sweep is a real turn; later wakes are followUp", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	stashEnv(context, "LIMEN_HERDR", "0");
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-wake-followup-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	const jobs = join(root, ".limen/jobs");
	for (const id of ["one", "two"]) {
		await mkdir(join(jobs, id), { recursive: true });
		await writeFile(join(jobs, id, "label"), `F027 ${id}\n`);
		await writeFile(join(jobs, id, "branch"), `limen/${id}\n`);
		await subscribe(jobs, id, "coordinator-a");
		await writeFile(join(jobs, id, "state"), "done\n");
	}
	const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
	const messages: Array<{ content: string; deliverAs?: string }> = [];
	limenWake({
		on(event, handler) {
			handlers.set(event, handler);
		},
		sendUserMessage(content, options) {
			messages.push({ content, ...(options ? { deliverAs: options.deliverAs } : {}) });
		},
	});
	const session = { cwd: root, isIdle: () => true, sessionManager: sessionManager("coordinator-a"), ui: { notify() {}, setStatus() {} } };
	handlers.get("session_start")?.({}, session);
	context.after(() => handlers.get("session_shutdown")?.({}, session));
	await waitUntil(() => messages.length === 2);
	assert.equal(messages.filter((message) => message.deliverAs === undefined).length, 1);
	assert.equal(messages.filter((message) => message.deliverAs === "followUp").length, 1);
	assert.ok(messages.some((message) => message.content.includes("is done (one)") && !message.content.includes("is done (two)")));
	assert.ok(messages.some((message) => message.content.includes("is done (two)") && !message.content.includes("is done (one)")));
});

test("one assistant response confirms every batched followUp wake in the turn", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	stashEnv(context, "LIMEN_HERDR", "0");
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-wake-batched-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	const jobs = join(root, ".limen/jobs");
	for (const id of ["one", "two"]) {
		await mkdir(join(jobs, id), { recursive: true });
		await writeFile(join(jobs, id, "label"), `F042 ${id}\n`);
		await writeFile(join(jobs, id, "branch"), `limen/${id}\n`);
		await subscribe(jobs, id, "coordinator-a");
		await writeFile(join(jobs, id, "state"), "done\n");
	}
	const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
	const messages: string[] = [];
	limenWake({
		on(event, handler) {
			handlers.set(event, handler);
		},
		sendUserMessage(content) {
			messages.push(content);
		},
	});
	const session = { cwd: root, isIdle: () => false, sessionManager: sessionManager("coordinator-a"), ui: { notify() {}, setStatus() {} } };
	handlers.get("session_start")?.({}, session);
	context.after(() => handlers.get("session_shutdown")?.({}, session));
	await waitUntil(() => messages.length === 2);
	for (const content of messages) {
		handlers.get("message_start")?.({ message: { role: "user", content: [{ type: "text", text: content }] } }, session);
	}
	handlers.get("message_end")?.({ message: { role: "assistant", content: [{ type: "text", text: "both acknowledged" }], stopReason: "stop" } }, session);
	handlers.get("agent_settled")?.({}, session);
	const { existsSync } = await import("node:fs");
	assert.equal(existsSync(join(jobs, "one/notify/delivered/coordinator-a")), true);
	assert.equal(existsSync(join(jobs, "two/notify/delivered/coordinator-a")), true);
	await new Promise((resolve) => setTimeout(resolve, 650));
	assert.equal(messages.length, 2, "confirmed batched wakes must not be injected again");
});

test("a busy session injects every wake as followUp", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	stashEnv(context, "LIMEN_HERDR", "0");
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-wake-busy-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	const jobs = join(root, ".limen/jobs");
	await mkdir(join(jobs, "busy"), { recursive: true });
	await writeFile(join(jobs, "busy/label"), "F027 busy\n");
	await writeFile(join(jobs, "busy/branch"), "limen/busy\n");
	await subscribe(jobs, "busy", "coordinator-a");
	await writeFile(join(jobs, "busy/state"), "done\n");
	const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
	const messages: Array<{ content: string; deliverAs?: string }> = [];
	limenWake({
		on(event, handler) {
			handlers.set(event, handler);
		},
		sendUserMessage(content, options) {
			messages.push({ content, ...(options ? { deliverAs: options.deliverAs } : {}) });
		},
	});
	const session = { cwd: root, isIdle: () => false, sessionManager: sessionManager("coordinator-a"), ui: { notify() {}, setStatus() {} } };
	handlers.get("session_start")?.({}, session);
	context.after(() => handlers.get("session_shutdown")?.({}, session));
	await waitUntil(() => messages.length === 1);
	assert.equal(messages[0]?.deliverAs, "followUp");
});

test("a muted session holds the advisory until unmuted", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	stashEnv(context, "LIMEN_HERDR", "0");
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-wake-mute-adv-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	const jobs = join(root, ".limen/jobs");
	const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
	let command: ((args: string, context: { ui: { notify(message: string, level: "info"): void } }) => void) | undefined;
	const messages: string[] = [];
	const notifications: string[] = [];
	limenWake({
		on(event, handler) {
			handlers.set(event, handler);
		},
		sendUserMessage(content) {
			messages.push(content);
		},
		registerCommand(_name, options) {
			command = options.handler;
		},
	});
	assert.ok(command);
	const commandUi = { ui: { notify() {} } };
	const session = {
		cwd: root,
		isIdle: () => true,
		sessionManager: sessionManager("coordinator-a"),
		ui: { notify: (message: string) => notifications.push(message), setStatus() {} },
	};
	handlers.get("session_start")?.({}, session);
	context.after(() => handlers.get("session_shutdown")?.({}, session));
	command("off", commandUi);
	await mkdir(join(jobs, "quiet"), { recursive: true });
	await writeFile(join(jobs, "quiet/label"), "F027 quiet\n");
	await writeFile(join(jobs, "quiet/branch"), "limen/quiet\n");
	await subscribe(jobs, "quiet", "coordinator-a");
	await writeFile(join(jobs, "quiet/state"), "running\n");
	await writeFile(join(jobs, "quiet/advisory"), "blocked after 2 tool calls, session still open\n");
	await new Promise((resolve) => setTimeout(resolve, 200));
	assert.equal(messages.length, 0);
	assert.equal(notifications.length, 0);
	command("on", commandUi);
	await waitUntil(() => messages.length === 1);
	assert.match(messages[0] ?? "", /blocked after 2 tool calls/);
	assert.ok(notifications.some((value) => value.includes("is blocked (quiet)")));
});

test("wake does not crash Pi after a stale reload context", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	stashEnv(context, "LIMEN_HERDR", "0");
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-wake-stale-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	const jobs = join(root, ".limen/jobs");
	const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
	limenWake({
		on(event, handler) {
			handlers.set(event, handler);
		},
		sendUserMessage() {},
	});
	const session = {
		cwd: root,
		isIdle: () => true,
		sessionManager: sessionManager("coordinator-a"),
		ui: {
			notify() {},
			setStatus() {
				throw new Error("This extension ctx is stale after session replacement or reload.");
			},
		},
	};
	handlers.get("session_start")?.({}, session);
	context.after(() => handlers.get("session_shutdown")?.({}, session));
	await mkdir(join(jobs, "new"), { recursive: true });
	await writeFile(join(jobs, "new/label"), "F001 implementation\n");
	await writeFile(join(jobs, "new/branch"), "candidate\n");
	await subscribe(jobs, "new", "coordinator-a");
	await writeFile(join(jobs, "new/state"), "running\n");
	await new Promise((resolve) => setTimeout(resolve, 250));
	handlers.get("session_shutdown")?.({}, session);
});

test("a rejected injection releases the claim and the next sweep retries", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	stashEnv(context, "LIMEN_HERDR", "0");
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-wake-retry-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	const jobs = join(root, ".limen/jobs");
	const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
	const messages: string[] = [];
	let rejectNext = true;
	limenWake({
		on(event, handler) {
			handlers.set(event, handler);
		},
		sendUserMessage(content) {
			if (rejectNext) return Promise.reject(new Error("Cannot submit a prompt while compaction is in progress."));
			messages.push(String(content));
			return Promise.resolve();
		},
	});
	const session = {
		cwd: root,
		isIdle: () => true,
		sessionManager: sessionManager("coordinator-a"),
		ui: {
			notify() {},
			setStatus() {},
		},
	};
	handlers.get("session_start")?.({}, session);
	context.after(() => handlers.get("session_shutdown")?.({}, session));
	await mkdir(join(jobs, "new"), { recursive: true });
	await writeFile(join(jobs, "new/label"), "F031 retry\n");
	await writeFile(join(jobs, "new/branch"), "candidate\n");
	await subscribe(jobs, "new", "coordinator-a");
	await writeFile(join(jobs, "new/state"), "running\n");
	await new Promise((resolve) => setTimeout(resolve, 150));
	await writeFile(join(jobs, "new/state"), "done\n");
	// The injection rejects mid-compaction; the claim must be released, never delivered.
	const { existsSync } = await import("node:fs");
	await waitUntilAsync(() =>
		readFile(join(jobs, "new/log"), "utf8")
			.then((logText) => logText.includes("wake injection failed"))
			.catch(() => false),
	);
	assert.equal(existsSync(join(jobs, "new/notify/delivered/coordinator-a")), false, "a failed injection must not mark delivered");
	// Once pi can accept turns again, a later sweep delivers without any human nudge.
	rejectNext = false;
	await waitUntil(() => messages.length >= 1);
	assert.equal(existsSync(join(jobs, "new/notify/delivered/coordinator-a")), false, "acceptance alone is not confirmation");
	emitWakeTurn(handlers, session, messages[0] ?? "");
	assert.ok(existsSync(join(jobs, "new/notify/delivered/coordinator-a")));
	assert.match(messages[0] ?? "", /F031 retry.*is done/);
	handlers.get("session_shutdown")?.({}, session);
});

test("an accepted wake is recovered after shutdown when no turn ran", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	stashEnv(context, "LIMEN_HERDR", "0");
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-wake-recover-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	const jobs = join(root, ".limen/jobs");
	const job = join(jobs, "recover");
	await mkdir(job, { recursive: true });
	await writeFile(join(job, "label"), "F042 recover\n");
	await writeFile(join(job, "branch"), "limen/recover\n");
	await subscribe(jobs, "recover", "coordinator-a");
	await writeFile(join(job, "state"), "done\n");
	const firstHandlers = new Map<string, (event: unknown, context: TestContext) => void>();
	const firstMessages: string[] = [];
	limenWake({
		on(event, handler) {
			firstHandlers.set(event, handler);
		},
		sendUserMessage(content) {
			firstMessages.push(content);
		},
	});
	const firstSession = { cwd: root, isIdle: () => false, sessionManager: sessionManager("coordinator-a"), ui: { notify() {}, setStatus() {} } };
	firstHandlers.get("session_start")?.({}, firstSession);
	await waitUntil(() => firstMessages.length === 1);
	const claim = join(job, "notify/claims/coordinator-a");
	assert.equal((await readFile(join(claim, "accepted"), "utf8")).trim(), "1");
	const stale = new Date(Date.now() - 31_000);
	await utimes(claim, stale, stale);
	await new Promise((resolve) => setTimeout(resolve, 550));
	assert.equal(firstMessages.length, 1, "a live owner protects a long-running accepted claim from stale recovery");
	firstHandlers.get("session_shutdown")?.({}, firstSession);

	const secondHandlers = new Map<string, (event: unknown, context: TestContext) => void>();
	const secondMessages: string[] = [];
	limenWake({
		on(event, handler) {
			secondHandlers.set(event, handler);
		},
		sendUserMessage(content) {
			secondMessages.push(content);
		},
	});
	const secondSession = { cwd: root, isIdle: () => true, sessionManager: sessionManager("coordinator-a"), ui: { notify() {}, setStatus() {} } };
	secondHandlers.get("session_start")?.({}, secondSession);
	context.after(() => secondHandlers.get("session_shutdown")?.({}, secondSession));
	await waitUntil(() => secondMessages.length === 1);
	assert.match(secondMessages[0] ?? "", /F042 recover.*is done/);
	emitWakeTurn(secondHandlers, secondSession, secondMessages[0] ?? "");
	const { existsSync } = await import("node:fs");
	assert.equal(existsSync(join(job, "notify/delivered/coordinator-a")), true);
	assert.equal(existsSync(claim), false);
});

test("another listener does not recover a live accepted claim", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	stashEnv(context, "LIMEN_HERDR", "0");
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-wake-live-claim-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	const jobs = join(root, ".limen/jobs");
	const job = join(jobs, "live");
	await mkdir(job, { recursive: true });
	await writeFile(join(job, "label"), "F042 live claim\n");
	await writeFile(join(job, "branch"), "limen/live\n");
	await subscribe(jobs, "live", "coordinator-a");
	await writeFile(join(job, "state"), "done\n");
	const firstHandlers = new Map<string, (event: unknown, context: TestContext) => void>();
	const firstMessages: string[] = [];
	limenWake({
		on(event, handler) {
			firstHandlers.set(event, handler);
		},
		sendUserMessage(content) {
			firstMessages.push(content);
		},
	});
	const firstSession = { cwd: root, isIdle: () => false, sessionManager: sessionManager("coordinator-a"), ui: { notify() {}, setStatus() {} } };
	firstHandlers.get("session_start")?.({}, firstSession);
	context.after(() => firstHandlers.get("session_shutdown")?.({}, firstSession));
	await waitUntil(() => firstMessages.length === 1);
	const claim = join(job, "notify/claims/coordinator-a");
	const stale = new Date(Date.now() - 31_000);
	await utimes(claim, stale, stale);

	const secondHandlers = new Map<string, (event: unknown, context: TestContext) => void>();
	const secondMessages: string[] = [];
	limenWake({
		on(event, handler) {
			secondHandlers.set(event, handler);
		},
		sendUserMessage(content) {
			secondMessages.push(content);
		},
	});
	const secondSession = { cwd: root, isIdle: () => false, sessionManager: sessionManager("coordinator-a"), ui: { notify() {}, setStatus() {} } };
	secondHandlers.get("session_start")?.({}, secondSession);
	context.after(() => secondHandlers.get("session_shutdown")?.({}, secondSession));
	await new Promise((resolve) => setTimeout(resolve, 650));
	assert.equal(secondMessages.length, 0, "the live claimant's heartbeat protects its accepted claim");
	emitWakeTurn(firstHandlers, firstSession, firstMessages[0] ?? "");
	const { existsSync } = await import("node:fs");
	assert.equal(existsSync(join(job, "notify/delivered/coordinator-a")), true);
});

test("a provider-error turn is unconfirmed and retries before delivery", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	stashEnv(context, "LIMEN_HERDR", "0");
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-wake-error-turn-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	const jobs = join(root, ".limen/jobs");
	const job = join(jobs, "error-turn");
	await mkdir(job, { recursive: true });
	await writeFile(join(job, "label"), "F042 error turn\n");
	await writeFile(join(job, "branch"), "limen/error-turn\n");
	await subscribe(jobs, "error-turn", "coordinator-a");
	await writeFile(join(job, "state"), "done\n");
	const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
	const messages: string[] = [];
	limenWake({
		on(event, handler) {
			handlers.set(event, handler);
		},
		sendUserMessage(content) {
			messages.push(content);
		},
	});
	const session = { cwd: root, isIdle: () => true, sessionManager: sessionManager("coordinator-a"), ui: { notify() {}, setStatus() {} } };
	handlers.get("session_start")?.({}, session);
	context.after(() => handlers.get("session_shutdown")?.({}, session));
	await waitUntil(() => messages.length === 1);
	emitWakeTurn(handlers, session, messages[0] ?? "", "error");
	const { existsSync } = await import("node:fs");
	assert.equal(existsSync(join(job, "notify/delivered/coordinator-a")), false);
	await waitUntil(() => messages.length === 2);
	emitWakeTurn(handlers, session, messages[1] ?? "");
	assert.equal(existsSync(join(job, "notify/delivered/coordinator-a")), true);
	await new Promise((resolve) => setTimeout(resolve, 550));
	assert.equal(messages.length, 2, "confirmation prevents a third injection");
});

test("two unconfirmed injections retain the claim and stop automatic retries", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	stashEnv(context, "LIMEN_HERDR", "0");
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-wake-blocked-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	const jobs = join(root, ".limen/jobs");
	const job = join(jobs, "blocked");
	await mkdir(job, { recursive: true });
	await writeFile(join(job, "label"), "F042 blocked\n");
	await writeFile(join(job, "branch"), "limen/blocked\n");
	await subscribe(jobs, "blocked", "coordinator-a");
	await writeFile(join(job, "state"), "done\n");
	const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
	const messages: string[] = [];
	const notifications: string[] = [];
	limenWake({
		on(event, handler) {
			handlers.set(event, handler);
		},
		sendUserMessage(content) {
			messages.push(content);
		},
	});
	const session = {
		cwd: root,
		isIdle: () => true,
		sessionManager: sessionManager("coordinator-a"),
		ui: { notify: (message: string) => notifications.push(message), setStatus() {} },
	};
	handlers.get("session_start")?.({}, session);
	context.after(() => handlers.get("session_shutdown")?.({}, session));
	await waitUntil(() => messages.length === 1);
	handlers.get("agent_settled")?.({}, session);
	await waitUntil(() => messages.length === 2);
	handlers.get("agent_settled")?.({}, session);
	await waitUntil(() => notifications.some((message) => message.includes("unconfirmed twice")));
	await new Promise((resolve) => setTimeout(resolve, 650));
	assert.equal(messages.length, 2);
	assert.match(await readFile(join(job, "notify/claims/coordinator-a/blocked"), "utf8"), /automatic retries stopped/);
	assert.match(await readFile(join(job, "log"), "utf8"), /claim retained for human recovery/);
});

test("a footer failure leaves completion delivery and sweeps alive", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	stashEnv(context, "LIMEN_HERDR", "0");
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-wake-footer-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	const jobs = join(root, ".limen/jobs");
	const job = join(jobs, "footer");
	await mkdir(job, { recursive: true });
	await writeFile(join(job, "label"), "F042 footer\n");
	await writeFile(join(job, "branch"), "limen/footer\n");
	await subscribe(jobs, "footer", "coordinator-a");
	await writeFile(join(job, "state"), "running\n");
	const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
	const messages: string[] = [];
	limenWake({
		on(event, handler) {
			handlers.set(event, handler);
		},
		sendUserMessage(content) {
			messages.push(content);
		},
	});
	const session = {
		cwd: root,
		isIdle: () => true,
		sessionManager: sessionManager("coordinator-a"),
		ui: {
			notify() {},
			setStatus() {
				throw new Error("stale footer");
			},
		},
	};
	handlers.get("session_start")?.({}, session);
	context.after(() => handlers.get("session_shutdown")?.({}, session));
	await waitUntilAsync(() =>
		readFile(join(root, ".limen/log"), "utf8")
			.then((value) => value.includes("footer disabled"))
			.catch(() => false),
	);
	await writeFile(join(job, "state"), "done\n");
	await waitUntil(() => messages.length === 1);
	emitWakeTurn(handlers, session, messages[0] ?? "");
	assert.match(messages[0] ?? "", /F042 footer.*is done/);
	const notes = (await readFile(join(root, ".limen/log"), "utf8")).split("footer disabled").length - 1;
	assert.equal(notes, 1, "one durable footer-death note");
});

test("session start delivers a standing advisory before a completion", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	stashEnv(context, "LIMEN_HERDR", "0");
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-wake-order-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	const jobs = join(root, ".limen/jobs");
	for (const id of ["a-completion", "z-advisory"]) {
		await mkdir(join(jobs, id), { recursive: true });
		await writeFile(join(jobs, id, "label"), `F042 ${id}\n`);
		await writeFile(join(jobs, id, "branch"), `limen/${id}\n`);
		await subscribe(jobs, id, "coordinator-a");
	}
	await writeFile(join(jobs, "a-completion/state"), "done\n");
	await writeFile(join(jobs, "z-advisory/state"), "running\n");
	await writeFile(join(jobs, "z-advisory/advisory"), "blocked while session remains open\n");
	const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
	const messages: string[] = [];
	limenWake({
		on(event, handler) {
			handlers.set(event, handler);
		},
		sendUserMessage(content) {
			messages.push(content);
		},
	});
	const session = { cwd: root, isIdle: () => true, sessionManager: sessionManager("coordinator-a"), ui: { notify() {}, setStatus() {} } };
	handlers.get("session_start")?.({}, session);
	context.after(() => handlers.get("session_shutdown")?.({}, session));
	await waitUntil(() => messages.length === 2);
	assert.match(messages[0] ?? "", /still running \(z-advisory\)/);
	assert.match(messages[1] ?? "", /is done \(a-completion\)/);
});

test("an open coordinator stamps last-sweep and shutdown stops refreshing it", async (context) => {
	stashEnv(context, "LIMEN_JOB", undefined);
	stashEnv(context, "LIMEN_HERDR", "0");
	const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-last-sweep-")));
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
	limenWake({
		on(event, handler) {
			handlers.set(event, handler);
		},
		sendUserMessage() {},
	});
	const session = { cwd: root, isIdle: () => true, sessionManager: sessionManager("coordinator-stamp"), ui: { notify() {}, setStatus() {} } };
	handlers.get("session_start")?.({}, session);
	const stamp = join(root, ".limen/last-sweep");
	await waitUntilAsync(() =>
		readFile(stamp, "utf8")
			.then((value) => value.includes("coordinator-stamp"))
			.catch(() => false),
	);
	const first = await readFile(stamp, "utf8");
	assert.ok(Number.isFinite(Date.parse(first.split("\n")[0] ?? "")));
	const firstMtime = (await stat(stamp)).mtimeMs;
	await new Promise((resolve) => setTimeout(resolve, 650));
	assert.equal((await stat(stamp)).mtimeMs, firstMtime, "the 500ms sweep must not rewrite the 30s stamp");
	handlers.get("session_shutdown")?.({}, session);
	await new Promise((resolve) => setTimeout(resolve, 650));
	assert.equal((await stat(stamp)).mtimeMs, firstMtime, "no session means the liveness stamp starts going stale");
});

function emitWakeTurn(handlers: Map<string, (event: unknown, context: TestContext) => void>, session: TestContext, content: string, stopReason = "stop"): void {
	const user = { role: "user", content: [{ type: "text", text: content }] };
	handlers.get("message_start")?.({ message: user }, session);
	handlers.get("message_end")?.({ message: { role: "assistant", content: [{ type: "text", text: "acknowledged" }], stopReason } }, session);
	handlers.get("agent_settled")?.({}, session);
}

function sessionManager(id: string): { getSessionId(): string } {
	return { getSessionId: () => id };
}

async function subscribe(jobs: string, id: string, session: string): Promise<void> {
	await mkdir(join(jobs, id, "notify/subscribers"), { recursive: true });
	await writeFile(join(jobs, id, `notify/subscribers/${session}`), "1\n");
	await writeFile(join(jobs, id, "notify/ready"), "1\n");
}

async function waitUntil(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 3_000;
	while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
	assert.ok(predicate(), "timed out waiting for wake event");
}
