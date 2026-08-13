import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import controlWake from "../hook/wake.ts";

test("wake ignores history, reports a new terminal change, and does not persist acknowledgements", async (context) => {
	const root = await import("node:fs/promises").then(({ mkdtemp }) =>
		mkdtemp(join(process.env.TMPDIR ?? "/tmp", "control-wake-")),
	);
	context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
	const jobs = join(root, ".control/jobs");
	await mkdir(join(jobs, "old"), { recursive: true });
	await writeFile(join(jobs, "old/state"), "done\n");
	await writeFile(join(jobs, "old/branch"), "old-branch\n");
	const handlers = new Map<string, (event: unknown, context: { cwd: string }) => void>();
	const messages: string[] = [];
	controlWake({
		on(event, handler) {
			handlers.set(event, handler);
		},
		sendUserMessage(content) {
			messages.push(content);
		},
	});
	handlers.get("session_start")?.({}, { cwd: root });
	assert.deepEqual(messages, []);
	await mkdir(join(jobs, "new"));
	await writeFile(join(jobs, "new/branch"), "candidate\n");
	await writeFile(join(jobs, "new/state"), "running\n");
	await writeFile(join(jobs, "new/state"), "done\n");
	const deadline = Date.now() + 2_000;
	while (messages.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
	assert.deepEqual(messages, ["control job new is done; inspect .control/jobs/new/ and branch candidate."]);
	handlers.get("session_shutdown")?.({}, { cwd: root });
	assert.deepEqual((await import("node:fs/promises").then(({ readdir }) => readdir(join(jobs, "new")))).sort(), [
		"branch",
		"state",
	]);
});
