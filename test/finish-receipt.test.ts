import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { finishEvent, inspectFinishWebhook, parseFinishReceipt } from "../src/finish-receipt.ts";

const inheritedSource = process.env.LIMEN_FINISH_EVIDENCE_DIR;
test.beforeEach(() => {
	delete process.env.LIMEN_FINISH_EVIDENCE_DIR;
});
test.afterEach(() => {
	if (inheritedSource === undefined) delete process.env.LIMEN_FINISH_EVIDENCE_DIR;
	else process.env.LIMEN_FINISH_EVIDENCE_DIR = inheritedSource;
});

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

test("only explicitly trusted, bounded, correlated completed-turn exports promote inspection", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "limen-turn-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const job = join(root, "job");
	const source = join(root, "receiver-owned");
	await mkdir(job);
	await mkdir(source);
	await writeFile(join(job, "finish-webhook-env"), "/must-not-be-opened/private.env\n");
	await writeFile(join(job, "finish-webhook-targets"), `${JSON.stringify(accepted)}\n`);
	const event = finishEvent(job);
	const manifest = {
		version: 1,
		targets: [
			{ target: 1, receiver: "johnny" },
			{ target: 2, receiver: "tony" },
		],
	};
	const completed = { version: 1, event, target: 1, receiver: "johnny", state: "completed", session: "session-1", turn: "turn-1", completedAt: accepted.at };
	const mappingFile = join(source, "receivers.json");
	const exportFile = join(source, `${event}.1.json`);
	await writeFile(mappingFile, JSON.stringify(manifest));
	await writeFile(exportFile, JSON.stringify(completed));
	await writeFile(join(job, "finish-webhook-bot-turn"), JSON.stringify(completed));
	await writeFile(join(job, "finish-evidence-dir"), source);
	assert.match(await inspectFinishWebhook(job), /bot-turn: unobserved/, "no implicit local source selection");
	process.env.LIMEN_FINISH_EVIDENCE_DIR = "relative";
	assert.match(await inspectFinishWebhook(job), /bot-turn: unobserved/);
	process.env.LIMEN_FINISH_EVIDENCE_DIR = source;
	assert.match(await inspectFinishWebhook(job), /target 1: transport accepted[^\n]*bot-turn observed[^\n]*receiver johnny[^\n]*turn turn-1/);
	for (const invalid of [
		null,
		[],
		{ ...completed, version: 2 },
		{ ...completed, event: finishEvent("other-job") },
		{ ...completed, target: 2 },
		{ ...completed, receiver: "tony" },
		{ ...completed, state: "queued" },
		{ ...completed, state: "failed" },
		{ ...completed, turn: "" },
		{ ...completed, session: "" },
		{ ...completed, completedAt: "2026-02-30T12:00:00.000Z" },
		{ ...completed, completedAt: "secret" },
		{ ...completed, body: "secret" },
		{ ...completed, observed: true },
		{ ...completed, session: "https://secret.invalid" },
		{ ...completed, turn: "secret\u001b[31m" },
		{ ...completed, turn: "x".repeat(97) },
	]) {
		await writeFile(exportFile, JSON.stringify(invalid));
		const detail = await inspectFinishWebhook(job);
		assert.match(detail, /bot-turn: unobserved/, JSON.stringify(invalid));
		assert.doesNotMatch(detail, /secret|private.env/);
	}
	for (const content of ["{", "", `${JSON.stringify(completed)}${" ".repeat(4096)}`]) {
		await writeFile(exportFile, content);
		assert.match(await inspectFinishWebhook(job), /bot-turn: unobserved/);
	}
	await rm(exportFile);
	assert.match(await inspectFinishWebhook(job), /bot-turn: unobserved/);
	await mkdir(exportFile);
	assert.match(await inspectFinishWebhook(job), /bot-turn: unobserved/);
	await rm(exportFile, { recursive: true });
	const elsewhere = join(root, "elsewhere.json");
	await writeFile(elsewhere, JSON.stringify(completed));
	await symlink(elsewhere, exportFile);
	assert.match(await inspectFinishWebhook(job), /bot-turn: unobserved/);
	await rm(exportFile);
	await writeFile(exportFile, JSON.stringify(completed));
	for (const invalid of [
		null,
		{ ...manifest, version: 2 },
		{ ...manifest, targets: [...manifest.targets, manifest.targets[0]] },
		{ ...manifest, targets: [{ target: 1, receiver: "tony" }] },
		{ ...manifest, body: "secret" },
		{ ...manifest, targets: Array(65).fill(manifest.targets[0]) },
	]) {
		await writeFile(mappingFile, JSON.stringify(invalid));
		assert.match(await inspectFinishWebhook(job), /bot-turn: unobserved/);
	}
	await writeFile(mappingFile, `${JSON.stringify(manifest)}${" ".repeat(16_384)}`);
	assert.match(await inspectFinishWebhook(job), /bot-turn: unobserved/);
	await writeFile(mappingFile, JSON.stringify(manifest));
	await rm(join(job, "finish-webhook-targets"));
	assert.match(await inspectFinishWebhook(job), /target 1: transport unknown[^\n]*bot-turn observed/, "receiver completion does not require HTTP acceptance");
});
