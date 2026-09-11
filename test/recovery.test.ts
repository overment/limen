import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { processAlive } from "../src/contain.ts";
import { hostedAgentStatus } from "../src/herdr.ts";
import { ownerAlive, reapDeadJobs, STARTUP_GRACE_MS } from "../src/reap.ts";
import { launchHostedSupervisor, textFile } from "../src/wrapper.ts";
import { scratchRepo, waitForState } from "./scratch.ts";

const recoveryModule = new URL("../src/recovery.ts", import.meta.url).href;
const reapModule = new URL("../src/reap.ts", import.meta.url).href;
const DEAD_PID = 999_999_999;

async function fixture(context: TestContext, id: string) {
	const scratch = await scratchRepo();
	const jobs = join(scratch.root, ".limen/jobs"),
		job = join(jobs, id);
	const control = join(scratch.fakeBin, "control.json"),
		calls = join(scratch.fakeBin, "calls.jsonl");
	await mkdir(join(job, "herdr"), { recursive: true });
	await mkdir(join(job, "notify/subscribers"), { recursive: true });
	await mkdir(join(job, "session"));
	const agent = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
	assert.ok(agent.pid);
	const owned = new Set([agent.pid]);
	const previous = { ...process.env };
	const herdr = join(scratch.fakeBin, "herdr");
	await writeFile(
		herdr,
		`#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2), c = JSON.parse(fs.readFileSync(${JSON.stringify(control)}, "utf8"));
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + "\\n");
if (process.env.LIMEN_HOSTED_RECOVER === "1") fs.writeFileSync(${JSON.stringify(join(scratch.fakeBin, "supervisor-environment.json"))}, JSON.stringify(Object.fromEntries(["LIMEN_ROLE","LIMEN_AGENT_NAME","LIMEN_CONTEXT_ROOT","LIMEN_JOB_ID","LIMEN_LABEL","LIMEN_HOSTED_START"].map(k=>[k,process.env[k]]))));
const ok = result => { console.log(JSON.stringify({result})); process.exit(0); };
const fail = code => { console.log(JSON.stringify({error:{code,message:code}})); process.exit(1); };
let alive = false; try { process.kill(c.pid, 0); alive = true; } catch {}
if (c.outage) fail("temporarily_unavailable");
if (args[0] === "agent" && args[1] === "get") {
 if (!alive || args[2] !== c.target) fail("agent_not_found");
 ok({agent: {agent_status: c.status, pane_id: c.target}});
}
if (args[0] === "agent" && args[1] === "list") {
 if (c.listOutage) fail("temporarily_unavailable");
 ok({agents: alive ? [{pane_id:c.target, name:c.name}] : []});
}
if (args[0] === "pane" && args[1] === "process-info") ok({process_info:{foreground_processes:[]}});
if (args[0] === "agent" && args[1] === "start") fail("unexpected_agent_start");
ok({});
`,
	);
	await chmod(herdr, 0o755);
	const truth = { pid: agent.pid, target: "w1:p1", name: "limen-f049-aaaaaaaa", status: "working", outage: false, listOutage: false };
	const set = async (changes: Partial<typeof truth>) => {
		Object.assign(truth, changes);
		await writeFile(control, JSON.stringify(truth));
	};
	await set({});
	for (const [name, value] of Object.entries({
		state: "running",
		pid: String(DEAD_PID),
		"started-at": new Date().toISOString(),
		hosted: "hosted",
		label: id,
		role: "reviewer",
		"agent-name": truth.name,
		"herdr/agent": truth.target,
		"herdr/pane": truth.target,
		"herdr/tab": "fixture-tab",
		"herdr/workspace": "fixture-space",
		"herdr/mode": "hosted",
		"origin-session": "original-coordinator",
		"notify/subscribers/original-coordinator": "subscribed",
		activity: "think",
		"tool-calls": "2",
		log: "",
	}))
		await writeFile(join(job, name), `${value}\n`);
	Object.assign(process.env, { LIMEN_HERDR: herdr, LIMEN_HOSTED_IDLE_MS: "1" });
	const stop = async (pid: number) => {
		assert.ok(owned.has(pid), "only fixture-owned PIDs may be killed");
		try {
			process.kill(pid, "SIGKILL");
		} catch {}
		await until(() => !processAlive(pid));
	};
	const owner = async () => {
		const pid = Number(await textFile(join(job, "pid")));
		assert.ok(pid > 0 && pid !== DEAD_PID);
		owned.add(pid);
		assert.equal(await ownerAlive(job), true);
		return pid;
	};
	context.after(async () => {
		// Include only the PID from this private fixture record, never a cabinet sweep.
		const pid = Number(await textFile(join(job, "pid")));
		if (pid > 0 && pid !== DEAD_PID) owned.add(pid);
		for (const child of owned) {
			try {
				process.kill(child, "SIGKILL");
			} catch {}
		}
		if (process.env.LIMEN_RECOVERY_EVIDENCE) {
			const evidence = join(process.env.LIMEN_RECOVERY_EVIDENCE, id);
			await mkdir(evidence, { recursive: true });
			for (const name of ["state", "log", "result", "advisory", "origin-session", "herdr/agent"]) {
				await writeFile(join(evidence, name.replaceAll("/", "-")), await textFile(join(job, name)));
			}
			await writeFile(join(evidence, "herdr-calls.jsonl"), await textFile(calls));
		}
		for (const name of Object.keys(process.env)) if (!(name in previous)) delete process.env[name];
		Object.assign(process.env, previous);
		await scratch.cleanup();
	});
	const sweep = async () => {
		const code = `import {reapDeadJobs} from ${JSON.stringify(reapModule)}; const seen = new Map(), t = Date.now(); await reapDeadJobs(${JSON.stringify(jobs)}, seen, t); await reapDeadJobs(${JSON.stringify(jobs)}, seen, t+10001);`;
		const child = spawn(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
		assert.ok(child.pid);
		owned.add(child.pid);
		let errors = "";
		child.stderr.on("data", (data) => {
			errors += data;
		});
		await new Promise<void>((resolve, reject) => {
			child.on("error", reject);
			child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(errors || `sweep exit ${code}`))));
		});
	};
	return { ...scratch, id, jobs, job, agent, owned, owner, stop, set, truth, sweep, calls };
}

