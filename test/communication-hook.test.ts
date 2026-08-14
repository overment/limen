import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import limenCommunication from "../hook/communication.ts";

type Entry = { readonly type: string; readonly customType?: string; readonly content?: unknown };
type Context = {
	readonly cwd: string;
	readonly sessionManager: { buildContextEntries(): readonly Entry[] };
};
type Handlers = {
	session_start?: (event: unknown, context: Context) => void;
	before_agent_start?: (
		event: unknown,
		context: Context,
	) =>
		| undefined
		| {
				readonly message: {
					readonly customType: string;
					readonly content: string;
					readonly display: boolean;
				};
		  };
};

function extension(): { readonly handlers: Handlers; readonly events: string[] } {
	const handlers: Handlers = {};
	const events: string[] = [];
	limenCommunication({
		on(event, handler) {
			events.push(event);
			if (event === "session_start") handlers.session_start = handler as NonNullable<Handlers["session_start"]>;
			else handlers.before_agent_start = handler as NonNullable<Handlers["before_agent_start"]>;
		},
	});
	return { handlers, events };
}

test("communication guidance is one stable active-context message", async (context) => {
	const inheritedJob = process.env.LIMEN_JOB;
	delete process.env.LIMEN_JOB;
	context.after(() => {
		if (inheritedJob === undefined) delete process.env.LIMEN_JOB;
		else process.env.LIMEN_JOB = inheritedJob;
	});
	const root = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-communication-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	await writeFile(join(root, ".agents/limen/communication.md"), "Be clear.\n");
	let entries: Entry[] = [];
	const session = { cwd: root, sessionManager: { buildContextEntries: () => entries } };
	const { handlers, events } = extension();
	handlers.session_start?.({}, session);
	const message = { customType: "limen-communication", content: "Be clear.", display: false };
	assert.deepEqual(handlers.before_agent_start?.({}, session), { message });
	entries = [{ type: "custom_message", ...message }];
	assert.equal(handlers.before_agent_start?.({}, session), undefined);
	assert.deepEqual(events, ["session_start", "before_agent_start"]);

	entries = [{ type: "compaction" }];
	assert.deepEqual(handlers.before_agent_start?.({}, session), { message }, "inject again after compaction removes it");
	entries = [{ type: "custom_message", ...message, content: "Old guidance." }];
	assert.deepEqual(handlers.before_agent_start?.({}, session), { message }, "inject changed guidance without rewriting history");
});

test("communication guidance stays out of worker sessions", async (context) => {
	const inheritedJob = process.env.LIMEN_JOB;
	process.env.LIMEN_JOB = "1";
	context.after(() => {
		if (inheritedJob === undefined) delete process.env.LIMEN_JOB;
		else process.env.LIMEN_JOB = inheritedJob;
	});
	const root = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-communication-worker-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	await writeFile(join(root, ".agents/limen/communication.md"), "Be clear.\n");
	const session = { cwd: root, sessionManager: { buildContextEntries: () => [] } };
	const { handlers } = extension();
	handlers.session_start?.({}, session);
	assert.equal(handlers.before_agent_start?.({}, session), undefined);
});
