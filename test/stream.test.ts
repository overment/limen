import assert from "node:assert/strict";
import test from "node:test";
import { assistantStopReason, createStreamParser } from "../src/stream.ts";

test("json events become a human log and last-tool names", () => {
	const parser = createStreamParser();
	assert.deepEqual(parser.push('{"type":"agent_start"}\n{"type":"tool_execution_start","toolName":"read","args":{"path":"src/game.ts"}}\n'), [
		{ kind: "activity", name: "think" },
		{ kind: "tool", name: "read", detail: "src/game.ts" },
	]);
	assert.deepEqual(parser.push('{"type":"tool_execution_end"}\n'), [{ kind: "activity", name: "wait" }]);
	assert.deepEqual(parser.push('{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}\n'), [{ kind: "assistant", text: "done" }]);
	assert.deepEqual(parser.push('{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"error","errorMessage":"usage limit reached"}}\n'), [
		{ kind: "assistant", text: "", stopReason: "error: usage limit reached" },
	]);
	assert.deepEqual(parser.push("plain diagnostic\n"), [{ kind: "log", line: "plain diagnostic" }]);
	assert.deepEqual(parser.push("{}\n"), []);
	assert.deepEqual(parser.flush(), []);
});

test("assistantStopReason keeps only error and aborted", () => {
	assert.equal(assistantStopReason({ role: "assistant", stopReason: "error", errorMessage: "usage limit reached" }), "error: usage limit reached");
	assert.equal(assistantStopReason({ role: "assistant", stopReason: "aborted" }), "aborted");
	assert.equal(assistantStopReason({ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "ok" }] }), "");
	assert.equal(assistantStopReason({ role: "user", stopReason: "error" }), "");
});
