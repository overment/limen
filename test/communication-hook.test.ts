import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import limenCommunication from "../hook/communication.ts";

const ROOT = new URL("..", import.meta.url).pathname;

type Context = { readonly cwd: string };
type Message = { readonly customType: string; readonly content: string; readonly display: boolean };
type StartEvent = { readonly prompt?: string; readonly systemPrompt?: string };
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

test("a wake prompt skips project context and still appends speech", async (context) => {
	const root = await projectRoot(context);
	await writeFile(join(root, "spec/vision.md"), "Vision one.\n");
	await writeFile(join(root, "spec/build.md"), "# Build\n");
	await writeFile(join(root, ".agents/limen/styleguide.md"), "Prefer small functions.\n");
	await writeFile(join(root, ".agents/limen/communication.md"), "Write for a person.\n");
	const result = start(root, { prompt: 'Limen job "F031 retry" is done (abc) on branch limen/abc.', systemPrompt: "base" });
	assert.equal(result.message, undefined);
	assert.match(result.systemPrompt ?? "", /<limen-communication>/);
	assert.match(result.systemPrompt ?? "", /Write for a person\./);
	assert.match(result.systemPrompt ?? "", /opened by a job wake/);
});

test("the note references vision, board, and styleguide with their rules instead of attaching bodies", async (context) => {
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
	assert.match(result.message.content, /referenced, not attached/);
	assert.match(result.message.content, /re-read them after compaction/);
	assert.match(result.message.content, /## Governing files/);
	assert.match(
		result.message.content,
		/- `spec\/vision\.md` — durable intent\. Keep it present in the interaction at all times; load it before any touch of the feature specifications\./,
	);
	assert.match(result.message.content, /- `spec\/build\.md` — the current state of work/);
	assert.match(
		result.message.content,
		/- `\.agents\/limen\/styleguide\.md` — project coding practice\. Load it before writing or modifying feature specifications, and have it in context whenever you modify files\./,
	);
	assert.doesNotMatch(result.message.content, /Vision one\.|`F001-auth`|Prefer small functions\./);
	assert.doesNotMatch(result.message.content, /Shop manual/);
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
	assert.match(content, /- `spec\/vision\.md` — durable intent/);
	assert.match(content, /- `spec\/build\.md` — the current state of work/);
	assert.match(content, /- `\.agents\/limen\/styleguide\.md` — project coding practice/);
	assert.doesNotMatch(content, /Workspace direction\.|Workspace code style\./);
});

test("the note re-evaluates each turn, so a file planted mid-session appears on the next message", async (context) => {
	const root = await projectRoot(context);
	const { handlers } = extension();
	const first = handlers.before_agent_start?.({}, { cwd: root })?.message?.content;
	await writeFile(join(root, "spec/vision.md"), "First direction.\n");
	const second = handlers.before_agent_start?.({}, { cwd: root })?.message?.content;
	assert.doesNotMatch(first ?? "", /## Governing files/);
	assert.match(second ?? "", /## Governing files\n- `spec\/vision\.md` — durable intent/);
	assert.doesNotMatch(second ?? "", /First direction\./);
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
	assert.match(drifting, /- `spec\/build\.md` — the current state of work/);
	assert.doesNotMatch(drifting, /`spec\/build\.md` is unavailable/);
	assert.match(drifting, /planned: F002-api/);
	assert.match(drifting, /advisory, not a gate/);
});

test("a project overlay wins over the package speech register", async (context) => {
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
	assert.doesNotMatch(result.systemPrompt ?? "", /opened by a job wake/);
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

test("missing communication inherits the package register", async (context) => {
	const root = await projectRoot(context);
	const { handlers } = extension();
	const result = handlers.before_agent_start?.({ systemPrompt: "base" }, { cwd: root });
	assert.match(result?.systemPrompt ?? "", /<limen-communication>/);
	assert.match(result?.systemPrompt ?? "", /Audience for this reply: human/);
	assert.match(result?.systemPrompt ?? "", /limen\/templates\/communication\.md/);
	assert.match(result?.systemPrompt ?? "", /did not write this code/);
});

test("a coordinator without AGENTS.md inherits the package shop manual", async (context) => {
	const root = await projectRoot(context);
	const inheritedJob = process.env.LIMEN_JOB;
	delete process.env.LIMEN_JOB;
	context.after(() => {
		if (inheritedJob === undefined) delete process.env.LIMEN_JOB;
		else process.env.LIMEN_JOB = inheritedJob;
	});
	const content = start(root).message?.content ?? "";
	assert.match(content, /## Shop manual \(limen\/templates\/agents\.md\)/);
	assert.match(content, /plain specifications/);
});

test("identical leftover copies are named as leftovers, overlays as overlays", async (context) => {
	const root = await projectRoot(context);
	const packaged = await readFile(new URL("../templates/communication.md", import.meta.url), "utf8");
	await writeFile(join(root, ".agents/limen/communication.md"), packaged);
	await writeFile(join(root, "AGENTS.md"), "custom shop\n");
	const content = start(root).message?.content ?? "";
	assert.match(content, /## Guidance drift/);
	assert.match(content, /leftover \(identical; delete to inherit\): \.agents\/limen\/communication\.md/);
	assert.match(content, /overlay \(differs; keep, drop, or edit\): AGENTS\.md/);
	assert.doesNotMatch(content, /## Shop manual/);
});

test("a stale copy is named with both dates in the drift section", async (context) => {
	const root = await projectRoot(context);
	const inherited = { job: process.env.LIMEN_JOB, contextRoot: process.env.LIMEN_CONTEXT_ROOT };
	delete process.env.LIMEN_JOB;
	delete process.env.LIMEN_CONTEXT_ROOT;
	context.after(() => {
		if (inherited.job === undefined) delete process.env.LIMEN_JOB;
		else process.env.LIMEN_JOB = inherited.job;
		if (inherited.contextRoot === undefined) delete process.env.LIMEN_CONTEXT_ROOT;
		else process.env.LIMEN_CONTEXT_ROOT = inherited.contextRoot;
	});
	const [latest, previous] = gitLogPair("templates/reviewer.md");
	await writeFile(join(root, ".agents/limen/reviewer.md"), execFileSync("git", ["show", `${previous.hash}:templates/reviewer.md`], { cwd: ROOT, encoding: "utf8" }));
	const content = start(root).message?.content ?? "";
	assert.equal(content.includes(`stale (package text as of ${previous.date}; package changed ${latest.date}): .agents/limen/reviewer.md`), true);
});

function gitLogPair(source: string): readonly [{ readonly hash: string; readonly date: string }, { readonly hash: string; readonly date: string }] {
	const lines = execFileSync("git", ["log", "-2", "--format=%H %cs", "--", source], { cwd: ROOT, encoding: "utf8" })
		.trim()
		.split("\n");
	const parsed = lines.map((line) => ({ hash: line.slice(0, 40), date: line.slice(41) }));
	const latest = parsed[0];
	const previous = parsed[1];
	assert.ok(latest && previous, `need two revisions of ${source}`);
	return [latest, previous];
}
