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
type ToolContent = { readonly type: string; readonly text?: string };
type ToolEvent = {
	readonly toolName?: string;
	readonly input?: Record<string, unknown>;
	readonly content?: readonly ToolContent[];
};
type ToolPatch = { readonly content?: ToolContent[] };
type Handlers = {
	before_agent_start?: (event: StartEvent, context: Context) => StartResult | undefined;
	message_end?: (event: unknown) => void;
	tool_result?: (event: ToolEvent, context: Context) => ToolPatch | undefined;
};

const ENV_KEYS = ["LIMEN_CONTEXT_ROOT", "LIMEN_JOB", "LIMEN_HOSTED", "LIMEN_JOB_ID", "LIMEN_TASK_FILE"] as const;

function extension(): { readonly handlers: Handlers; readonly events: string[] } {
	const handlers: Handlers = {};
	const events: string[] = [];
	limenCommunication({
		on(event, handler) {
			events.push(event);
			if (event === "before_agent_start") handlers.before_agent_start = handler as NonNullable<Handlers["before_agent_start"]>;
			if (event === "message_end") handlers.message_end = handler as NonNullable<Handlers["message_end"]>;
			if (event === "tool_result") handlers.tool_result = handler as NonNullable<Handlers["tool_result"]>;
		},
	});
	return { handlers, events };
}

