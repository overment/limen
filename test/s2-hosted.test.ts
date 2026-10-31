// S2 · hosted spawn. A fake Herdr (written below to the plant) records every call, runs the pane command as a real
// child process so the fake engine and its hooks really load, answers `agent get` from a state file the test edits,
// and names the pane's foreground process after the engine it launched, as real Herdr does.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { FINAL, jobDir, jobFile, limen, type Plant, plant, release, spawnJob, start, until, waitJob } from "./plant.ts";

const WAKE = fileURLToPath(new URL("../hook/wake.ts", import.meta.url));

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
const stop = (pane) => { const running = engine(pane); if (running) process.kill(running.pid, "SIGTERM"); };
const [noun, verb, target] = args;
switch (noun + " " + verb) {
	case "workspace list": ok({ workspaces: state.workspaces });
	case "workspace create": state.workspaces.push({ workspace_id: "w" + (state.workspaces.length + 1), label: flag("--label") });
		save(); ok({ workspace: state.workspaces.at(-1) });
	case "tab create": {
		const n = Object.keys(state.tabs).length + 1, env = {};
		args.forEach((value, index) => { if (value === "--env") { const [key, ...rest] = args[index + 1].split("="); env[key] = rest.join("="); } });
		state.tabs["t" + n] = { pane: "p" + n, cwd: flag("--cwd"), env, label: flag("--label") };
		save(); ok({ tab: { tab_id: "t" + n }, root_pane: { pane_id: "p" + n } });
	}
	case "tab get": ok({ tab: { tab_id: target, focused: true, label: state.tabs[target]?.label } });
	case "tab list": ok({ tabs: Object.entries(state.tabs).filter(([, row]) => !row.closed).map(([tab_id, row]) => ({ tab_id, label: row.label })) });
	case "tab rename": (state.tabs[target] ??= {}).label = args[3]; save(); ok({});
	case "tab close": stop(state.tabs[target]?.pane); (state.tabs[target] ??= {}).closed = true; save(); ok({});
	case "pane process-info": { const running = engine(flag("--pane"));
		ok({ process_info: { foreground_processes: [running ? { name: running.kind, pid: running.pid } : { name: "zsh" }] } }); }
	case "agent start": {
		const pane = flag("--pane"), kind = flag("--kind"), tab = Object.values(state.tabs).find((row) => row.pane === pane);
		const base = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(HERDR_|LIMEN_(?!HOME|HERDR|HUNK))/.test(key)));
		const env = { ...base, ...tab.env, HERDR_PANE_ID: pane };
		const binary = env.PATH.split(":").map((dir) => path.join(dir, kind)).find((candidate) => fs.existsSync(candidate));
		const child = spawn(binary, args.slice(args.indexOf("--") + 1), { cwd: tab.cwd, env, detached: true, stdio: "ignore" });
		child.unref();
		state.procs[pane] = { pid: child.pid, kind }; state.agents[pane] = { name: target, status: "done" }; save();
		ok({ agent: { pane_id: pane, name: target } });
	}
	case "agent get": if (!state.agents[target] || !engine(target)) fail("agent_not_found");
		ok({ agent: { pane_id: target, agent_status: state.agents[target].status } });
	case "agent list": ok({ agents: Object.entries(state.agents).filter(([pane]) => engine(pane)).map(([pane_id, row]) => ({ pane_id, name: row.name })) });
	case "agent send-keys": stop(target); ok({});
	case "agent prompt": fail("agent_prompt_stalled"); // Sent, but the busy coordinator pane started no turn.
	case "status --json": console.log(JSON.stringify({ server: { running: true, socket: path.join(__dirname, "h.sock") } })); process.exit(0);
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
// Herdr's socket API, served here, takes a prompt too long for one argument; as with `agent prompt`, no turn starts.
const asked: string[] = [];
const socket = createServer((conn) =>
	createInterface({ input: conn }).once("line", (line) => {
		asked.push(JSON.parse(line).params.text);
		conn.end('{"id":"","error":{"code":"agent_prompt_stalled","message":"no turn"}}\n');
	}),
);
const engineArgv = (pane: string): string[] => {
	const start = named("agent", "start").find((args) => args[args.indexOf("--pane") + 1] === pane) ?? [];
	return start.slice(start.indexOf("--") + 1);
};
const pane = (id: string) => jobFile(p, id, "herdr/pane");
const starts = (id: string) => jobFile(p, id, "log").match(/hosted supervisor started/g)?.length ?? 0;
type Fake = { agents: Record<string, { status: string }>; tabs: Record<string, { label?: string }> };
const state = () => JSON.parse(readFileSync(join(herdr, "state.json"), "utf8")) as Fake;
const saveState = async (next: unknown) => {
	await writeFile(join(herdr, "state.tmp"), JSON.stringify(next));
	await rename(join(herdr, "state.tmp"), join(herdr, "state.json"));
};
const alive = (pid: number) => spawnSync("kill", ["-0", String(pid)]).status === 0;
/** Runs the CLI without blocking the event loop, so two sweeps can race. */
const limenAsync = async (args: readonly string[]) => (await start(p, args, { env }).done).status;

