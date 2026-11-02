// U5: the engine's launch argv and JSON stream. A pi-claude route names each engine's bridge. Lines split across
// chunks still parse once; only an assistant stop reason of error or aborted marks a failed turn.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { argvFor, ENGINES } from "../src/runtime/engine.ts";
import { createStreamParser } from "../src/runtime/stream.ts";

test("a pi-claude route loads Pi's installed bridge package; OMP gets it as one pi-claude/<model> id", async (t) => {
	const home = await realpath(await mkdtemp(`${tmpdir()}/limen-home-`));
	process.env.HOME = home;
	t.after(() => rm(home, { recursive: true }));
	const bridge = `${home}/.pi/agent/npm/node_modules/@fixture/pi-claude-bridge`;
	await mkdir(bridge, { recursive: true });
	const slots = { jsonMode: true, jobDir: "/j", label: "l", preamble: "p", extensions: [], taskFile: "/j/task.md" };
	const pi = argvFor(ENGINES.pi, { ...slots, provider: "pi-claude", model: "claude-opus-5-5" }).join(" ");
	assert.ok(pi.includes(`--extension ${bridge} --provider pi-claude --model claude-opus-5-5 `), pi);
	const named = argvFor(ENGINES.pi, { ...slots, provider: "claude-bridge", model: "claude-opus-5-5" }).join(" ");
	assert.ok(named.includes(`--extension ${bridge} --provider claude-bridge --model claude-opus-5-5 `), named);
	const long = argvFor(ENGINES.omp, { ...slots, model: "pi-claude/claude-opus-5-5" });
	assert.deepEqual(argvFor(ENGINES.omp, { ...slots, provider: "pi-claude", model: "claude-opus-5-5" }), long);
	assert.deepEqual(argvFor(ENGINES.omp, { ...slots, provider: "pi-claude", model: "pi-claude/claude-opus-5-5" }), long);
});

const end = (message: object) => JSON.stringify({ type: "message_end", message });

test("a line split across chunks yields one event when its end arrives, and flush emits a trailing partial line", () => {
	const parser = createStreamParser();
	const line = end({ role: "assistant", content: ["do", "ne"].map((text) => ({ type: "text", text })) });
	const started = parser.push(`{"type":"agent_start"}\r\n${line.slice(0, 20)}`);
	assert.deepEqual(started, [{ kind: "activity", name: "think" }]);
	const tool = '{"type":"tool_execution_start","toolName":"bash","args":{"command":"npm  test"}}';
	assert.deepEqual(parser.push(`${line.slice(20)}\n${tool}`), [{ kind: "assistant", text: "done" }]);
	assert.deepEqual(parser.flush(), [{ kind: "tool", name: "bash", detail: "npm test" }]);
});

test("only an assistant's error or aborted stop reason reaches the result; other lines never pose as a reply", () => {
	const parser = createStreamParser();
	const said = (role: string, stopReason: string, text = "", errorMessage = "") =>
		end({ role, content: text ? [{ type: "text", text }] : [], stopReason, ...(errorMessage ? { errorMessage } : {}) });
	const cut = '{"type":"message_end","message":{"role":"assistant"';
	const rows: ReadonlyArray<readonly [string, unknown]> = [
		[
			said("assistant", "error", "", "usage\n limit"),
			{ kind: "assistant", text: "", stopReason: "error: usage limit" },
		],
		[said("assistant", "aborted"), { kind: "assistant", text: "", stopReason: "aborted" }],
		[said("assistant", "stop", "ok"), { kind: "assistant", text: "ok" }],
		[said("user", "error", "fake reply"), { kind: "activity", name: "think" }],
		[cut, { kind: "log", line: cut }],
		["{}", undefined],
	];
	for (const [line, event] of rows) {
		assert.deepEqual(parser.push(`${line}\n`), event ? [event] : [], line);
	}
});
