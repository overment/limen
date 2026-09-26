import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { processInfo } from "../src/contain.ts";
import { hostedEngineOwned } from "../src/herdr.ts";
import { observeToolStall, signalOwnedProcess, type ToolStallWatch } from "../src/stalled-tool.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
// Polling observes actual child process exit; fake time cannot drive the kernel's process table.
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until<T>(probe: () => Promise<T | undefined>, milliseconds = 12_000): Promise<T> {
	const deadline = Date.now() + milliseconds;
	while (Date.now() < deadline) {
		const value = await probe();
		if (value !== undefined) return value;
		await wait(100);
	}
	throw new Error("timed out waiting for job observation");
}
async function content(path: string): Promise<string | undefined> {
	return readFile(path, "utf8").catch(() => undefined);
}

// These processes are real: the engine owns a sleeping child and its own process group.
for (const engine of ["pi", "omp"] as const) {
	test(`hosted ${engine} terminates an owned idle tool child and retains failed state`, async (context) => {
		const dir = await mkdtemp(join(tmpdir(), `limen-hosted-stall-${engine}-`));
		const job = join(dir, "job");
		await mkdir(join(job, "session"), { recursive: true });
		await writeFile(join(job, "state"), "running\n");
		await writeFile(join(job, "engine"), `${engine}\n`);
		await writeFile(join(job, "activity"), "tool\n");
		await writeFile(join(job, "tool-calls"), "1\n");
		await writeFile(join(job, "tool-detail"), "cargo test\n");
		const fakeEngine = join(dir, "engine.cjs");
		await writeFile(
			fakeEngine,
			`const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const child = spawn('sleep', ['60']);
writeFileSync(${JSON.stringify(join(dir, "child"))}, String(child.pid));
setInterval(() => {}, 1000);`,
		);
		const worker = spawn(process.execPath, [fakeEngine], { detached: true, stdio: "ignore" });
		assert.ok(worker.pid);
		worker.unref();
		let childPid = 0;
		let childBorn = "";
		const birth = await until(async () => {
			const info = await processInfo(worker.pid!);
			return info.kind === "present" ? info.process.born : undefined;
		});
		context.after(async () => {
			const current = await processInfo(worker.pid!);
			if (current.kind === "present" && current.process.born === birth && current.process.pgid === worker.pid) {
				try { process.kill(-worker.pid!, "SIGKILL"); } catch {}
			}
			if (childPid && childBorn) await signalOwnedProcess(childPid, childBorn, "SIGKILL");
			await rm(dir, { recursive: true, force: true });
		});
		childPid = await until(async () => Number(await content(join(dir, "child"))) || undefined);
		const childIdentity = await processInfo(childPid);
		if (childIdentity.kind === "present") childBorn = childIdentity.process.born;
		await writeFile(join(job, "engine-pid"), `${worker.pid}\n`);
		const herdr = join(dir, "herdr");
		const herdrSource = (session: string) => `#!/usr/bin/env node
const args = process.argv.slice(2);
const info = args[0] === 'agent'
  ? { agent: { agent_status: 'working' } }
  : { process_info: { foreground_processes: [{
    pid: ${worker.pid}, name: 'node', argv: ['node', '--session-dir', ${JSON.stringify(session)}]
  }] } };
console.log(JSON.stringify({ result: info }));
`;
		await writeFile(herdr, herdrSource("/foreign/job/session"));
		await chmod(herdr, 0o755);
		const supervisor = spawn(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(join(root, "src/supervisor.ts"))}).then(m => m.runHostedSupervisor())`], {
			cwd: root,
			env: { ...process.env, LIMEN_JOB_DIR: job, LIMEN_HOSTED_TARGET: "test:p1", LIMEN_HERDR: herdr, LIMEN_TOOL_STALL_MS: "1200", LIMEN_HOSTED_START: "" },
			stdio: "ignore",
		});
		const supervisorBirth = await until(async () => {
			if (!supervisor.pid) return;
			const info = await processInfo(supervisor.pid);
			return info.kind === "present" ? info.process.born : undefined;
		});
		context.after(async () => {
			if (supervisor.pid) await signalOwnedProcess(supervisor.pid, supervisorBirth, "SIGKILL");
		});
		await until(async () => (await content(join(job, "advisory")))?.includes("ownership requires attention") ? true : undefined);
		assert.equal(await content(join(job, "state")), "running\n", "unknown pane ownership cannot fail the job");
		assert.equal((await processInfo(childPid)).kind, "present", "unknown pane ownership cannot kill the child");
		await writeFile(herdr, herdrSource(join(job, "session")));
		await until(async () => (await content(join(job, "state"))) === "failed\n" ? true : undefined);
		assert.match((await content(join(job, "log"))) ?? "", /stalled tool cargo test: CPU-idle child/);
		assert.match((await content(join(job, "stop-reason"))) ?? "", /error: stalled tool cargo test/);
		await until(async () => (await processInfo(childPid)).kind === "absent" ? true : undefined);
		assert.equal((await content(join(job, "state"))), "failed\n");
		assert.equal(await content(join(job, "advisory")), undefined, "resolved ownership warning must not remain after failure");
	});

	test(`detached ${engine} fails an idle tool before its outer timeout`, async (context) => {
		const dir = await mkdtemp(join(tmpdir(), `limen-detached-stall-${engine}-`));
		const job = join(dir, "job");
		await mkdir(job);
		await writeFile(join(job, "engine"), `${engine}\n`);
		const fakeEngine = join(dir, "engine.cjs");
		await writeFile(fakeEngine, `#!/usr/bin/env node
const { spawn } = require('node:child_process'); const { writeFileSync } = require('node:fs');
const child = spawn('sleep', ['60']); writeFileSync(${JSON.stringify(join(dir, "child"))}, String(child.pid));
process.stdout.write(JSON.stringify({ type: 'tool_execution_start', toolName: 'bash', args: { command: 'cargo test' } }) + '\\n');
setInterval(() => {}, 1000);
`);
		await chmod(fakeEngine, 0o755);
		const task = join(dir, "task");
		await writeFile(task, "test tool\n");
		const runner = spawn(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(join(root, "src/wrapper.ts"))}).then(m => m.runInternalJob())`], {
			cwd: root,
			detached: true,
			env: {
				...process.env,
				LIMEN_JOB_DIR: job,
				LIMEN_JOB_ID: "synthetic",
				LIMEN_WORKTREE: dir,
				LIMEN_TASK_FILE: task,
				LIMEN_PREAMBLE: task,
				LIMEN_TIMEOUT_MS: "90000",
				LIMEN_TOOL_STALL_MS: "1200",
				LIMEN_PI: fakeEngine,
				LIMEN_OMP: fakeEngine,
			},
			stdio: "ignore",
		});
		assert.ok(runner.pid);
		runner.unref();
		let childPid = 0;
		let childBorn = "";
		const birth = await until(async () => {
			const info = await processInfo(runner.pid!);
			return info.kind === "present" ? info.process.born : undefined;
		});
		context.after(async () => {
			const current = await processInfo(runner.pid!);
			if (current.kind === "present" && current.process.born === birth && current.process.pgid === runner.pid) {
				try { process.kill(-runner.pid!, "SIGKILL"); } catch {}
			}
			if (childPid && childBorn) await signalOwnedProcess(childPid, childBorn, "SIGKILL");
			await rm(dir, { recursive: true, force: true });
		});
		childPid = await until(async () => Number(await content(join(dir, "child"))) || undefined);
		const childIdentity = await processInfo(childPid);
		if (childIdentity.kind === "present") childBorn = childIdentity.process.born;
		await until(async () => (await content(join(job, "state"))) === "failed\n" ? true : undefined);
		assert.match((await content(join(job, "log"))) ?? "", /stalled tool bash cargo test: CPU-idle child/);
		await until(async () => (await processInfo(childPid)).kind === "absent" ? true : undefined);
		assert.equal((await content(join(job, "state"))), "failed\n");
	});
}

