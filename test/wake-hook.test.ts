import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import controlWake from "../hook/wake.ts";

type TestContext = {
	readonly cwd: string;
	isIdle(): boolean;
	readonly ui: {
		notify(message: string, level: "info"): void;
		setStatus(key: string, value: string | undefined): void;
	};
};

test("wake ignores history, announces start, and steers once on terminal change", async (context) => {
	const inheritedJob = process.env.CONTROL_JOB;
	delete process.env.CONTROL_JOB;
	context.after(() => {
		if (inheritedJob === undefined) delete process.env.CONTROL_JOB;
		else process.env.CONTROL_JOB = inheritedJob;
	});
	const root = await import("node:fs/promises").then(({ mkdtemp }) =>
		mkdtemp(join(process.env.TMPDIR ?? "/tmp", "control-wake-")),
	);
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	const jobs = join(root, ".control/jobs");
	await mkdir(join(jobs, "old"), { recursive: true });
	await writeFile(join(jobs, "old/state"), "done\n");
	await writeFile(join(jobs, "old/branch"), "old-branch\n");
	const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
	const notifications: string[] = [];
	const statuses: Array<string | undefined> = [];
	const messages: Array<{ content: string; deliverAs?: string }> = [];
	controlWake({
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
	assert.deepEqual(notifications, ["control: F001 implementation started (new)"]);
	await writeFile(join(jobs, "new/activity"), "tool\n");
	await writeFile(join(jobs, "new/last-tool"), "bash\n");
	await waitUntil(() => new Set(statuses.filter((value) => value?.includes("ctl 1 · F001 starting"))).size >= 2);
	assert.match(statuses.find((value) => value?.includes("ctl 1 · F001 starting")) ?? "", /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] /);
	await writeFile(join(jobs, "new/state"), "done\n");
	await waitUntil(() => messages.length === 1);
	assert.equal(statuses.at(-1), undefined);
	assert.deepEqual(messages, [
		{
			content: "control: F001 implementation is done (new); inspect .control/jobs/new/ and branch candidate.",
			deliverAs: "steer",
		},
	]);
	await writeFile(join(jobs, "new/state"), "failed\n");
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.equal(messages.length, 1, "a corrected terminal state must not send another wake");
	handlers.get("session_shutdown")?.({}, session);
	assert.deepEqual((await import("node:fs/promises").then(({ readdir }) => readdir(join(jobs, "new")))).sort(), [
		"activity",
		"branch",
		"label",
		"last-tool",
		"state",
	]);
});

test("wake recreates the ignored jobs directory on session start", async (context) => {
	const inheritedJob = process.env.CONTROL_JOB;
	delete process.env.CONTROL_JOB;
	context.after(() => {
		if (inheritedJob === undefined) delete process.env.CONTROL_JOB;
		else process.env.CONTROL_JOB = inheritedJob;
	});
	const root = await import("node:fs/promises").then(({ mkdtemp }) =>
		mkdtemp(join(process.env.TMPDIR ?? "/tmp", "control-wake-empty-")),
	);
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
	controlWake({
		on(event, handler) {
			handlers.set(event, handler);
		},
		sendUserMessage() {},
	});
	const session = { cwd: root, isIdle: () => true, ui: { notify() {}, setStatus() {} } };
	handlers.get("session_start")?.({}, session);
	context.after(() => handlers.get("session_shutdown")?.({}, session));
	await import("node:fs/promises").then(({ access }) => access(join(root, ".control/jobs")));
});

test("wake remains inert inside workers", () => {
	const inheritedJob = process.env.CONTROL_JOB;
	process.env.CONTROL_JOB = "1";
	try {
		const handlers = new Map<string, (event: unknown, context: TestContext) => void>();
		const statuses: Array<string | undefined> = [];
		controlWake({
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
		if (inheritedJob === undefined) delete process.env.CONTROL_JOB;
		else process.env.CONTROL_JOB = inheritedJob;
	}
});

async function waitUntil(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 2_000;
	while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
	assert.ok(predicate(), "timed out waiting for wake event");
}