async function until(check: () => boolean | Promise<boolean>, timeout = 10_000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	assert.fail("fixture condition timed out");
}

const starts = async (job: string) => (await textFile(join(job, "log"))).match(/hosted supervisor started/g)?.length ?? 0;

test("competing real sweeps replace a killed young supervisor exactly once, then can replace it again and finish", async (context) => {
	const f = await fixture(context, "competing");
	const original = await launchHostedSupervisor({ LIMEN_INTERNAL_RUN: "", LIMEN_JOB_DIR: f.job, LIMEN_HOSTED_START: "", LIMEN_HOSTED_TARGET: f.truth.target });
	f.owned.add(original);
	await until(async () => (await starts(f.job)) === 1);
	await f.stop(original);
	await Promise.all([f.sweep(), f.sweep(), f.sweep()]);
	const adopted = await f.owner();
	assert.notEqual(adopted, original);
	await until(async () => (await starts(f.job)) === 2);
	assert.deepEqual(JSON.parse(await textFile(join(f.fakeBin, "supervisor-environment.json"))), {
		LIMEN_ROLE: "reviewer",
		LIMEN_AGENT_NAME: f.truth.name,
		LIMEN_CONTEXT_ROOT: f.root,
		LIMEN_JOB_ID: f.id,
		LIMEN_LABEL: f.id,
		LIMEN_HOSTED_START: "",
	});
	assert.equal(await textFile(join(f.job, "state")), "running");
	assert.equal(await textFile(join(f.job, "origin-session")), "original-coordinator");
	assert.deepEqual(await readdir(join(f.job, "notify/subscribers")), ["original-coordinator"]);
	await until(async () => !(await readdir(f.job)).includes("recovery"));
	await f.stop(adopted);
	await Promise.all([f.sweep(), f.sweep()]);
	const readopted = await f.owner();
	assert.notEqual(readopted, adopted);
	await until(async () => (await starts(f.job)) === 3);
	await writeFile(join(f.job, "activity"), "wait\n");
	await f.set({ status: "idle" });
	await until(async () => (await textFile(join(f.job, "advisory"))).includes("idle"));
	await writeFile(
		join(f.job, "session", "final.jsonl"),
		`${JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "recovered handoff" }] } })}\n`,
	);
	await writeFile(join(f.job, "session-ended"), "yes\n");
	await waitForState(f.root, f.id, "done");
	await until(async () => (await textFile(f.calls)).includes('"tab","close"'));
	assert.equal(await textFile(join(f.job, "result")), "recovered handoff");
	assert.equal(await starts(f.job), 3);
	assert.doesNotMatch(await textFile(f.calls), /"agent","start"/);
	context.diagnostic(JSON.stringify({ original, adopted, readopted, supervisorStarts: 3, state: "done", advisory: true, agentStarts: 0, coordinatorUnchanged: true }));
});