test("CPU progress and silent model thought cannot confirm a stalled tool", async (context) => {
	const dir = await mkdtemp(join(tmpdir(), "limen-stall-progress-"));
	const child = spawn(
		process.execPath,
		[
			"-e",
			`const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const worker = spawn('sleep', ['60']);
writeFileSync(${JSON.stringify(join(dir, "child"))}, String(worker.pid));
while (true) { Math.sqrt(Math.random()); }`,
		],
		{ detached: true, stdio: "ignore" },
	);
	assert.ok(child.pid);
	child.unref();
	let childPid = 0;
	let childBorn = "";
	const birth = await until(async () => {
		const info = await processInfo(child.pid!);
		return info.kind === "present" ? info.process.born : undefined;
	});
	context.after(async () => {
		const current = await processInfo(child.pid!);
		if (current.kind === "present" && current.process.born === birth && current.process.pgid === child.pid) {
			try { process.kill(-child.pid!, "SIGKILL"); } catch {}
		}
		if (childPid && childBorn) await signalOwnedProcess(childPid, childBorn, "SIGKILL");
		await rm(dir, { recursive: true, force: true });
	});
	childPid = await until(async () => Number(await content(join(dir, "child"))) || undefined);
	const childIdentity = await processInfo(childPid);
	if (childIdentity.kind === "present") childBorn = childIdentity.process.born;
	const watch: ToolStallWatch = { tool: "", born: "", started: 0 };
	assert.equal(await observeToolStall(watch, child.pid, "", 0, 100), undefined);
	assert.equal(await observeToolStall(watch, child.pid, "1:bash cargo test", 0, 100), undefined);
	const cpuBefore = execFileSync("ps", ["-p", String(child.pid), "-o", "time="], { encoding: "utf8" }).trim();
	await until(async () => execFileSync("ps", ["-p", String(child.pid), "-o", "time="], { encoding: "utf8" }).trim() !== cpuBefore ? true : undefined);
	assert.equal(await observeToolStall(watch, child.pid, "1:bash cargo test", 10_000, 100), undefined);
});

