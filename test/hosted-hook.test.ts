import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import limenHosted from "../hook/hosted.ts";
import { reportHostedStall, restoreHostedPane } from "../src/herdr.ts";

test("hosted refresh preserves supervisor warnings, promptly recovers RUNNING labels, and cleans up on shutdown", async (context) => {
	const root = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "limen-hosted-metadata-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const job = join(root, ".limen/jobs/job-1");
	await mkdir(job, { recursive: true });
	await writeFile(join(job, "state"), "running\n");
	const calls = join(root, "calls");
	const fake = join(root, "herdr");
	await writeFile(fake, `#!/bin/sh\nprintf '%s\\n' "$@" "" >> "${calls}"\n`);
	await chmod(fake, 0o755);
	for (const [key, value] of Object.entries({
		LIMEN_HOSTED: "1",
		LIMEN_JOB: "1",
		LIMEN_CONTEXT_ROOT: root,
		LIMEN_JOB_ID: "job-1",
		LIMEN_ROLE: "reviewer",
		LIMEN_HERDR: fake,
		HERDR_ENV: "1",
		HERDR_PANE_ID: "w1:p1",
	})) {
		const previous = process.env[key];
		process.env[key] = value;
		context.after(() => {
			if (previous === undefined) delete process.env[key];
			else process.env[key] = previous;
		});
	}
	const handlers = new Map<string, (event?: unknown) => void>();
	limenHosted({ on: (event, handler) => handlers.set(event, handler as (event?: unknown) => void) });
	const readCalls = async (): Promise<string[][]> =>
		(await readFile(calls, "utf8").catch(() => ""))
			.trim()
			.split("\n\n")
			.filter(Boolean)
			.map((call) => call.split("\n"));
	const waitFor = async (predicate: (calls: string[][]) => boolean) => {
		const deadline = performance.now() + 3_000;
		while (!predicate(await readCalls()) && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
		assert.ok(predicate(await readCalls()), "expected hosted metadata report");
	};
	context.mock.timers.enable({ apis: ["setInterval", "Date"] });
	handlers.get("session_start")?.({});
	context.after(() => handlers.get("session_shutdown")?.({}));
	handlers.get("turn_end")?.({});
	handlers.get("agent_settled")?.({});
	await waitFor((calls) => calls.some((call) => call.includes("idle=job RUNNING · pane ready")));
	const running = (await readCalls()).find((call) => call.includes("idle=job RUNNING · pane ready"));
	assert.ok(running);
	assert.ok(running.includes("done=job RUNNING · pane ready"));
	assert.ok(running.includes("limen=job RUNNING"));
	assert.ok(running.includes("limen reviewer"));
	assert.equal(await readFile(join(job, "state"), "utf8"), "running\n", "settlement cannot finish the job");
	context.mock.timers.tick(61_000);
	await waitFor((calls) => calls.filter((call) => call.includes("limen=job RUNNING")).length >= 2);
	for (const advisory of ["idle 2m after 4 tool calls", "blocked after 4 tool calls", "errored: last turn failed with error: usage limit reached"]) {
		await writeFile(join(job, "advisory"), `${advisory}, session still open\n`);
		reportHostedStall({ pane: "w1:p1", label: "job-1", duration: "2m", notify: false });
		const beforeStall = (await readCalls()).filter((call) => call.includes("limen=job RUNNING")).length;
		await waitFor((calls) => calls.at(-1)?.includes("blocked=⚠ stalled 2m") === true);
		const stalled = (await readCalls()).length;
		context.mock.timers.tick(advisory.startsWith("idle") ? 61_000 : 1_000);
		handlers.get("agent_settled")?.({});
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.equal((await readCalls()).length, stalled, `${advisory}: heartbeat and settlement must leave the supervisor warning alone`);
		assert.match(await readFile(join(job, "advisory"), "utf8"), /session still open/);
		await rm(join(job, "advisory"));
		restoreHostedPane("w1:p1", "reviewer");
		await waitFor((calls) => calls.at(-1)?.includes("--clear-state-labels") === true);
		context.mock.timers.tick(1_000);
		await waitFor((calls) => calls.filter((call) => call.includes("limen=job RUNNING")).length > beforeStall);
		assert.ok((await readCalls()).at(-1)?.includes("done=job RUNNING · pane ready"), "recovery must not wait for the 60s refresh cache");
	}
	await writeFile(join(job, "state"), "stopped\n");
	context.mock.timers.tick(1_000);
	await waitFor((calls) => calls.some((call) => call.includes("limen=job STOPPED")));
	assert.ok((await readCalls()).some((call) => call.includes("done=job STOPPED · pane ready")));
	await writeFile(join(job, "advisory"), "blocked after 4 tool calls, session still open\n");
	reportHostedStall({ pane: "w1:p1", label: "job-1", duration: "2m", notify: false });
	await waitFor((calls) => calls.at(-1)?.includes("blocked=⚠ stalled 2m") === true);
	handlers.get("session_shutdown")?.({});
	await waitFor((calls) => calls.at(-1)?.includes("--clear-token") === true);
	const before = (await readCalls()).length;
	context.mock.timers.tick(180_000);
	assert.equal((await readCalls()).length, before, "shutdown must stop metadata refresh");
	for (const call of await readCalls()) {
		assert.deepEqual(call.slice(0, 5), ["pane", "report-metadata", "w1:p1", "--source", "limen"]);
		assert.ok(!call.includes("--state"));
		if (call.includes("--seq")) assert.ok(!call.some((arg) => arg.startsWith("blocked=")), "only the supervisor owns the blocker label");
	}
	const seqs = (await readCalls()).filter((call) => call.includes("--seq")).map((call) => Number(call[call.indexOf("--seq") + 1]));
	assert.equal(new Set(seqs).size, seqs.length, "sequencing must reject late pre-shutdown reports");
});

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