test("a killed recovery claimant is reclaimed by competing sweeps", async (context) => {
	const f = await fixture(context, "dead-claimant");
	const receipt = join(f.fakeBin, "claimed");
	const claimant = spawn(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`import {claimRecovery} from ${JSON.stringify(recoveryModule)}; import {writeFile} from 'node:fs/promises'; if (!await claimRecovery(${JSON.stringify(f.job)})) process.exit(2); await writeFile(${JSON.stringify(receipt)}, 'claimed'); setInterval(()=>{},1000);`,
		],
		{ stdio: "ignore" },
	);
	assert.ok(claimant.pid);
	f.owned.add(claimant.pid);
	await until(async () => (await textFile(receipt)) === "claimed");
	await f.stop(claimant.pid);
	await Promise.all([f.sweep(), f.sweep(), f.sweep()]);
	const adopted = await f.owner();
	await until(async () => (await starts(f.job)) === 1);
	await until(async () => !(await readdir(f.job)).includes("recovery"));
	assert.equal(await starts(f.job), 1);
	context.diagnostic(JSON.stringify({ deadClaimant: claimant.pid, adopted, supervisorStarts: 1, claimReleased: true }));
});

test("missing and malformed PID/timestamp shapes expire; a real startup grace alone waits", async (context) => {
	const f = await fixture(context, "shapes");
	const now = Date.now(),
		seen = new Map<string, number>();
	await rm(join(f.job, "pid"));
	await reapDeadJobs(f.jobs, seen, now);
	assert.equal(seen.size, 0);
	await reapDeadJobs(f.jobs, seen, now + STARTUP_GRACE_MS + 1);
	assert.equal(seen.size, 1);
	await reapDeadJobs(f.jobs, seen, now + STARTUP_GRACE_MS + 10_001);
	await f.owner();
	assert.equal(await textFile(join(f.job, "state")), "running");
	for (const [id, pid, started] of [
		["missing", "", ""],
		["malformed", "not-a-pid", "not-a-date"],
		["pre-f048", "", "2026-08-27T10:00:00Z"],
	] as const) {
		const job = join(f.jobs, id);
		await mkdir(job);
		await writeFile(join(job, "state"), "running\n");
		if (pid) await writeFile(join(job, "pid"), pid);
		if (started) await writeFile(join(job, "started-at"), started);
		await reapDeadJobs(f.jobs, seen, now);
		assert.equal(await textFile(join(job, "state")), "running");
		await reapDeadJobs(f.jobs, seen, now + 10_001);
		assert.equal(await textFile(join(job, "state")), "failed");
		assert.match(await textFile(join(job, "log")), /process group gone/);
	}
	context.diagnostic("pidless young hosted agent adopted after grace; absent/malformed/2026-08-27 detached records failed after confirmation");
});

