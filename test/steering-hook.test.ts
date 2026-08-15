import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import limenSteering from "../hook/steering.ts";

type Handlers = Map<string, (event?: unknown, context?: unknown) => void>;

test("worker extension delivers inbox files once as steer messages", async (context) => {
	const root = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-steer-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	stashEnv(context, { LIMEN_JOB: "1", LIMEN_JOB_ID: "live", LIMEN_CONTEXT_ROOT: root });
	const job = join(root, ".limen/jobs/live");
	await mkdir(job, { recursive: true });
	await writeFile(join(job, "log"), "");
	const { handlers, messages } = startSteering();
	handlers.get("session_start")?.();
	context.after(() => handlers.get("session_shutdown")?.());
	await waitUntil(() => fileExists(join(job, "steer/ready")));
	await writeFile(join(job, "steer/inbox/0001"), "stay on the session test\n");
	await waitUntil(() => messages.length === 1);
	assert.deepEqual(messages, [{ content: "stay on the session test", deliverAs: "steer" }]);
	assert.equal(await readFile(join(job, "steer/delivered/0001/text"), "utf8"), "stay on the session test\n");
	assert.match(await readFile(join(job, "log"), "utf8"), /steered: stay on the session test/);
	await assert.rejects(readFile(join(job, "steer/inbox/0001")));
	await writeFile(join(job, "steer/inbox/0002"), "then write the failing test\n");
	await writeFile(join(job, "steer/inbox/0003"), "do not open a second file\n");
	await waitUntil(() => messages.length === 3);
	assert.deepEqual(
		messages.map((message) => message.content),
		["stay on the session test", "then write the failing test", "do not open a second file"],
	);
	assert.deepEqual((await readdir(join(job, "steer/delivered"))).sort(), ["0001", "0002", "0003"]);
	handlers.get("session_shutdown")?.();
});

test("a delivered steer is not sent again after a later sweep", async (context) => {
	const root = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-steer-once-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	stashEnv(context, { LIMEN_JOB: "1", LIMEN_JOB_ID: "again", LIMEN_CONTEXT_ROOT: root });
	const job = join(root, ".limen/jobs/again");
	await mkdir(join(job, "steer/inbox"), { recursive: true });
	await writeFile(join(job, "log"), "");
	const { handlers, messages } = startSteering();
	handlers.get("session_start")?.();
	context.after(() => handlers.get("session_shutdown")?.());
	await writeFile(join(job, "steer/inbox/0001"), "once only\n");
	await waitUntil(() => messages.length === 1);
	await writeFile(join(job, "steer/inbox/0001"), "once only\n");
	await new Promise((resolve) => setTimeout(resolve, 200));
	assert.deepEqual(
		messages.map((message) => message.content),
		["once only"],
	);
	handlers.get("session_shutdown")?.();
});

test("steering stays inert outside a worker", (context) => {
	stashEnv(context, { LIMEN_JOB: undefined, LIMEN_JOB_ID: undefined, LIMEN_CONTEXT_ROOT: undefined });
	const { handlers } = startSteering(() => {
		assert.fail("a coordinator session must not watch a job inbox");
	});
	handlers.get("session_start")?.();
	handlers.get("session_shutdown")?.();
});

function startSteering(onMessage?: () => void): {
	readonly handlers: Handlers;
	readonly messages: Array<{ content: string; deliverAs?: string }>;
} {
	const handlers: Handlers = new Map();
	const messages: Array<{ content: string; deliverAs?: string }> = [];
	limenSteering({
		on(event, handler) {
			handlers.set(event, handler);
		},
		sendUserMessage(content, options) {
			onMessage?.();
			messages.push({ content, ...(options ? { deliverAs: options.deliverAs } : {}) });
		},
	});
	return { handlers, messages };
}

function stashEnv(context: { after(fn: () => void): void }, values: Record<string, string | undefined>): void {
	const inherited = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
	for (const [name, value] of Object.entries(values)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	context.after(() => {
		for (const [name, value] of Object.entries(inherited)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	});
}

function fileExists(path: string): Promise<boolean> {
	return readFile(path).then(
		() => true,
		() => false,
	);
}

async function waitUntil(predicate: () => boolean | Promise<boolean>): Promise<void> {
	const deadline = Date.now() + 3_000;
	while (Date.now() < deadline) {
		if (await predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	assert.ok(await predicate(), "timed out waiting for steer delivery");
}
