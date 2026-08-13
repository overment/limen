import assert from "node:assert/strict";
import test from "node:test";
import { createStreamParser } from "../src/stream.ts";

test("json events become a human log and last-tool names", () => {
	const parser = createStreamParser();
	assert.deepEqual(parser.push('{"type":"agent_start"}\n{"type":"tool_execution_start","toolName":"read"}\n'), [
		{ kind: "activity", name: "think" },
		{ kind: "tool", name: "read" },
	]);
	assert.deepEqual(parser.push('{"type":"tool_execution_end"}\n'), [{ kind: "activity", name: "wait" }]);
	assert.deepEqual(
		parser.push('{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}\n'),
		[{ kind: "log", line: "done" }],
	);
	assert.deepEqual(parser.push("plain diagnostic\n"), [{ kind: "log", line: "plain diagnostic" }]);
	assert.deepEqual(parser.flush(), []);
});