before(async () => {
	p = await plant();
	herdr = join(p.parent, "herdr");
	await mkdir(herdr);
	await writeFile(join(herdr, "state.json"), JSON.stringify({ workspaces: [], tabs: {}, procs: {}, agents: {} }));
	await writeFile(join(herdr, "herdr"), herdrSource);
	await chmod(join(herdr, "herdr"), 0o755);
	await new Promise<void>((resolve) => socket.listen(join(herdr, "h.sock"), resolve));
	// The caller is a coordinator pane with no Pi session: its wake travels as one Herdr prompt. Sweeps confirm at once.
	env = {
		LIMEN_HERDR: join(herdr, "herdr"),
		HERDR_ENV: "1",
		HERDR_PANE_ID: COORDINATOR,
		HERDR_TAB_ID: "coord:t0",
		LIMEN_REAP_CONFIRM_MS: "1",
	};
});
after(() => p.cleanup().finally(() => socket.close()));

let second = "";
test("a live OMP job stays running while Herdr reports done, then after Herdr loses its agent row (88fd5ac)", async () => {
	second = spawnJob(p, "block\nfinish\nfinish omp done", ["--tab", "--engine", "omp", "--label", "F001 omp"], { env });
	await until(jobDir(p, second), () => existsSync(join(jobDir(p, second), "fake-blocked-1")));
	const target = pane(second);
	const start = named("agent", "start").find((args) => args.includes(target)) ?? [];
	assert.equal(start[start.indexOf("--kind") + 1], "omp");
	// Herdr says the agent is done (unseen idle); only the session or the process ending finishes a hosted job.
	await until(herdr, () => named("agent", "get").filter((args) => args[2] === target).length >= 2);
	assert.equal(jobFile(p, second, "state"), "running", "Herdr done is not job completion");
	const seen = named("pane", "process-info").length;
	await saveState({ ...state(), agents: {} }); // Herdr loses the job's agent row; its engine runs on.
	// Each missing sample probes the pane once; four probes is past the three-sample missing window.
	const probes = () => named("pane", "process-info").filter((args, at) => at >= seen && args.includes(target)).length;
	await until(herdr, () => probes() >= 4 || jobFile(p, second, "state") !== "running");
	assert.equal(jobFile(p, second, "state"), "running", `a lost agent row must not end the job on ${target}`);
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
	assert.deepEqual([waitJob(p, second, { env }), jobFile(p, second, "result")], ["done", "omp done"]);
	assert.deepEqual([starts(second), jobFile(p, second, "log").includes("failed:")], [2, false], "one replacement");
});

