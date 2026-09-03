import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import limenHosted from "../hook/hosted.ts";

test("hosted finish writes the handoff and shuts down; a text-only turn records zero tools", async (context) => {
	const root = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-hosted-hook-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const id = "job-1";
	const job = join(root, ".limen/jobs", id);
	await mkdir(job, { recursive: true });
	await writeFile(join(job, "state"), "running\n");
	const inherited = {
		LIMEN_HOSTED: process.env.LIMEN_HOSTED,
		LIMEN_JOB: process.env.LIMEN_JOB,
		LIMEN_CONTEXT_ROOT: process.env.LIMEN_CONTEXT_ROOT,
		LIMEN_JOB_ID: process.env.LIMEN_JOB_ID,
	};
	process.env.LIMEN_HOSTED = "1";
	process.env.LIMEN_JOB = "1";
	process.env.LIMEN_CONTEXT_ROOT = root;
	process.env.LIMEN_JOB_ID = id;
	context.after(() => {
		for (const [name, value] of Object.entries(inherited)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	});
	const handlers = new Map<string, (event?: unknown, context?: unknown) => void>();
	let tool:
		| {
				readonly name: string;
				execute(toolCallId: string, params: { readonly handoff?: string }, signal: unknown, onUpdate: unknown, ctx: { shutdown(): void }): Promise<unknown>;
		  }
		| undefined;
	let shutdowns = 0;
	limenHosted({
		on(event, handler) {
			handlers.set(event, handler as (event?: unknown, context?: unknown) => void);
		},
		registerTool(registered) {
			tool = registered;
		},
	});
	assert.equal(tool?.name, "finish");
	handlers.get("turn_start")?.({});
	handlers.get("turn_end")?.({});
	assert.equal(await readFile(join(job, "last-turn-tools"), "utf8"), "0\n");
	handlers.get("turn_start")?.({});
	handlers.get("tool_execution_start")?.({ toolName: "bash" });
	handlers.get("turn_end")?.({});
	assert.equal(await readFile(join(job, "last-turn-tools"), "utf8"), "1\n");
	assert.ok(tool);
	await tool.execute("1", { handoff: "landed the finish tool" }, undefined, undefined, { shutdown: () => shutdowns++ });
	assert.equal(await readFile(join(job, "result"), "utf8"), "landed the finish tool\n");
	assert.equal(shutdowns, 1);
	handlers.get("session_shutdown")?.({});
	assert.match(await readFile(join(job, "session-ended"), "utf8"), /^\d{4}-/);
});
