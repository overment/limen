import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import controlProgress from "../hook/progress.ts";

test("progress hook records tool starts without exposing a model tool", async (context) => {
	const root = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "control-progress-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, "tool-calls");
	await writeFile(path, "0\n");
	const inherited = process.env.CONTROL_TOOL_COUNT_FILE;
	process.env.CONTROL_TOOL_COUNT_FILE = path;
	context.after(() => {
		if (inherited === undefined) delete process.env.CONTROL_TOOL_COUNT_FILE;
		else process.env.CONTROL_TOOL_COUNT_FILE = inherited;
	});
	let onToolStart: (() => Promise<void>) | undefined;
	controlProgress({
		on(_event, handler) {
			onToolStart = handler;
		},
	});
	assert.equal(process.env.CONTROL_TOOL_COUNT_FILE, undefined);
	await onToolStart?.();
	await onToolStart?.();
	assert.equal(await readFile(path, "utf8"), "2\n");
});