test("in Herdr a spawn with no mode flag runs detached under its --timeout; queued, it tells its pane once that it started", async () => {
	const reading = join(p.parent, "start-reading.json");
	await writeFile(reading, '{"cpuIdle":90,"memoryFree":10}');
	const run = limen(p, ["spawn", "--timeout", "5m", "--label", "flagless", `say ${FINAL.line.repeat(12)}`], { env });
	assert.match(run.stdout, /\nqueued flagless: CPU 90% idle \(gate 25%\), memory 10% free \(gate 20%\), 0 ahead\n/);
	const id = run.stdout.trim().split("\n").at(-1) ?? "";
	await writeFile(reading, "{}");
	assert.equal(waitJob(p, id, { env }), "done");
	assert.equal(jobFile(p, id, "herdr/mode"), "watch", "a log-tail tab, not a hosted pane");
	const receipts = ["herdr-start", "herdr-prompt"].map((name) => () => jobFile(p, id, `notify/${name}`));
	await until(jobDir(p, id), () => receipts.every((receipt) => receipt().startsWith("attempt 1: delivered to")));
	const sent = [...named("agent", "prompt").map((args) => args[3] ?? ""), ...asked].filter((text) => text.includes(id));
	assert.equal(sent.map((text) => text.includes(") started after ")).join(), "true,false", "each sent once");
	assert.ok(asked.at(-1)?.includes(`Final message:\n${FINAL.text.repeat(12)}\n\n`), "whole, by socket");
});

