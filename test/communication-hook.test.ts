import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import limenCommunication from "../hook/communication.ts";

type Context = { readonly cwd: string };
type Message = { readonly customType: string; readonly content: string; readonly display: boolean };
type StartEvent = { readonly systemPrompt?: string };
type StartResult = { readonly message?: Message; readonly systemPrompt?: string };
type Handlers = {
	before_agent_start?: (event: StartEvent, context: Context) => StartResult | undefined;
};

function extension(): { readonly handlers: Handlers; readonly events: string[] } {
	const handlers: Handlers = {};
	const events: string[] = [];
	limenCommunication({
		on(event, handler) {
			events.push(event);
			handlers.before_agent_start = handler;
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

function start(root: string, event: StartEvent = {}): StartResult {
	const { handlers } = extension();
	const result = handlers.before_agent_start?.(event, { cwd: root });
	assert.ok(result);
	return result;
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
	const result = start(root);
	assert.ok(result.message);
	assert.equal(result.message.customType, "limen-project-context");
	assert.equal(result.message.display, false);
	assert.match(result.message.content, /^<limen-project-context>/);
	assert.match(result.message.content, /how to write and organize code here/);
	assert.match(result.message.content, /## Vision \(spec\/vision\.md\)\nVision one\./);
	assert.match(result.message.content, /## Build board \(spec\/build\.md\)\n`F001-auth`/);
	assert.match(result.message.content, /## Styleguide \(.agents\/limen\/styleguide\.md\)\nPrefer small functions\./);
	assert.doesNotMatch(result.message.content, /communication\.md/);
	assert.match(result.message.content, /<\/limen-project-context>$/);
	assert.deepEqual(extension().events, ["before_agent_start"]);
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
	const content = start(worktree).message?.content ?? "";
	assert.match(content, /Workspace direction\./);
	assert.match(content, /# Build/);
	assert.match(content, /Workspace code style\./);
});

test("project context reads fresh file contents for each user message", async (context) => {
	const root = await projectRoot(context);
	await writeFile(join(root, "spec/vision.md"), "First direction.\n");
	const { handlers } = extension();
	const first = handlers.before_agent_start?.({}, { cwd: root })?.message?.content;
	await writeFile(join(root, "spec/vision.md"), "Second direction.\n");
	const second = handlers.before_agent_start?.({}, { cwd: root })?.message?.content;
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
	const content = start(root).message?.content ?? "";
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
	const unavailable = start(root).message?.content ?? "";
	assert.match(unavailable, /`spec\/build\.md` is unavailable/);
	assert.match(unavailable, /advisory, not a gate/);
	await mkdir(join(root, "spec/features/planned/F002-api"), { recursive: true });
	await writeFile(join(root, "spec/build.md"), "# Build\n- `F002-api-v2`\n");
	const drifting = start(root).message?.content ?? "";
	assert.match(drifting, /## Build board \(spec\/build\.md\)\n# Build/);
	assert.match(drifting, /planned: F002-api/);
	assert.match(drifting, /advisory, not a gate/);
});

test("communication appends to the system prompt with a human audience by default", async (context) => {
	const root = await projectRoot(context);
	await writeFile(join(root, ".agents/limen/communication.md"), "Write for a person.\n");
	const inheritedJob = process.env.LIMEN_JOB;
	delete process.env.LIMEN_JOB;
	context.after(() => {
		if (inheritedJob === undefined) delete process.env.LIMEN_JOB;
		else process.env.LIMEN_JOB = inheritedJob;
	});
	const result = start(root, { systemPrompt: "base" });
	assert.match(result.systemPrompt ?? "", /<limen-communication>/);
	assert.match(result.systemPrompt ?? "", /Audience for this reply: human/);
	assert.match(result.systemPrompt ?? "", /## Communication \(.agents\/limen\/communication\.md\)\nWrite for a person\./);
	assert.match(result.systemPrompt ?? "", /<\/limen-communication>$/);
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
	const prompt = start(worktree).systemPrompt ?? "";
	assert.match(prompt, /Audience for this reply: agent/);
	assert.match(prompt, /Write for the next worker\./);
});

test("communication is reread each turn and bounded like other project files", async (context) => {
	const root = await projectRoot(context);
	await writeFile(join(root, ".agents/limen/communication.md"), "First register.\n");
	const { handlers } = extension();
	const first = handlers.before_agent_start?.({}, { cwd: root })?.systemPrompt;
	assert.match(first ?? "", /First register\./);
	await writeFile(join(root, ".agents/limen/communication.md"), `${Array.from({ length: 1001 }, (_, index) => `speak ${index + 1}`).join("\n")}\n`);
	const second = handlers.before_agent_start?.({}, { cwd: root })?.systemPrompt ?? "";
	assert.match(second, /speak 1000/);
	assert.doesNotMatch(second, /speak 1001\n/);
	assert.match(second, /\[\.agents\/limen\/communication\.md truncated to 1000 of 1001 lines; read the file for remaining context\.\]/);
	assert.doesNotMatch(second, /First register\./);
});

test("missing communication leaves the system prompt alone", async (context) => {
	const root = await projectRoot(context);
	const { handlers } = extension();
	const result = handlers.before_agent_start?.({ systemPrompt: "base" }, { cwd: root });
	assert.equal(result?.systemPrompt, undefined);
});
