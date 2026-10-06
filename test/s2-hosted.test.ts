// S2 · hosted spawn. A fake Herdr (written below to the plant) records every call, runs the pane command as a real
// child process so the fake engine and its hooks really load, answers `agent get` from a state file the test edits,
// and names the pane's foreground process after the engine it launched, as real Herdr does.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { jobDir, jobFile, LIMEN, limen, type Plant, plant, release, spawnJob, until, waitJob } from "./plant.ts";

const herdrSource = `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path"), { spawn } = require("node:child_process");
const args = process.argv.slice(2), file = path.join(__dirname, "state.json");
fs.appendFileSync(path.join(__dirname, "calls.jsonl"), JSON.stringify(args) + "\\n");
if (args[0] === "--version") { console.log("0.0.0-test"); process.exit(0); }
const state = JSON.parse(fs.readFileSync(file, "utf8"));
const save = () => { fs.writeFileSync(file + process.pid, JSON.stringify(state)); fs.renameSync(file + process.pid, file); };
const ok = (result) => { console.log(JSON.stringify({ result })); process.exit(0); };
const fail = (code) => { console.log(JSON.stringify({ error: { code, message: code } })); process.exit(1); };
const flag = (name) => args[args.indexOf(name) + 1];
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const engine = (pane) => (state.procs[pane] && alive(state.procs[pane].pid) ? state.procs[pane] : undefined);
const [noun, verb, target] = args;
switch (noun + " " + verb) {
	case "workspace list": ok({ workspaces: state.workspaces });
	case "workspace create":
		state.workspaces.push({ workspace_id: "w" + (state.workspaces.length + 1), label: flag("--label") });
		save();
		ok({ workspace: state.workspaces.at(-1) });
	case "tab create": {
		const n = Object.keys(state.tabs).length + 1, env = {};
		args.forEach((value, index) => { if (value === "--env") { const [key, ...rest] = args[index + 1].split("="); env[key] = rest.join("="); } });
		state.tabs["t" + n] = { pane: "p" + n, cwd: flag("--cwd"), env };
		save();
		ok({ tab: { tab_id: "t" + n }, root_pane: { pane_id: "p" + n } });
	}
	case "tab get": ok({ tab: { tab_id: target, focused: true } });
	case "tab close": {
		const running = engine(state.tabs[target]?.pane);
		if (running) process.kill(running.pid, "SIGTERM");
		ok({});
	}
	case "pane process-info": {
		const running = engine(flag("--pane"));
		ok({ process_info: { foreground_processes: [running ? { name: running.kind, pid: running.pid } : { name: "zsh" }] } });
	}
	case "agent start": {
		const pane = flag("--pane"), kind = flag("--kind"), tab = Object.values(state.tabs).find((row) => row.pane === pane);
		const base = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(HERDR_|LIMEN_(?!HOME|HERDR|HUNK))/.test(key)));
		const env = { ...base, ...tab.env, HERDR_PANE_ID: pane };
		const binary = env.PATH.split(":").map((dir) => path.join(dir, kind)).find((candidate) => fs.existsSync(candidate));
		const child = spawn(binary, args.slice(args.indexOf("--") + 1), { cwd: tab.cwd, env, detached: true, stdio: "ignore" });
		child.unref();
		state.procs[pane] = { pid: child.pid, kind };
		state.agents[pane] = { name: target, status: "done" };
		save();
		ok({ agent: { pane_id: pane, name: target } });
	}
	case "agent get": {
		const row = state.agents[target];
		if (!row || !engine(target)) fail("agent_not_found");
		ok({ agent: { pane_id: target, agent_status: row.status } });
	}
	case "agent list": ok({ agents: Object.entries(state.agents).filter(([pane]) => engine(pane)).map(([pane_id, row]) => ({ pane_id, name: row.name })) });
	case "agent send-keys": {
		const running = engine(target);
		if (running) process.kill(running.pid, "SIGTERM");
		ok({});
	}
	default: ok({});
}
`;

let p: Plant;
let herdr: string;
let env: Record<string, string>;
const COORDINATOR = "coord:p0";
const calls = (): string[][] =>
	readFileSync(join(herdr, "calls.jsonl"), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as string[]);