test("a rule set, change, end and end time ping each live coordinator pane once (F951); a dead timer's rule still ends", async () => {
	// Two sessions on w1:p1; w1:p3 shut down; w1:p4's pid belongs to another process now; coord:p0 runs the commands.
	for (const [index, pane] of ["w1:p1", "w1:p1", "w1:p2", "w1:p3", "w1:p4", COORDINATOR].entries()) {
		const dir = join(p.root, ".limen/coordinators", `s${index}`);
		await mkdir(dir, { recursive: true });
		const files = { pid: process.pid, pane, "started-at": new Date(index * 60_000).toISOString() };
		for (const [name, value] of Object.entries({ ...files, ...[{}, {}, {}, { shutdown: 1 }, { born: 0 }][index] })) {
			await writeFile(join(dir, name), `${value}\n`);
		}
	}
	const said = (rule: string) => named("agent", "prompt").filter((args) => args[3]?.startsWith(`Limen rule ${rule} `));
	const panes = (rule: string, word: string) =>
		said(rule).flatMap((args) => (args[3]?.includes(word) ? [args[2]] : []));
	const heard = (rule: string, ...words: string[]) => words.map((word) => panes(rule, word).sort());
	const rule = (...args: string[]) => limen(p, ["rule", ...args], { env }).stdout;
	assert.match(rule("set", "week", "--until", "1h", "Hold reviews"), /^rule week set/);
	assert.match(rule("set", "week", "--until", "1h", "--start-priority", "1", "Priority 1 only"), /^rule week changed/);
	const board = limen(p, ["board"], { env }).stdout + rule("end", "week", "done"); // an hour before its end time
	assert.match(board, /^## RULES .*\n- week until .*, start priority 1: Priority 1 only\n[\s\S]*\nrule week ended\n/);
	const [set = "", , , change = ""] = said("week").map((args) => args[3] ?? ""); // three set pings, then the change
	assert.match(set, /^Limen rule week for every coordinator, until \w+ \d+ \w+, \d\d:\d\d .*Hold reviews\. .*build/);
	assert.match(change, /changed; it now holds until .*Priority 1 only\. Start priority: 1\./);
	// The pane that runs a command is a live coordinator pane too, so it hears each set, change and end.
	const live = [COORDINATOR, "w1:p1", "w1:p2"];
	assert.deepEqual(heard("week", "coordinator, until", "changed", "(by limen rule end: done)"), [live, live, live]);
	rule("set", "now", "--until", "1h", "Now");
	assert.match(rule("set", "now", "--until", "2s", "Soon"), /^rule now changed/); // then only its timer can end it
	await until(herdr, () => panes("now", " ended ").length >= 3);
	assert.deepEqual(heard("now", "coordinator, until", "changed", "(its end time passed)"), [live, live, live]);
	assert.deepEqual([rule(), limen(p, ["board"], { env }).stdout.includes("RULES")], ["no active rules\n", false]);
	// A rule whose timer died ends on the next command, once, though two commands race to end it.
	rule("set", "late", "--until", "1h", "Late");
	spawnSync("pkill", ["-f", join(p.parent, ".limen/rules/late")]);
	const record = join(p.parent, ".limen/rules/late/rule.json");
	await writeFile(record, readFileSync(record, "utf8").replace(/"until": "[^"]+"/, '"until": "2000-01-01T00:00:00Z"'));
	assert.deepEqual(await Promise.all([limenAsync(["jobs"]), limenAsync(["rule"])]), [0, 0]);
	await until(herdr, () => panes("late", " ended ").length >= 3);
	assert.deepEqual(heard("late", " ended "), [live]);
});

let third = "";
test("limen highlight marks what Limen writes into Herdr; live panes and open tabs follow it on and off", async () => {
	const lead = { ...env, HERDR_PANE_ID: "lead:p1", HERDR_TAB_ID: "lead:t1", PI_SESSION_ID: "lead" };
	await saveState({ ...state(), tabs: { ...state().tabs, "lead:t1": { label: "origin highlight" } } });
	const dir = await mkdtemp(join(p.parent, "lead-"));
	await writeFile(join(dir, "task.md"), "block\n/limen highlight off\nblock\n");
	const args = ["--extension", WAKE, "--session-dir", join(dir, "session"), `@${join(dir, "task.md")}`];
	spawn(join(p.bin, "pi"), args, { cwd: p.root, env: { ...p.env, ...lead }, stdio: "ignore" });
	assert.match(limen(p, ["highlight"], { env }).stdout, /^off\n◆ Limen: .+\n$/, "off on a fresh seat");
	third = spawnJob(p, "block\nfinish never", ["--tab", "--engine", "pi", "--label", "F001 lit"], { env: lead });
	// The coordinator pane's and the job pane's last report past its sequence number, then the two tab labels.
	const last = (at: string) => (named("pane", "report-metadata").findLast((a) => a[2] === at) ?? []).slice(7);
	const tabs = () => [state().tabs["lead:t1"]?.label, state().tabs[jobFile(p, third, "herdr/tab")]?.label];
	const shown = () => [last("lead:p1"), last(pane(third)), tabs()].flat().join(" ");
	const label = (m: string, word: string) => `--state-label ${word}=${m && `${word} ${m}`}`;
	const [job, ready] = ["1 RUNNING · 1 watched · 0 unwatched · lit · F001 think", "job RUNNING · pane ready"];
	const want = (m: string) =>
		`--title ${m}Limen · lit · F001 --display-agent ${m}Limen · waiting on 1 job --token limen=${m}${job} ` +
		`${label(m, "idle")}${job} ${label(m, "done")}${job} --ttl-ms 180000 --display-agent ${m}limen worker ` +
		`--token limen=${m}job RUNNING ${label(m, "idle")}${ready} ${label(m, "done")}${ready} --ttl-ms 180000 ` +
		`origin highlight · ${m}1 running ${m}F001 lit · running`;
	await until(herdr, () => shown() === want(""));
	assert.match(limen(p, ["highlight", "on"], { env }).stdout, /^on\n.+\n1 open job tab renamed\n$/);
	await until(herdr, () => shown() === want("◆ "));
	await release(dir); // `/limen highlight off` in the coordinator: each label goes back to today's text
	await until(herdr, () => shown() === want(""));
	const leaked = engineArgv(pane(third)).filter((arg) => arg.includes("finish never") || /[\r\n]/.test(arg));
	assert.deepEqual(leaked, [], "a hosted job's task never travels as argv");
	await release(dir, 2); // The job blocks on: the stop below ends it.
});

test("hosted Pi stop records stopped once and closes the job's tab", async () => {
	const stopped = limen(p, ["stop", third, "enough"], { env });
	assert.deepEqual([stopped.status, jobFile(p, third, "state")], [0, "stopped"], stopped.stderr);
	await until(herdr, () => named("tab", "close").some((args) => args[2] === jobFile(p, third, "herdr/tab")));
	assert.equal(jobFile(p, third, "log").match(/\] stopped: enough/g)?.length, 1);
	const made = [named("tab", "create").length, named("workspace", "create").length];
	assert.deepEqual(made, [3, 1], "one tab per job, one role space");
});
