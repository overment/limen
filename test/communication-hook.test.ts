import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import limenCommunication from "../hook/communication.ts";

type Context = { readonly cwd: string };
type Message = { readonly customType: string; readonly content: string; readonly display: boolean };
type ContextMessage = { readonly role?: string; readonly customType?: string; readonly content?: unknown; readonly display?: boolean };
type Handlers = {
	before_agent_start?: (event: unknown, context: Context) => { readonly message: Message } | undefined;
	context?: (event: { readonly messages: ContextMessage[] }, context: Context) => { readonly messages: ContextMessage[] } | undefined;
};

function extension(): { readonly handlers: Handlers; readonly events: string[] } {
	const handlers: Handlers = {};
	const events: string[] = [];
	limenCommunication({
		on(event, handler) {
			events.push(event);
			if (event === "before_agent_start") handlers.before_agent_start = handler as NonNullable<Handlers["before_agent_start"]>;
			else handlers.context = handler as NonNullable<Handlers["context"]>;
		},
	});
	return { handlers, events };
}

async function projectRoot(context: test.TestContext): Promise<string> {
	const root = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-communication-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	await Promise.all([mkdir(join(root, ".agents/limen"), { recursive: true }), mkdir(join(root, "spec"), { recursive: true })]);
	return root;
}

function projectMessage(root: string): Message {
	const { handlers } = extension();
	const result = handlers.before_agent_start?.({}, { cwd: root });
	assert.ok(result);
	return result.message;
}

function communicationMessage(root: string, messages: ContextMessage[] = []): ContextMessage {
	const { handlers } = extension();
	const result = handlers.context?.({ messages }, { cwd: root });
	assert.ok(result);
	const last = result.messages.at(-1);
	assert.ok(last);
	return last;
}