const named = (noun: string, verb: string) => calls().filter((args) => args[0] === noun && args[1] === verb);
const engineArgv = (pane: string): string[] => {
	const start = named("agent", "start").find((args) => args[args.indexOf("--pane") + 1] === pane) ?? [];
	return start.slice(start.indexOf("--") + 1);
};
const pane = (id: string) => jobFile(p, id, "herdr/pane");
const starts = (id: string) => jobFile(p, id, "log").match(/hosted supervisor started/g)?.length ?? 0;
const state = () =>
	JSON.parse(readFileSync(join(herdr, "state.json"), "utf8")) as { agents: Record<string, { status: string }> };
const saveState = async (next: unknown) => {
	await writeFile(join(herdr, "state.tmp"), JSON.stringify(next));
	await rename(join(herdr, "state.tmp"), join(herdr, "state.json"));
};
const prompts = (id: string) =>
	named("agent", "prompt").filter((args) => args[2] === COORDINATOR && args[3]?.includes(id)).length;
const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};
/** Runs the CLI without blocking the event loop, so two sweeps can race. */
const limenAsync = (args: readonly string[]) =>
	new Promise<number>((resolve) =>
		spawn(process.execPath, [LIMEN, ...args], { cwd: p.root, env: { ...p.env, ...env }, stdio: "ignore" }).on(
			"exit",
			(code) => resolve(code ?? 1),
		),
	);

before(async () => {
	p = await plant();
	herdr = join(p.parent, "herdr");
	await mkdir(herdr);
	await writeFile(join(herdr, "state.json"), JSON.stringify({ workspaces: [], tabs: {}, procs: {}, agents: {} }));
	await writeFile(join(herdr, "herdr"), herdrSource);
	await chmod(join(herdr, "herdr"), 0o755);
	// The caller is a coordinator pane with no Pi session: its wake travels as one Herdr prompt. Sweeps confirm at once.
	env = {
		LIMEN_HERDR: join(herdr, "herdr"),
		HERDR_ENV: "1",
		HERDR_PANE_ID: COORDINATOR,
		HERDR_TAB_ID: "coord:t0",
		LIMEN_REAP_CONFIRM_MS: "1",
	};
});
after(() => p.cleanup());

let first = "";
test("a hosted job gets one tab, its task as @task, and finishes done with its handoff when the session ends", async () => {
	first = spawnJob(p, "say hi\nfinish F001 handoff from the hosted pane", ["--label", "F001 hosted"], { env });
	assert.equal(waitJob(p, first, { env }), "done");
	assert.equal(jobFile(p, first, "result"), "F001 handoff from the hosted pane");
	assert.match(jobFile(p, first, "log"), /done: hosted session ended/);
	const argv = engineArgv(pane(first));
	const task = argv.at(-1) ?? "";
	assert.ok(task.startsWith("@"), `task must reach the engine as @file: ${JSON.stringify(argv)}`);
	assert.equal(readFileSync(task.slice(1), "utf8").trim(), "say hi\nfinish F001 handoff from the hosted pane");
	assert.ok(
		argv.every((arg) => !arg.includes("F001 handoff") && !/[\r\n]/.test(arg)),
		"task text must not travel as shell argv",
	);
	assert.ok(
		!argv.includes("--mode") && !argv.includes("json"),
		`hosted pane command has no json flag: ${JSON.stringify(argv)}`,
	);
	assert.equal(
		readFileSync(join(jobDir(p, first), "fake-task.txt"), "utf8").trim(),
		"say hi\nfinish F001 handoff from the hosted pane",
	);
	assert.equal(named("workspace", "create").length, 1);
	assert.match(named("workspace", "create")[0]?.join(" ") ?? "", /--label repo workers/);
	assert.equal(named("tab", "create").length, 1, "one tab for one hosted job");
	assert.ok(!named("agent", "start")[0]?.includes("--mode"));
	// The prompt receipt is written after Herdr answered; only then is the wake count final.
	await until(jobDir(p, first), () => jobFile(p, first, "notify/herdr-prompt").includes("turn observed"));
	assert.equal(prompts(first), 1, "the coordinator pane gets one wake prompt");
});

