// U12: a completion wake tells the coordinator to land only a done job that is not a scout. A failed job reached
// through the Herdr route keeps the failure instruction, and a done scout has nothing to land (F936).
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { completionWake } from "../src/job/wake-text.ts";

test("only a done job that is not a scout is sent to landing", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "u12-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	await writeFile(join(dir, "task.md"), "Scout F001.\n");
	await writeFile(join(dir, "tool-calls"), "4\n");
	const wake = (state: string) =>
		completionWake(dir, "F001", state, "id", "limen/id", "", false, "Inspect it before landing.");
	assert.doesNotMatch(wake("failed"), /landing/);
	assert.match(wake("done"), /before landing/);
	await writeFile(join(dir, "role"), "scout\n");
	assert.match(wake("done"), /Nothing to land/);
	assert.doesNotMatch(wake("done"), /before landing|land it/);
});