test("vision, build board, and styleguide attach after every user message for every role", async (context) => {
	const root = await projectRoot(context);
	await mkdir(join(root, "spec/features/active/F001-auth"), { recursive: true });
	await writeFile(join(root, "spec/vision.md"), "\nVision one.\n\n");
	await writeFile(join(root, "spec/build.md"), "`F001-auth`\n");
	await writeFile(join(root, ".agents/limen/styleguide.md"), "Prefer small functions.\n");
	const inheritedJob = process.env.LIMEN_JOB;
	process.env.LIMEN_JOB = "1";
	context.after(() => {
		if (inheritedJob === undefined) delete process.env.LIMEN_JOB;
		else process.env.LIMEN_JOB = inheritedJob;
	});
	const message = projectMessage(root);
	assert.equal(message.customType, "limen-project-context");
	assert.equal(message.display, false);
	assert.match(message.content, /^<limen-project-context>/);
	assert.match(message.content, /how to write and organize code here/);
	assert.match(message.content, /## Vision \(spec\/vision\.md\)\nVision one\./);
	assert.match(message.content, /## Build board \(spec\/build\.md\)\n`F001-auth`/);
	assert.match(message.content, /## Styleguide \(.agents\/limen\/styleguide\.md\)\nPrefer small functions\./);
	assert.doesNotMatch(message.content, /communication\.md/);
	assert.match(message.content, /<\/limen-project-context>$/);
	assert.deepEqual(extension().events, ["before_agent_start", "context"]);
});

test("workspace jobs resolve project context from their workspace root", async (context) => {
	const root = await projectRoot(context);
	const worktree = join(root, "api-worktree");
	await mkdir(worktree);
	await writeFile(join(root, "spec/vision.md"), "Workspace direction.\n");
	await writeFile(join(root, "spec/build.md"), "# Build\n");
	await writeFile(join(root, ".agents/limen/styleguide.md"), "Workspace code style.\n");
	const inheritedContextRoot = process.env.LIMEN_CONTEXT_ROOT;
	process.env.LIMEN_CONTEXT_ROOT = root;
	context.after(() => {
		if (inheritedContextRoot === undefined) delete process.env.LIMEN_CONTEXT_ROOT;
		else process.env.LIMEN_CONTEXT_ROOT = inheritedContextRoot;
	});
	const message = projectMessage(worktree);
	assert.match(message.content, /Workspace direction\./);
	assert.match(message.content, /# Build/);
	assert.match(message.content, /Workspace code style\./);
});

test("project context reads fresh file contents for each user message", async (context) => {
	const root = await projectRoot(context);
	await writeFile(join(root, "spec/vision.md"), "First direction.\n");
	const { handlers } = extension();
	const first = handlers.before_agent_start?.({}, { cwd: root })?.message.content;
	await writeFile(join(root, "spec/vision.md"), "Second direction.\n");
	const second = handlers.before_agent_start?.({}, { cwd: root })?.message.content;
	assert.match(first ?? "", /First direction\./);
	assert.doesNotMatch(first ?? "", /Second direction\./);
	assert.match(second ?? "", /Second direction\./);
	assert.doesNotMatch(second ?? "", /First direction\./);
});

test("vision, build, and styleguide share a bounded loader with a remaining-context notice", async (context) => {
	const root = await projectRoot(context);
	const vision = Array.from({ length: 1001 }, (_, index) => `vision ${index + 1}`).join("\n");
	const build = Array.from({ length: 1001 }, (_, index) => `build ${index + 1}`).join("\n");
	const styleguide = Array.from({ length: 1001 }, (_, index) => `style ${index + 1}`).join("\n");
	await writeFile(join(root, "spec/vision.md"), vision);
	await writeFile(join(root, "spec/build.md"), build);
	await writeFile(join(root, ".agents/limen/styleguide.md"), styleguide);
	const content = projectMessage(root).content;
	for (const [prefix, path] of [
		["vision", "spec/vision.md"],
		["build", "spec/build.md"],
		["style", ".agents/limen/styleguide.md"],
	] as const) {
		assert.match(content, new RegExp(`${prefix} 1000`));
		assert.doesNotMatch(content, new RegExp(`${prefix} 1001\\n`));
		assert.match(content, new RegExp(`\\[${path.replaceAll(".", "\\.").replaceAll("/", "\\/")} truncated to 1000 of 1001 lines; read the file for remaining context\\.\\]`));
	}
});

test("build-board advice is non-blocking and names missing board or feature references", async (context) => {
	const root = await projectRoot(context);
	await writeFile(join(root, ".agents/limen/styleguide.md"), "Prefer small functions.\n");
	const unavailable = projectMessage(root).content;
	assert.match(unavailable, /`spec\/build\.md` is unavailable/);
	assert.match(unavailable, /advisory, not a gate/);
	await mkdir(join(root, "spec/features/planned/F002-api"), { recursive: true });
	await writeFile(join(root, "spec/build.md"), "# Build\n- `F002-api-v2`\n");
	const drifting = projectMessage(root).content;
	assert.match(drifting, /## Build board \(spec\/build\.md\)\n# Build/);
	assert.match(drifting, /planned: F002-api/);
	assert.match(drifting, /advisory, not a gate/);
});

test("communication restacks at the end of every LLM context with a human audience by default", async (context) => {
	const root = await projectRoot(context);
	await writeFile(join(root, ".agents/limen/communication.md"), "Write for a person.\n");
	const inheritedJob = process.env.LIMEN_JOB;
	delete process.env.LIMEN_JOB;
	context.after(() => {
		if (inheritedJob === undefined) delete process.env.LIMEN_JOB;
		else process.env.LIMEN_JOB = inheritedJob;
	});
	const prior = { role: "user", content: "hello" };
	const message = communicationMessage(root, [prior]);
	assert.equal(message.role, "custom");
	assert.equal(message.customType, "limen-communication");
	assert.equal(message.display, false);
	assert.match(String(message.content), /^<limen-communication>/);
	assert.match(String(message.content), /Audience for this reply: human/);
	assert.match(String(message.content), /## Communication \(.agents\/limen\/communication\.md\)\nWrite for a person\./);
	assert.match(String(message.content), /<\/limen-communication>$/);
});

test("spawned jobs name the agent register and workspace jobs read communication from the workspace root", async (context) => {
	const root = await projectRoot(context);
	const worktree = join(root, "api-worktree");
	await mkdir(worktree);
	await writeFile(join(root, ".agents/limen/communication.md"), "Write for the next worker.\n");
	const inherited = { job: process.env.LIMEN_JOB, contextRoot: process.env.LIMEN_CONTEXT_ROOT };
	process.env.LIMEN_JOB = "1";
	process.env.LIMEN_CONTEXT_ROOT = root;
	context.after(() => {
		if (inherited.job === undefined) delete process.env.LIMEN_JOB;
		else process.env.LIMEN_JOB = inherited.job;
		if (inherited.contextRoot === undefined) delete process.env.LIMEN_CONTEXT_ROOT;
		else process.env.LIMEN_CONTEXT_ROOT = inherited.contextRoot;
	});
	const message = communicationMessage(worktree);
	assert.match(String(message.content), /Audience for this reply: agent/);
	assert.match(String(message.content), /Write for the next worker\./);
});

test("communication is restacked once, reread each LLM call, and bounded like other project files", async (context) => {
	const root = await projectRoot(context);
	await writeFile(join(root, ".agents/limen/communication.md"), "First register.\n");
	const { handlers } = extension();
	const stale = { role: "custom", customType: "limen-communication", content: "stale", display: false };
	const first = handlers.context?.({ messages: [stale, { role: "user", content: "go" }] }, { cwd: root });
	assert.equal(first?.messages.filter((message) => message.customType === "limen-communication").length, 1);
	assert.equal(first?.messages.at(-1)?.customType, "limen-communication");
	assert.match(String(first?.messages.at(-1)?.content), /First register\./);
	await writeFile(join(root, ".agents/limen/communication.md"), `${Array.from({ length: 1001 }, (_, index) => `speak ${index + 1}`).join("\n")}\n`);
	const second = handlers.context?.({ messages: first?.messages ?? [] }, { cwd: root });
	const content = String(second?.messages.at(-1)?.content);
	assert.match(content, /speak 1000/);
	assert.doesNotMatch(content, /speak 1001\n/);
	assert.match(content, /\[\.agents\/limen\/communication\.md truncated to 1000 of 1001 lines; read the file for remaining context\.\]/);
	assert.doesNotMatch(content, /First register\./);
});

test("missing communication is a no-op and does not rewrite the LLM context", async (context) => {
	const root = await projectRoot(context);
	const { handlers } = extension();
	const messages = [{ role: "user", content: "hello" }];
	assert.equal(handlers.context?.({ messages }, { cwd: root }), undefined);
});
