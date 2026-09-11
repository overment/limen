import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { finishEvent, inspectFinishWebhook, parseFinishReceipt } from "../src/finish-receipt.ts";

const accepted = { target: 1, at: "2026-09-11T12:00:00.000Z", transport: "accepted", http: "2xx" };
test("receipt allowlist rejects secrets, unbounded ordinals, invalid timestamps and contradictory HTTP claims", () => {
	assert.deepEqual(parseFinishReceipt(JSON.stringify(accepted)), accepted);
	for (const value of [
		{ ...accepted, url: "https://secret.invalid" },
		{ ...accepted, body: "completed bot turn" },
		{ ...accepted, target: 65 },
		{ ...accepted, target: 0 },
		{ ...accepted, target: 1.5 },
		{ ...accepted, at: "secret" },
		{ ...accepted, at: "2026-99-99T12:00:00.000Z" },
		{ ...accepted, transport: "observed" },
		{ ...accepted, http: "5xx" },
		{ ...accepted, transport: "unknown" },
		{ ...accepted, at: "x".repeat(30_000) },
		null,
	])
		assert.equal(parseFinishReceipt(JSON.stringify(value)), undefined);
	assert.equal(parseFinishReceipt("partial JSON"), undefined);
});
test("finish identity follows the job ID across seats, not labels or worktree paths", () => {
	assert.equal(finishEvent("/mac/alice/.limen/jobs/job-a"), finishEvent("/vps/alice/.limen/jobs/job-a"));
	assert.notEqual(finishEvent("/jobs/job-a"), finishEvent("/jobs/job-b"));
	assert.match(finishEvent("/jobs/job-a"), /^limen-finish-[a-f0-9]{64}$/);
});
test("inspection keeps absent, legacy and unverifiable bot evidence unobserved without reading config", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "limen-receipt-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const job = join(root, "job");
	await mkdir(job);
	assert.match(await inspectFinishWebhook(job), /configured: no[\s\S]*transport: unknown[\s\S]*bot-turn: unobserved/);
	await writeFile(join(job, "finish-webhook-env"), "/must-not-be-opened/private.env\n");
	await writeFile(join(job, "finish-webhook"), "accepted: sender exited 0 (owner wake unobserved)\n");
	assert.match(await inspectFinishWebhook(job), /configured: yes[\s\S]*transport: unknown[\s\S]*bot-turn: unobserved/);
	await writeFile(join(job, "finish-webhook-targets"), `${JSON.stringify(accepted)}\n${JSON.stringify({ ...accepted, transport: "observed", body: "secret" })}\n{"partial":`);
	await writeFile(join(job, "finish-webhook-bot-turn"), JSON.stringify({ event: finishEvent(job), completed: true }));
	const detail = await inspectFinishWebhook(job);
	assert.match(detail, /target 1: transport accepted · HTTP 2xx/);
	assert.match(detail, /bot-turn: unobserved/);
	assert.doesNotMatch(detail, /secret|private.env|completed":true/);
});