let second = "";
test("a live OMP job stays running while Herdr reports done, then after Herdr loses its agent row (88fd5ac)", async () => {
	second = spawnJob(p, "block\nfinish second handoff", ["--engine", "omp", "--label", "F001 hosted omp"], { env });
	const dir = jobDir(p, second);
	await until(dir, () => existsSync(join(dir, "fake-blocked-1")));
	const target = pane(second);
	const start = named("agent", "start").find((args) => args.includes(target)) ?? [];
	assert.equal(start[start.indexOf("--kind") + 1], "omp");
	// Herdr says the agent is done (unseen idle); only the session or the process ending finishes a hosted job.
	await until(herdr, () => named("agent", "get").filter((args) => args[2] === target).length >= 2);
	assert.equal(jobFile(p, second, "state"), "running", "Herdr done is not job completion");
	const seen = named("pane", "process-info").length;
	const next = state();
	delete next.agents[target];
	await saveState(next);
	// Each missing sample probes the pane once; four probes is past the three-sample missing window.
	const probes = () =>
		named("pane", "process-info")
			.slice(seen)
			.filter((args) => args.includes(target)).length;
	await until(herdr, () => probes() >= 4 || jobFile(p, second, "state") !== "running");
	assert.equal(
		jobFile(p, second, "state"),
		"running",
		`omp still runs on ${target}; a lost agent row must not end the job`,
	);
});

test("two competing sweeps start exactly one replacement for a killed hosted supervisor (5754dad)", async () => {
	const dir = jobDir(p, second);
	assert.equal(starts(second), 1);
	const supervisor = Number(jobFile(p, second, "pid"));
	// pid 0 would signal this test's own process group.
	assert.ok(supervisor > 0 && jobFile(p, second, "state") === "running", "the OMP job is still supervised");
	process.kill(supervisor, "SIGKILL");
	// SIGKILL leaves no finalizer; the sweeps must see a dead owner, so wait for the kernel to drop the pid.
	while (alive(supervisor)) {
		await new Promise((resolve) => setImmediate(resolve));
	}
	assert.deepEqual(await Promise.all([limenAsync(["jobs"]), limenAsync(["jobs"])]), [0, 0]);
	await until(dir, () => starts(second) >= 2);
	assert.equal(jobFile(p, second, "state"), "running");
	await release(dir);
	assert.equal(waitJob(p, second, { env }), "done");
	assert.equal(jobFile(p, second, "result"), "second handoff");
	assert.equal(starts(second), 2, "one replacement supervisor, not two");
	assert.ok(!jobFile(p, second, "log").includes("failed:"));
});

test("hosted Pi gets literal launch flags and the selected extension; stop records stopped once", async () => {
	const extension = join(p.parent, "selected.ts");
	await writeFile(extension, "export default () => {};\n");
	const flags = ["--provider", "openai-codex", "--model", "gpt-6-astra", "--thinking", "high"];
	const third = spawnJob(
		p,
		"block\nfinish never",
		["--engine", "pi", ...flags, "--extension", extension, "--label", "F001 hosted pi"],
		{ env },
	);
	const dir = jobDir(p, third);
	await until(dir, () => existsSync(join(dir, "fake-blocked-1")));
	const argv = JSON.parse(readFileSync(join(dir, "fake-argv.json"), "utf8")) as string[];
	assert.deepEqual(argv.slice(argv.indexOf("--provider"), argv.indexOf("--provider") + flags.length), flags);
	assert.equal(
		argv.filter((value) => value === extension).length,
		1,
		"the selected extension, once, beside the required hooks",
	);
	assert.ok(argv.some((value) => value.endsWith("/hook/hosted.ts")));
	const stopped = limen(p, ["stop", third, "enough"], { env });
	assert.equal(stopped.status, 0, stopped.stderr);
	assert.equal(jobFile(p, third, "state"), "stopped");
	const tab = jobFile(p, third, "herdr/tab");
	await until(herdr, () => named("tab", "close").some((args) => args[2] === tab));
	assert.equal(jobFile(p, third, "log").match(/\] stopped: enough/g)?.length, 1);
	assert.ok(!jobFile(p, third, "result").includes("never"), "a stopped job never reached its finish line");
	assert.equal(named("tab", "create").length, 3, "one tab per hosted job");
	assert.equal(named("workspace", "create").length, 1, "one role space");
	assert.equal(prompts(first), 1, "still one wake prompt for the first job");
});