test("an observed child that exits without ending its tool becomes a confirmed stall", async (context) => {
	const dir = await mkdtemp(join(tmpdir(), "limen-stall-dead-child-"));
	const engine = spawn(
		process.execPath,
		["-e", `const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const child = spawn('sleep', ['60']);
writeFileSync(${JSON.stringify(join(dir, "child"))}, String(child.pid));
setInterval(() => {}, 1000);`],
		{ detached: true, stdio: "ignore" },
	);
	assert.ok(engine.pid);
	engine.unref();
	const identity = await until(async () => {
		const info = await processInfo(engine.pid!);
		return info.kind === "present" ? info.process : undefined;
	});
	let childPid = 0;
	context.after(async () => {
		const current = await processInfo(engine.pid!);
		if (current.kind === "present" && current.process.born === identity.born && current.process.pgid === engine.pid)
			try { process.kill(-engine.pid!, "SIGKILL"); } catch {}
		await rm(dir, { recursive: true, force: true });
	});
	childPid = await until(async () => Number(await content(join(dir, "child"))) || undefined);
	const watch: ToolStallWatch = { tool: "", born: "", started: 0 };
	assert.equal(await observeToolStall(watch, engine.pid, "1:bash cargo test", 0, 1_000), undefined);
	assert.equal(watch.hadChild, true);
	process.kill(childPid, "SIGTERM");
	await until(async () => (await processInfo(childPid)).kind === "absent" ? true : undefined);
	assert.equal(await observeToolStall(watch, engine.pid, "1:bash cargo test", 1_000, 1_000), undefined);
	assert.equal(await observeToolStall(watch, engine.pid, "1:bash cargo test", 3_000, 1_000), "stalled");
});

test("hosted ownership refuses another pane engine and another session", async (context) => {
	const dir = await mkdtemp(join(tmpdir(), "limen-stall-ownership-"));
	context.after(() => rm(dir, { recursive: true, force: true }));
	const bin = join(dir, "herdr");
	await writeFile(bin, `#!/usr/bin/env node
console.log(JSON.stringify({ result: { process_info: { foreground_processes: [{ pid: 345, name: 'omp', argv: ['omp', '--session-dir', '/other/job/session'] }] } } }));`);
	await chmod(bin, 0o755);
	const old = process.env.LIMEN_HERDR;
	process.env.LIMEN_HERDR = bin;
	try {
		assert.equal(hostedEngineOwned("test:p1", 345, "omp", dir), false);
		assert.equal(hostedEngineOwned("test:p1", 346, "omp", "/other/job"), false);
	} finally {
		if (old === undefined) delete process.env.LIMEN_HERDR;
		else process.env.LIMEN_HERDR = old;
	}
});
