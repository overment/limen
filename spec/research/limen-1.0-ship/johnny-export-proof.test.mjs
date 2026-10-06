// Synthetic operator-helper checks only: no sender, receiver call or live proof.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const script = fileURLToPath(new URL("johnny-export-proof.sh", import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "limen-johnny-SYNTHETIC-"));
const project = join(temp, "project"),
	proof = join(temp, "proof");
const id = "synthetic-export-hold",
	job = join(project, ".limen/jobs", id);
const event = `limen-finish-${createHash("sha256").update(id).digest("hex")}`;
const held = join(proof, "receiver-held", `${event}.1.json`);
const source = join(proof, "receiver-source", `${event}.1.json`);
const now = new Date().toISOString();
let checks = 0;
const pass = (name) => {
	checks++;
	console.log(`PASS synthetic: ${name}`);
};
const put = (dir, name, value) => writeFileSync(join(dir, name), `${value}\n`);
const run = (mode) =>
	spawnSync("bash", [script, mode, id], {
		cwd: project,
		encoding: "utf8",
		timeout: 15000,
		env: {
			...process.env,
			PROJECT: project,
			PROOF: proof,
			LIMEN_ROOT: root,
			LIMEN_HERDR: "0",
			LIMEN_FINISH_WEBHOOK_ENV: "",
		},
	});
const success = (mode) => {
	const result = run(mode);
	assert.equal(result.status, 0, result.stderr);
};
const refusal = (mode) => {
	const result = run(mode);
	assert.equal(result.status, 1, result.stderr);
};
const receipt = (target, transport = "accepted", http = "2xx") => JSON.stringify({ target, at: now, transport, http });
const turn = {
	version: 1,
	event,
	target: 1,
	receiver: "johnny",
	state: "completed",
	session: "SYNTHETIC_SESSION",
	turn: "SYNTHETIC_TURN",
	completedAt: now,
};
try {
	for (const path of [job, join(proof, "receiver-held"), join(proof, "receiver-source")])
		mkdirSync(path, { recursive: true });
	assert.equal(spawnSync("git", ["init", "-q", project]).status, 0);
	for (const [name, value] of Object.entries({
		state: "done",
		"finished-at": now,
		"started-at": now,
		"task.md": "SYNTHETIC ONLY",
		log: "SYNTHETIC ONLY",
		label: "SYNTHETIC ONLY",
		branch: "synthetic",
		"finish-webhook-env": `${project}/.limen/finish-webhook-johnny.env`,
		"finish-webhook-attempt": now,
		"finish-webhook": `${now} accepted: sender exited 0 (owner wake unobserved)`,
		"finish-webhook-targets": receipt(1),
	}))
		put(job, name, value);
	put(
		join(proof, "receiver-source"),
		"receivers.json",
		JSON.stringify({ version: 1, targets: [{ target: 1, receiver: "johnny" }] }),
	);
	for (const name of ["mapping-owner.txt", "control-owner.txt", "receiver-history.txt", "release-owner.txt"])
		put(proof, name, "SYNTHETIC fixture only; not Johnny evidence");
	refusal("capture");
	assert.equal(existsSync(join(proof, "job-id.txt")), false);
	pass("missing held export refuses capture without snapshot");
	writeFileSync(held, JSON.stringify(turn));
	put(job, "finish-webhook-targets", receipt(1, "rejected", "4xx"));
	refusal("capture");
	pass("paused/rejected ingress cannot count as accepted control");
	put(job, "finish-webhook-targets", `${receipt(1)}\n${receipt(2)}`);
	refusal("capture");
	pass("extra recipient refuses Johnny-only control");
	put(job, "finish-webhook-targets", receipt(1));
	success("capture");
	for (const view of ["compact", "human"])
		assert.match(
			readFileSync(join(proof, `control-${view}.txt`), "utf8"),
			/target 1: transport accepted .*bot-turn unobserved/,
		);
	assert.equal(existsSync(source), false);
	pass("both views stay unobserved while completed export is held");
	refusal("capture");
	pass("repeat capture cannot overwrite retained control");
	writeFileSync(held, JSON.stringify({ ...turn, event: `limen-finish-${"0".repeat(64)}` }));
	refusal("release");
	assert.equal(existsSync(source), false);
	pass("wrong event is not released");
	writeFileSync(held, JSON.stringify({ ...turn, state: "running" }));
	refusal("release");
	assert.equal(existsSync(source), false);
	pass("incomplete turn is not released");
	writeFileSync(join(proof, "fake-turn.json"), JSON.stringify(turn));
	rmSync(held);
	symlinkSync(join(proof, "fake-turn.json"), held);
	refusal("release");
	assert.equal(existsSync(source), false);
	rmSync(held);
	pass("symlink export is not released");
	writeFileSync(held, JSON.stringify(turn));
	put(job, "finish-webhook-attempt", "changed-attempt");
	refusal("release");
	assert.equal(existsSync(source), false);
	put(job, "finish-webhook-attempt", now);
	pass("changed automatic claim blocks release");
	success("release");
	for (const view of ["compact", "human"])
		assert.match(
			readFileSync(join(proof, `observed-${view}.txt`), "utf8"),
			/bot-turn observed \(operator-trusted export\).*receiver johnny/,
		);
	for (const name of ["finish-webhook-attempt", "finish-webhook", "finish-webhook-targets"])
		assert.equal(readFileSync(join(proof, name), "utf8"), readFileSync(join(job, name), "utf8"));
	assert.equal(existsSync(held), false);
	assert.equal(readFileSync(source, "utf8"), JSON.stringify(turn));
	assert.equal(existsSync(join(project, ".limen/finish-webhook-johnny.env")), false);
	pass("atomic same-byte release changes both views without config access or changed receipts");
	refusal("release");
	pass("repeat release refuses without resending");
	console.log(
		`${checks} synthetic checks passed; zero live sends; no receiver evidence created in real proof directory`,
	);
} finally {
	rmSync(temp, { recursive: true, force: true });
}