function stashEnv(context: test.TestContext, entries: Record<string, string | undefined>): void {
	const previous = Object.fromEntries(Object.keys(entries).map((key) => [key, process.env[key]]));
	for (const [key, value] of Object.entries(entries)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	context.after(() => {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});
}

async function projectRoot(context: test.TestContext): Promise<string> {
	const root = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-communication-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	await Promise.all([mkdir(join(root, ".agents/limen"), { recursive: true }), mkdir(join(root, "spec"), { recursive: true })]);
	stashEnv(context, Object.fromEntries(ENV_KEYS.map((key) => [key, undefined])));
	return root;
}

function start(root: string, event: StartEvent = {}): StartResult {
	const { handlers } = extension();
	const result = handlers.before_agent_start?.(event, { cwd: root });
	assert.ok(result);
	return result;
}

function tool(root: string, event: ToolEvent): ToolPatch {
	const { handlers } = extension();
	return handlers.tool_result?.(event, { cwd: root }) ?? {};
}

function textOf(content: readonly ToolContent[] | undefined): string {
	return (content ?? []).map((part) => part.text ?? "").join("");
}

async function coordinatorFiles(root: string): Promise<void> {
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	await writeFile(join(root, "spec/vision.md"), "Vision one.\n");
	await writeFile(
		join(root, "spec/build.md"),
		["# Build", "", "## TRACK", "- track item", "", "## NOW", "- now item", "", "## NEXT", "- next item", "", "## PROVEN", "- proven item", ""].join("\n"),
	);
	await writeFile(join(root, ".agents/limen/styleguide.md"), "Prefer small functions.\n");
	await writeFile(
		join(root, ".agents/limen/communication.md"),
		["# Communication", "", "## Human", "Write for a person.", "", "## Agent", "Write for the next worker.", ""].join("\n"),
	);
}

test("two human turns with unchanged files share a system prompt, and a wake turn matches", async (context) => {
	const root = await projectRoot(context);
	await coordinatorFiles(root);
	const first = start(root, { systemPrompt: "base" }).systemPrompt;
	const second = start(root, { systemPrompt: "base" }).systemPrompt;
	const wake = start(root, { prompt: 'Limen job "F031 retry" is done (abc) on branch limen/abc.', systemPrompt: "base" }).systemPrompt;
	assert.equal(first, second);
	assert.equal(wake, first);
	assert.match(first ?? "", /^base\n\n/);
});

test("the system prompt holds shop, register, vision, styleguide, then the NOW/NEXT digest", async (context) => {
	const root = await projectRoot(context);
	await coordinatorFiles(root);
	const prompt = start(root, { systemPrompt: "base" }).systemPrompt ?? "";
	const shop = prompt.indexOf("## Shop manual");
	const register = prompt.indexOf("## Communication");
	const vision = prompt.indexOf("## Vision (spec/vision.md)");
	const style = prompt.indexOf("## Styleguide (.agents/limen/styleguide.md)");
	const digest = prompt.indexOf("## Board digest (spec/build.md)");
	assert.ok(shop >= 0 && shop < register && register < vision && vision < style && style < digest);
	assert.match(prompt, /Vision one\./);
	assert.match(prompt, /Prefer small functions\./);
	assert.match(prompt, /## Human\nWrite for a person\./);
	assert.match(prompt, /## Agent\nWrite for the next worker\./);
	assert.match(prompt, /## NOW\n- now item/);
	assert.match(prompt, /## NEXT\n- next item/);
	assert.doesNotMatch(prompt, /track item|proven item/);
	assert.doesNotMatch(prompt, /opened by a job wake/);
	assert.doesNotMatch(prompt, /Audience for this reply/);
});

test("the per-turn cue names the audience and the three reply rules and stays under one kilobyte", async (context) => {
	const root = await projectRoot(context);
	await coordinatorFiles(root);
	const result = start(root);
	assert.ok(result.message);
	assert.equal(result.message.customType, "limen-project-context");
	assert.equal(result.message.display, false);
	assert.match(result.message.content, /^<limen-project-context>/);
	assert.match(result.message.content, /Audience for this reply: human/);
	assert.match(result.message.content, /First line is the answer/);
	assert.match(result.message.content, /Not `F048 is active now\.`/);
	assert.match(result.message.content, /Never open a reply with a feature number/);
	assert.match(result.message.content, /Size the reply to the question/);
	assert.doesNotMatch(result.message.content, /opened by a job wake/);
	assert.doesNotMatch(result.message.content, /Vision one\.|Prefer small functions\.|now item/);
	assert.match(result.message.content, /<\/limen-project-context>$/);
	assert.ok(Buffer.byteLength(result.message.content) < 1024);
	assert.deepEqual(extension().events, ["before_agent_start", "message_end", "tool_result"]);
});

test("a 130-line board adds one advisory line; an 80-line board does not", async (context) => {
	const root = await projectRoot(context);
	await coordinatorFiles(root);
	await writeFile(join(root, "spec/build.md"), `${Array.from({ length: 80 }, (_, index) => `- item ${index + 1}`).join("\n")}\n`);
	const short = start(root, { systemPrompt: "base" });
	assert.doesNotMatch(short.message?.content ?? "", /fold older PROVEN/);
	assert.doesNotMatch(short.systemPrompt ?? "", /fold older PROVEN/);
	await writeFile(join(root, "spec/build.md"), `${Array.from({ length: 130 }, (_, index) => `- item ${index + 1}`).join("\n")}\n`);
	const long = start(root, { systemPrompt: "base" });
	assert.match(long.message?.content ?? "", /spec\/build\.md is 130 lines; fold older PROVEN entries into monthly highlights\./);
	assert.equal((long.message?.content.match(/fold older PROVEN/g) ?? []).length, 1);
	assert.doesNotMatch(long.systemPrompt ?? "", /fold older PROVEN/);
});

test("a wake turn puts the wake cue in the per-turn note, not the system prompt", async (context) => {
	const root = await projectRoot(context);
	await coordinatorFiles(root);
	const result = start(root, { prompt: 'Limen job "F031 retry" is done (abc) on branch limen/abc.', systemPrompt: "base" });
	assert.match(result.message?.content ?? "", /opened by a job wake/);
	assert.match(result.message?.content ?? "", /Audience for this reply: human/);
	assert.doesNotMatch(result.systemPrompt ?? "", /opened by a job wake/);
});

test("a write under spec/, an edit of code, and limen spawn recall the matching rule on the tool result", async (context) => {
	const root = await projectRoot(context);
	const spec = tool(root, {
		toolName: "write",
		input: { path: "spec/features/planned/F999-x/ticket.md" },
		content: [{ type: "text", text: "wrote ticket" }],
	});
	const specText = textOf(spec.content);
	assert.match(specText, /wrote ticket/);
	assert.match(specText, /\[limen\] Specs:/);
	assert.ok(specText.endsWith("Title is `FNNN · what becomes true`."));

	const code = tool(root, {
		toolName: "edit",
		input: { path: "src/x.ts" },
		content: [{ type: "text", text: "edited file" }],
	});
	const codeText = textOf(code.content);
	assert.match(codeText, /edited file/);
	assert.match(codeText, /\[limen\] Styleguide: no project file at \.agents\/limen\/styleguide\.md\./);
	assert.doesNotMatch(codeText, /TypeScript|index\.ts|one human|Inform, do not gate/);

	const spawn = tool(root, {
		toolName: "bash",
		input: { command: 'limen spawn --label "F999 x" "Implement F999."' },
		content: [{ type: "text", text: "started" }],
	});
	const spawnText = textOf(spawn.content);
	assert.match(spawnText, /started/);
	assert.match(spawnText, /\[limen\] Vision: no project file at spec\/vision\.md\./);
	assert.doesNotMatch(spawnText, /one human|one coordinator|Inform; do not gate/);

	const merge = tool(root, {
		toolName: "bash",
		input: { command: "git merge limen/f999" },
		content: [{ type: "text", text: "merged" }],
	});
	assert.match(textOf(merge.content), /\[limen\] Vision:/);

	const planned = tool(root, {
		toolName: "bash",
		input: { command: "mkdir -p spec/features/planned/F999-x" },
		content: [{ type: "text", text: "created" }],
	});
	assert.match(textOf(planned.content), /\[limen\] Vision:/);
});

test("an errored previous assistant turn puts the error on the next cue, a successful one does not", async (context) => {
	const root = await projectRoot(context);
	await coordinatorFiles(root);
	const { handlers } = extension();
	handlers.message_end?.({ message: { role: "assistant", content: [], stopReason: "error", errorMessage: "usage limit reached" } });
	const failed = handlers.before_agent_start?.({}, { cwd: root })?.message?.content ?? "";
	assert.match(failed, /The previous turn failed with error: usage limit reached and nothing reached the human/);
	const again = handlers.before_agent_start?.({}, { cwd: root })?.message?.content ?? "";
	assert.doesNotMatch(again, /previous turn failed/);
	handlers.message_end?.({ message: { role: "assistant", content: [{ type: "text", text: "ok" }], stopReason: "stop" } });
	const ok = handlers.before_agent_start?.({}, { cwd: root })?.message?.content ?? "";
	assert.doesNotMatch(ok, /previous turn failed/);
	handlers.message_end?.({ message: { role: "assistant", content: [], stopReason: "aborted" } });
	const aborted = handlers.before_agent_start?.({}, { cwd: root })?.message?.content ?? "";
	assert.match(aborted, /The previous turn failed with aborted and nothing reached the human/);
});

test("the next turn names what the last turn touched", async (context) => {
	const root = await projectRoot(context);
	await coordinatorFiles(root);
	const { handlers } = extension();
	handlers.tool_result?.({ toolName: "edit", input: { path: "src/x.ts" }, content: [{ type: "text", text: "ok" }] }, { cwd: root });
	const content = handlers.before_agent_start?.({}, { cwd: root })?.message?.content ?? "";
	assert.match(content, /Last turn edited src\/x\.ts; the styleguide governs how files are written\./);
	const after = handlers.before_agent_start?.({}, { cwd: root })?.message?.content ?? "";
	assert.doesNotMatch(after, /Last turn edited/);
});

test("a hosted worker's system prompt holds the styleguide and both register audiences and no board body", async (context) => {
	const root = await projectRoot(context);
	await coordinatorFiles(root);
	await mkdir(join(root, ".limen/jobs/job1"), { recursive: true });
	await writeFile(join(root, ".limen/jobs/job1/task.md"), "Implement F053.\nTicket: spec/features/active/F053-guidance-recall/ticket.md\n");
	stashEnv(context, { LIMEN_JOB: "1", LIMEN_HOSTED: "1", LIMEN_JOB_ID: "job1", LIMEN_CONTEXT_ROOT: root });
	const result = start(root, { systemPrompt: "pi-base" });
	const prompt = result.systemPrompt ?? "";
	assert.match(prompt, /## Styleguide \(.agents\/limen\/styleguide\.md\)\nPrefer small functions\./);
	assert.match(prompt, /## Human\nWrite for a person\./);
	assert.match(prompt, /## Agent\nWrite for the next worker\./);
	assert.doesNotMatch(prompt, /## Board digest/);
	assert.doesNotMatch(prompt, /now item|next item/);
	assert.doesNotMatch(prompt, /## Vision \(spec\/vision\.md\)/);
	assert.doesNotMatch(prompt, /Shop manual/);
	assert.doesNotMatch(prompt, /Vision one\./);
	const cue = result.message?.content ?? "";
	assert.match(cue, /Audience for this reply: agent/);
	assert.match(cue, /Ticket: spec\/features\/active\/F053-guidance-recall\/ticket\.md/);
	assert.match(cue, /Vision \(read-only\): `spec\/vision\.md`/);
	assert.match(cue, /Board \(read-only\): `spec\/build\.md`/);
	assert.doesNotMatch(cue, /## Guidance drift/);
});

test("workspace jobs resolve guidance from the workspace root", async (context) => {
	const root = await projectRoot(context);
	const worktree = join(root, "api-worktree");
	await mkdir(worktree);
	await coordinatorFiles(root);
	stashEnv(context, { LIMEN_JOB: "1", LIMEN_CONTEXT_ROOT: root });
	const prompt = start(worktree).systemPrompt ?? "";
	assert.match(prompt, /Prefer small functions\./);
	assert.match(prompt, /Write for the next worker\./);
	assert.doesNotMatch(prompt, /Vision one\./);
});

test("guidance is reread each turn, so a file planted mid-session appears on the next message", async (context) => {
	const root = await projectRoot(context);
	const { handlers } = extension();
	const first = handlers.before_agent_start?.({ systemPrompt: "base" }, { cwd: root })?.systemPrompt ?? "";
	assert.doesNotMatch(first, /## Vision \(spec\/vision\.md\)/);
	await writeFile(join(root, "spec/vision.md"), "First direction.\n");
	const second = handlers.before_agent_start?.({ systemPrompt: "base" }, { cwd: root })?.systemPrompt ?? "";
	assert.match(second, /## Vision \(spec\/vision\.md\)\nFirst direction\./);
});

test("a project overlay wins over the package speech register", async (context) => {
	const root = await projectRoot(context);
	await writeFile(join(root, ".agents/limen/communication.md"), "Write for a person.\n");
	const result = start(root, { systemPrompt: "base" });
	assert.match(result.systemPrompt ?? "", /## Communication \(.agents\/limen\/communication\.md\)\nWrite for a person\./);
	assert.match(result.message?.content ?? "", /Audience for this reply: human/);
	assert.doesNotMatch(result.systemPrompt ?? "", /opened by a job wake/);
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
	const result = start(root, { systemPrompt: "base" });
	const prompt = result.systemPrompt ?? "";
	assert.match(prompt, /## Communication \(limen\/templates\/communication\.md\)/);
	assert.match(prompt, /did not write this code/);
	assert.match(prompt, /When the previous turn failed, the first line says it failed and what is being redone/);
	assert.match(prompt, /## Human/);
	assert.match(prompt, /## Agent/);
	assert.match(prompt, /\*\*An explanation\.\*\* They asked why, or what happened\. Past tense, no new action: no tool call, no next step/);
	assert.match(prompt, /what works now; what is being built and by whom; what is blocked and on what/);
	assert.match(prompt, /what you can try now/);
	assert.match(prompt, /A pasted style instruction governs the rest of the conversation/);
	assert.match(prompt, /A wake for a job already closed is not news: one line, or nothing/);
	assert.match(result.message?.content ?? "", /Audience for this reply: human/);
});

test("a coordinator without AGENTS.md inherits the package shop manual on the system prompt", async (context) => {
	const root = await projectRoot(context);
	const result = start(root, { systemPrompt: "base" });
	assert.match(result.systemPrompt ?? "", /## Shop manual \(limen\/templates\/agents\.md\)/);
	assert.match(result.systemPrompt ?? "", /plain specifications/);
	assert.doesNotMatch(result.message?.content ?? "", /Shop manual/);
});

test("a project AGENTS.md suppresses the inherited shop manual", async (context) => {
	const root = await projectRoot(context);
	await writeFile(join(root, "AGENTS.md"), "custom shop\n");
	const prompt = start(root, { systemPrompt: "base" }).systemPrompt ?? "";
	assert.doesNotMatch(prompt, /Shop manual/);
	assert.doesNotMatch(prompt, /custom shop/);
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

test("over fifty simulated turns custom messages stay under fifty kilobytes", async (context) => {
	const root = await projectRoot(context);
	await coordinatorFiles(root);
	const { handlers } = extension();
	let total = 0;
	for (let turn = 0; turn < 50; turn++) {
		const content = handlers.before_agent_start?.({ systemPrompt: "base" }, { cwd: root })?.message?.content ?? "";
		assert.ok(Buffer.byteLength(content) < 1024, `turn ${turn} cue was ${Buffer.byteLength(content)} bytes`);
		total += Buffer.byteLength(content);
	}
	assert.ok(total < 50 * 1024, `fifty turns accumulated ${total} bytes`);
});

test("style and vision reminders name the project files and their headings", async (context) => {
	const root = await projectRoot(context);
	await writeFile(join(root, ".agents/limen/styleguide.md"), ["# Rust house style", "", "## No unwrap in libraries", "", "## Prefer iterators", ""].join("\n"));
	await writeFile(join(root, "spec/vision.md"), ["# Product", "", "## Ships on Friday", "", "## One binary", ""].join("\n"));

	const code = tool(root, {
		toolName: "edit",
		input: { path: "src/main.rs" },
		content: [{ type: "text", text: "edited rust" }],
	});
	const codeText = textOf(code.content);
	assert.match(codeText, /edited rust/);
	assert.match(codeText, /\[limen\] Styleguide \(\.agents\/limen\/styleguide\.md\): Rust house style; No unwrap in libraries; Prefer iterators\./);
	assert.doesNotMatch(codeText, /TypeScript|index\.ts|one human|Inform, do not gate/);

	const spawn = tool(root, {
		toolName: "bash",
		input: { command: 'limen spawn --label "F999 x" "Implement F999."' },
		content: [{ type: "text", text: "started" }],
	});
	const spawnText = textOf(spawn.content);
	assert.match(spawnText, /\[limen\] Vision \(spec\/vision\.md\): Product; Ships on Friday; One binary\./);
	assert.doesNotMatch(spawnText, /one human|one coordinator|Inform; do not gate/);

	await writeFile(join(root, ".agents/limen/styleguide.md"), "Prefer small functions.\n");
	const bare = tool(root, {
		toolName: "edit",
		input: { path: "src/x.ts" },
		content: [{ type: "text", text: "edited file" }],
	});
	assert.match(textOf(bare.content), /\[limen\] Styleguide \(\.agents\/limen\/styleguide\.md\): no headings; read the file\./);
});

test("a write or edit outside spec/ recalls the styleguide unless the path is Markdown", async (context) => {
	const root = await projectRoot(context);
	await writeFile(join(root, ".agents/limen/styleguide.md"), "## Keep functions small\n");

	for (const path of ["src/main.rs", "ui/App.svelte", "styles/app.css"]) {
		const result = tool(root, {
			toolName: "edit",
			input: { path },
			content: [{ type: "text", text: "ok" }],
		});
		assert.match(textOf(result.content), /\[limen\] Styleguide \(\.agents\/limen\/styleguide\.md\): Keep functions small\./);
	}

	const markdown = tool(root, {
		toolName: "write",
		input: { path: "docs/note.md" },
		content: [{ type: "text", text: "notes" }],
	});
	assert.equal(markdown.content, undefined);

	const spec = tool(root, {
		toolName: "edit",
		input: { path: "spec/features/planned/F999-x/ticket.md" },
		content: [{ type: "text", text: "ticket" }],
	});
	assert.match(textOf(spec.content), /\[limen\] Specs:/);
	assert.doesNotMatch(textOf(spec.content), /Styleguide/);
});

test("unrelated tools are not patched", async (context) => {
	const root = await projectRoot(context);
	const result = tool(root, {
		toolName: "read",
		input: { path: "src/x.ts" },
		content: [{ type: "text", text: "source" }],
	});
	assert.equal(result.content, undefined);
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
	const lines = execFileSync("git", ["log", "-2", "--format=%H %cs", "--", source], { cwd: ROOT, encoding: "utf8" }).trim().split("\n");
	const parsed = lines.map((line) => ({ hash: line.slice(0, 40), date: line.slice(41) }));
	const latest = parsed[0];
	const previous = parsed[1];
	assert.ok(latest && previous, `need two revisions of ${source}`);
	return [latest, previous];
}
