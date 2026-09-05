import assert from "node:assert/strict";
import test from "node:test";
import { assistantStopReason, createClaudeStreamParser, createStreamParser } from "../src/stream.ts";

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
	assert.deepEqual(parser.push('{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"stop"}}\n'), [{ kind: "assistant", text: "" }]);
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

test("claude events become the same log, tool names, and one closing result", () => {
	const parser = createClaudeStreamParser();
	assert.deepEqual(parser.push('{"type":"system","subtype":"init","session_id":"abc"}\n'), [
		{ kind: "session", id: "abc" },
		{ kind: "activity", name: "think" },
	]);
	assert.deepEqual(parser.push('{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"npm run check"}}]}}\n'), [
		{ kind: "tool", name: "Bash", detail: "npm run check" },
	]);
	assert.deepEqual(parser.push('{"type":"user","message":{"content":[{"type":"tool_result"}]}}\n'), [{ kind: "activity", name: "wait" }]);
	// Assistant text is the turn's message, as pi's message_end is; a clean closing result adds nothing,
	// so the answer reaches the log and the result file exactly once.
	assert.deepEqual(parser.push('{"type":"assistant","message":{"content":[{"type":"thinking","thinking":""},{"type":"text","text":"the verdict"}]}}\n'), [
		{ kind: "activity", name: "think" },
		{ kind: "assistant", text: "the verdict" },
	]);
	assert.deepEqual(parser.push('{"type":"result","subtype":"success","is_error":false,"result":"the verdict"}\n'), []);
	assert.deepEqual(parser.push('{"type":"result","subtype":"error_during_execution","is_error":true,"result":""}\n'), [
		{ kind: "assistant", text: "", stopReason: "error: error_during_execution" },
	]);
	assert.deepEqual(parser.push("plain diagnostic\n"), [{ kind: "log", line: "plain diagnostic" }]);
	assert.deepEqual(parser.push('{"type":"rate_limit_event"}\n'), []);
	assert.deepEqual(parser.flush(), []);
});