test("uncertain Herdr never adopts or fails, including cached life and a failed relocation probe", async (context) => {
	const f = await fixture(context, "uncertain");
	const now = Date.now(),
		seen = new Map<string, number>();
	assert.equal(hostedAgentStatus(f.truth.target), "working");
	await f.set({ outage: true });
	await reapDeadJobs(f.jobs, seen, now);
	await reapDeadJobs(f.jobs, seen, now + 10_001);
	assert.equal(await starts(f.job), 0);
	assert.equal(await textFile(join(f.job, "pid")), String(DEAD_PID));
	assert.equal(await textFile(join(f.job, "state")), "running");
	assert.equal(seen.get(f.id), now);
	await f.set({ outage: false, status: "unknown" });
	await reapDeadJobs(f.jobs, seen, now + 20_001);
	assert.equal(await starts(f.job), 0);
	await f.set({ status: "working", target: "w2:p2", listOutage: true });
	await reapDeadJobs(f.jobs, seen, now + 30_001);
	assert.equal(await textFile(join(f.job, "state")), "running");
	assert.equal(await starts(f.job), 0);
	// Pre-F048 orphan has no persisted role, name, or agent target; derive name from ID and use pane.
	await f.set({ listOutage: false, name: "limen-uncertain" });
	await Promise.all(["role", "agent-name", "herdr/agent", "started-at"].map((name) => rm(join(f.job, name))));
	await writeFile(join(f.job, "pid"), "broken\n");
	await reapDeadJobs(f.jobs, seen, now + 40_001);
	await f.owner();
	assert.equal(await textFile(join(f.job, "herdr/agent")), "w2:p2");
	assert.equal(await textFile(join(f.job, "herdr/pane")), "w2:p2");
	await until(async () => (await starts(f.job)) === 1);
	const environment = JSON.parse(await textFile(join(f.fakeBin, "supervisor-environment.json")));
	assert.equal(environment.LIMEN_ROLE, "worker");
	assert.equal(environment.LIMEN_AGENT_NAME, "limen-uncertain");
	assert.equal(environment.LIMEN_CONTEXT_ROOT, f.root);
	assert.equal(seen.size, 0);
	assert.doesNotMatch(await textFile(f.calls), /"agent","start"/);
	context.diagnostic("cached-working transport failure, unknown status, and list outage all waited; concrete moved pane adopted via pre-F048 fallbacks");
});

test("uncertain then concretely missing agent fails with handoff and wake eligibility; terminal records cannot revive", async (context) => {
	const f = await fixture(context, "missing-agent");
	const now = Date.now(),
		seen = new Map<string, number>();
	await rm(join(f.job, "pid"));
	await writeFile(join(f.job, "started-at"), new Date(now - STARTUP_GRACE_MS - 1).toISOString());
	await f.stop(f.agent.pid as number);
	await f.set({ outage: true });
	await reapDeadJobs(f.jobs, seen, now);
	await reapDeadJobs(f.jobs, seen, now + 10_001);
	assert.equal(await textFile(join(f.job, "state")), "running");
	await f.set({ outage: false });
	await writeFile(
		join(f.job, "session", "final.jsonl"),
		`${JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "last handoff" }] } })}\n`,
	);
	await reapDeadJobs(f.jobs, seen, now + 20_001);
	assert.equal(await textFile(join(f.job, "state")), "failed");
	assert.match(await textFile(join(f.job, "log")), /failed: hosted supervisor lost/);
	assert.equal(await textFile(join(f.job, "result")), "last handoff");
	assert.ok(await textFile(join(f.job, "finished-at")));
	assert.deepEqual(await readdir(join(f.job, "notify/subscribers")), ["original-coordinator"]);
	assert.equal(await textFile(join(f.job, "notify/delivered/original-coordinator")), "");
	const pid = await launchHostedSupervisor({ LIMEN_INTERNAL_RUN: "", LIMEN_HOSTED_START: "1", LIMEN_HOSTED_RECOVER: "1", LIMEN_JOB_DIR: f.job });
	f.owned.add(pid);
	await until(() => !processAlive(pid));
	assert.equal(await textFile(join(f.job, "state")), "failed");
	assert.equal(await textFile(join(f.job, "pid")), "");
	assert.equal(await starts(f.job), 0);
	assert.doesNotMatch(await textFile(f.calls), /"agent","start"/);
	context.diagnostic(
		"uncertain stayed pending; missing captured handoff, failed with hosted supervisor lost, retained subscriber; recovery candidate left terminal record unchanged",
	);
});
