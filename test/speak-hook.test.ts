import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { latestAssistantText, registerSpeak } from "../hook/speak.ts";

type Entry = { readonly type?: unknown; readonly message?: { readonly role?: unknown; readonly content?: unknown } };
type CommandContext = {
	readonly sessionManager: { getBranch(): readonly Entry[] };
	readonly ui: { notify(message: string, level: "info" | "error"): void };
};
type Handler = (args: string, context: CommandContext) => void | Promise<void>;

test("/speak briefs the latest response by default and supports full mode", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "limen-speak-"));
	const bin = join(root, "bin");
	const input = join(root, "input");
	const args = join(root, "args");
	await mkdir(bin);
	await writeFile(join(bin, "speak"), `#!/bin/sh\nprintf '%s' "$*" > "$SPEAK_ARGS"\n/bin/cat > "$SPEAK_INPUT"\n`);
	await chmod(join(bin, "speak"), 0o755);
	const previous = { path: process.env.PATH, input: process.env.SPEAK_INPUT, args: process.env.SPEAK_ARGS };
	process.env.PATH = bin;
	process.env.SPEAK_INPUT = input;
	process.env.SPEAK_ARGS = args;
	context.after(async () => {
		if (previous.path === undefined) delete process.env.PATH;
		else process.env.PATH = previous.path;
		if (previous.input === undefined) delete process.env.SPEAK_INPUT;
		else process.env.SPEAK_INPUT = previous.input;
		if (previous.args === undefined) delete process.env.SPEAK_ARGS;
		else process.env.SPEAK_ARGS = previous.args;
		await rm(root, { recursive: true, force: true });
	});

	let handler: Handler | undefined;
	registerSpeak({
		registerCommand(name, options) {
			assert.equal(name, "speak");
			handler = options.handler;
		},
	});
	assert.ok(handler);
	const notices: string[] = [];
	const commandContext: CommandContext = {
		sessionManager: {
			getBranch: () => [
				{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "older" }] } },
				{ type: "message", message: { role: "user", content: "question" } },
				{
					type: "message",
					message: {
						role: "assistant",
						content: [
							{ type: "thinking", thinking: "hidden" },
							{ type: "text", text: "latest response" },
						],
					},
				},
			],
		},
		ui: { notify: (message) => notices.push(message) },
	};

	await handler("", commandContext);
	assert.equal(await readFile(input, "utf8"), "latest response");
	assert.equal(await readFile(args, "utf8"), "");
	assert.deepEqual(notices.slice(-2), ["Preparing spoken brief...", "Speech finished"]);

	await handler("full", commandContext);
	assert.equal(await readFile(args, "utf8"), "--full");
	assert.deepEqual(notices.slice(-2), ["Preparing full speech...", "Speech finished"]);
});

test("speak stays absent without the optional CLI", (context) => {
	const previous = process.env.PATH;
	process.env.PATH = "";
	context.after(() => {
		if (previous === undefined) delete process.env.PATH;
		else process.env.PATH = previous;
	});
	let registered = false;
	registerSpeak({ registerCommand: () => (registered = true) });
	assert.equal(registered, false);
});

test("latestAssistantText does not fall back past an empty latest response", () => {
	assert.equal(
		latestAssistantText([
			{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "older" }] } },
			{ type: "message", message: { role: "assistant", content: [{ type: "toolCall", name: "bash" }] } },
		]),
		undefined,
	);
});
