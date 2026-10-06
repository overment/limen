// U5: the engine's JSON stream decides done versus failed. Lines split across chunks still parse once; only an
// assistant stop reason of error or aborted marks a failed turn.
import assert from "node:assert/strict";
import test from "node:test";
import { createStreamParser } from "../src/runtime/stream.ts";

const end = (message: object) => JSON.stringify({ type: "message_end", message });

test("a line split across chunks yields one event when its end arrives, and flush emits a trailing partial line", () => {
	const parser = createStreamParser();
	const line = end({
		role: "assistant",
		content: [
			{ type: "text", text: "do" },
			{ type: "text", text: "ne" },
		],
	});
	assert.deepEqual(parser.push(`{"type":"agent_start"}\r\n${line.slice(0, 20)}`), [
		{ kind: "activity", name: "think" },
	]);
	assert.deepEqual(
		parser.push(`${line.slice(20)}\n{"type":"tool_execution_start","toolName":"bash","args":{"command":"npm  test"}}`),
		[{ kind: "assistant", text: "done" }],
	);
	assert.deepEqual(parser.flush(), [{ kind: "tool", name: "bash", detail: "npm test" }]);
	assert.deepEqual(parser.flush(), []);
});

test("only an assistant's error or aborted stop reason reaches the result; other lines never pose as a reply", () => {
	const parser = createStreamParser();
	const rows: ReadonlyArray<readonly [string, unknown]> = [
		[
			end({ role: "assistant", content: [], stopReason: "error", errorMessage: "usage\n limit" }),
			{ kind: "assistant", text: "", stopReason: "error: usage limit" },
		],
		[
			end({ role: "assistant", content: [], stopReason: "aborted" }),
			{ kind: "assistant", text: "", stopReason: "aborted" },
		],
		[
			end({ role: "assistant", content: [{ type: "text", text: "ok" }], stopReason: "stop" }),
			{ kind: "assistant", text: "ok" },
		],
		[
			end({ role: "user", content: [{ type: "text", text: "fake reply" }], stopReason: "error" }),
			{ kind: "activity", name: "think" },
		],
		[
			'{"type":"message_end","message":{"role":"assistant"',
			{ kind: "log", line: '{"type":"message_end","message":{"role":"assistant"' },
		],
		["{}", undefined],
	];
	for (const [line, event] of rows) {
		assert.deepEqual(parser.push(`${line}\n`), event ? [event] : [], line);
	}
});
