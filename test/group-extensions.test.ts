// Group extension selections: one plant per test, the fake engine as `pi` (it records the argv it got), real bin/limen.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { type GroupRun, groupPath, readRun, saveJson } from "../src/job/group-cabinet.ts";
import { git, jobDir, LIMEN, limen, plant, type RunOptions, TICKET, waitJob } from "./plant.ts";

const lead = { PI_SESSION_ID: "extension-lead" };
const route = ["--engine", "pi", "--provider", "fixture", "--model", "fixture", "--thinking", "high"];
const settings = ["--teams", "2", "--workers-per-team", "3", "--timeout", "30m", "--worker-timeout", "20m", ...route, "--worker-thinking", "high"];
// Exercise the hosted supervisor and its real launch argv without a GUI or provider.
const herdr = `#!/usr/bin/env node
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const args = process.argv.slice(2);
const ok = (result) => console.log(JSON.stringify({ result }));
if (args[0] === 'workspace' && args[1] === 'list') ok({ workspaces: [] });
else if (args[0] === 'workspace' && args[1] === 'create') ok({ workspace: { workspace_id: 'w1' } });
else if (args[0] === 'tab' && args[1] === 'create') { const id = randomUUID(); ok({ tab: { tab_id: 'w1:t' + id }, root_pane: { pane_id: 'w1:p' + id } }); }
else if (args[0] === 'tab' && args[1] === 'get') ok({ tab: { tab_id: args[2], focused: true } });
else if (args[0] === 'pane' && args[1] === 'process-info') ok({ process_info: { foreground_process_group_id: 1, shell_pid: 1, foreground_processes: [{ name: 'zsh', pid: 1 }] } });
else if (args[0] === 'agent' && args[1] === 'start') {
  const selected = args.slice(args.indexOf('--') + 1);
  execFileSync(process.env.GROUP_FAKE_PI, selected);
  const session = selected[selected.indexOf('--session-dir') + 1];
  fs.writeFileSync(session + '/../session-ended', 'fixture ended');
  ok({ pane: { pane_id: args[args.indexOf('--pane') + 1] } });
} else if (args[0] === 'agent' && args[1] === 'get') { console.log(JSON.stringify({ error: { code: 'agent_not_found' } })); process.exit(1); }
else if (args[0] === 'agent' && args[1] === 'list') ok({ agents: [] });
else ok({});
`;
async function fixture(hosted = false) {
	const p = await plant();
	const feature = dirname(TICKET);
	await mkdir(join(p.root, feature, "group/teams"), { recursive: true });
	for (const path of ["group/brief.md", "group/teams/team-1.md", "group/teams/team-2.md"]) await writeFile(join(p.root, feature, path), `# ${path}\n`);
	git(p.root, "add", "-A");
	git(p.root, "commit", "-q", "-m", "group packet");
	await mkdir(join(p.root, ".limen/group-leads"), { recursive: true });
	await writeFile(join(p.root, ".limen/group-leads/extension-lead"), `${process.pid}\n`);
	const extensions = join(p.parent, "extensions");
	await mkdir(extensions);
	const common = join(extensions, "common.ts"),
		privatePath = join(extensions, "private = entry.ts");
	for (const path of [common, privatePath]) await writeFile(path, "export default () => {};\n");
	await symlink(common, join(extensions, "alias.ts"));
	await writeFile(join(p.parent, "herdr"), herdr, { mode: 0o755 });
	const env = hosted ? { ...lead, HERDR_ENV: "1", LIMEN_HERDR: join(p.parent, "herdr"), GROUP_FAKE_PI: join(p.bin, "pi") } : lead;
	const mode = hosted ? "--tab" : "--detached";
	const run = (args: readonly string[], options: RunOptions = {}) => limen(p, args, { ...options, env: { ...env, ...options.env } });
	const start = (...extra: string[]) => run(["group", "start", feature, ...settings, mode, ...extra]);
	const member = (run: GroupRun, team: string) => ({
		LIMEN_JOB: "1",
		LIMEN_JOB_ID: run.members.find((entry) => entry.team === team && entry.role === "coordinator")?.id ?? "",
		LIMEN_CONTEXT_ROOT: p.root,
		LIMEN_GROUP_ID: run.id,
		LIMEN_TEAM_ID: team,
	});
	const launch = (group: GroupRun, team: string, ...extra: string[]) => run(["spawn", "candidate", ...route, mode, ...extra], { env: member(group, team) });
	const resume = (id: string, ...extra: string[]) => run(["continue", id, "follow-up", ...route, mode, ...extra]);
	const checkJob = async (id: string, selected: string[]) => {
		assert.equal(waitJob(p, id), "done");
		assert.deepEqual(JSON.parse(await readFile(join(jobDir(p, id), "extensions.json"), "utf8")), selected);
		const argv: string[] = JSON.parse(await readFile(join(jobDir(p, id), "fake-argv.json"), "utf8"));
		assert.ok(argv.includes("--no-extensions"));
		const loaded = argv.flatMap((arg, index) => (arg === "--extension" ? [argv[index + 1]] : []));
		assert.equal(new Set(loaded).size, loaded.length);
		for (const hook of ["steering", "communication", "group-peer"]) assert.equal(loaded.filter((path) => path?.endsWith(`/hook/${hook}.ts`)).length, 1);
		assert.equal(
			loaded.some((path) => path?.endsWith("/hook/hosted.ts")),
			hosted,
		);
		assert.deepEqual(
			loaded.filter((path) => path?.startsWith(extensions)),
			selected,
		);
	};
	return { ...p, feature, extensions, common, privatePath, mode, run, start, launch, resume, checkJob };
}
const lastLine = (stdout: string) => stdout.trim().split("\n").at(-1) ?? "";

for (const hosted of [false, true])
	test(`${hosted ? "hosted" : "detached"} Pi teams keep common and private selections through workers, reviews and continuation`, async (context) => {
		const f = await fixture(hosted);
		context.after(f.cleanup);
		const started = f.start(
			"--extension",
			f.common,
			"--extension",
			join(f.extensions, "alias.ts"),
			"--team-extension",
			`team-2=${f.privatePath}`,
			"--team-extension",
			`team-2=${f.common}`,
		);
		assert.equal(started.status, 0, started.stderr);
		const run = await readRun(f.root, lastLine(started.stdout));
		assert.deepEqual({ ...run.teamExtensions }, { "team-1": [f.common], "team-2": [f.common, f.privatePath] });
		for (const coordinator of run.members) {
			const expected = run.teamExtensions?.[coordinator.team] ?? [];
			await f.checkJob(coordinator.id, expected);
			const refused = f.launch(run, coordinator.team, "--extension", f.privatePath);
			assert.equal(refused.status, 1);
			assert.match(refused.stderr, /recorded team extensions/);
			const before = (await readRun(f.root, run.id)).members.length;
			const child = f.launch(run, coordinator.team, ...(coordinator.team === "team-1" ? expected.flatMap((path) => ["--extension", path]) : []));
			assert.equal(child.status, 0, child.stderr);
			const id = lastLine(child.stdout);
			await f.checkJob(id, expected);
			assert.equal((await readRun(f.root, run.id)).members.length, before + 1);
			const bad = f.resume(id, "--extension", f.privatePath);
			assert.equal(bad.status, 1);
			assert.match(bad.stderr, /recorded team extensions/);
			const record = join(jobDir(f, id), "extensions.json");
			await writeFile(record, "[]\n");
			assert.match(f.resume(id).stderr, /parent does not match/);
			await writeFile(record, JSON.stringify(expected));
			const continued = f.resume(id);
			assert.equal(continued.status, 0, continued.stderr);
			const continuedId = lastLine(continued.stdout);
			await f.checkJob(continuedId, expected);
			const entry = (await readRun(f.root, run.id)).members.find((entry) => entry.id === continuedId);
			assert.equal(entry?.parent, id);
			assert.equal(entry?.team, coordinator.team);
			assert.ok(entry && entry.deadline <= run.deadline - run.reserveMs);
			const branch = readFileSync(join(jobDir(f, id), "branch"), "utf8").trim();
			assert.equal(f.launch(run, coordinator.team, "--review", "--branch", "main").status, 1);
			const review = f.launch(run, coordinator.team, "--review", "--branch", branch);
			assert.equal(review.status, 0, review.stderr);
			await f.checkJob(lastLine(review.stdout), expected);
			assert.equal(f.resume(continuedId).status, 1, "continuation uses the total launch allowance");
			assert.match(f.resume(coordinator.id).stderr, /coordinator continuation/);
		}
	});

test("invalid group selections never activate or consume jobs, including later teams and OMP", async (context) => {
	const f = await fixture();
	context.after(f.cleanup);
	const trees = git(f.root, "worktree", "list", "--porcelain");
	for (const extra of [
		["--team-extension", "team-2=missing.ts"],
		["--team-extension", `team-9=${f.common}`],
		["--team-extension", "team-2="],
		["--team-extension", "wrong"],
		["--extension"],
		["--extension", "npm:package"],
	]) {
		const result = f.start("--extension", f.common, ...extra);
		assert.equal(result.status, 1, result.stderr);
	}
	const omp = f.run(["group", "start", f.feature, ...settings.map((arg) => (arg === "pi" ? "omp" : arg)), f.mode, "--team-extension", `team-2=${f.common}`]);
	assert.match(omp.stderr, /supported only for Pi/);
	assert.deepEqual(await readdir(join(f.root, ".limen/groups")).catch(() => []), []);
	assert.deepEqual(await readdir(join(f.root, ".limen/jobs")).catch(() => []), []);
	assert.equal(git(f.root, "worktree", "list", "--porcelain"), trees);
});

test("concurrent and repeated starts keep the original selections, even after a path disappears", async (context) => {
	const f = await fixture();
	context.after(f.cleanup);
	const start = (path: string) =>
		new Promise<string>((resolve, reject) => {
			const child = spawn(process.execPath, [LIMEN, "group", "start", f.feature, ...settings, f.mode, "--team-extension", `team-2=${path}`], {
				cwd: f.root,
				env: { ...f.env, ...lead },
				stdio: ["ignore", "pipe", "pipe"],
			});
			let output = "",
				errors = "";
			child.stdout.on("data", (data) => {
				output += data;
			});
			child.stderr.on("data", (data) => {
				errors += data;
			});
			child.on("error", reject);
			child.on("close", (code) => (code === 0 ? resolve(lastLine(output)) : reject(new Error(errors))));
		});
	const ids = await Promise.all([start(f.common), start(f.privatePath)]);
	assert.equal(ids[0], ids[1]);
	const run = await readRun(f.root, ids[0] ?? "");
	assert.equal(run.members.length, 2);
	assert.deepEqual(run.teamExtensions?.["team-1"], []);
	for (const member of run.members) await f.checkJob(member.id, run.teamExtensions?.[member.team] ?? []);
	const original = await readFile(join(groupPath(run), "run.json"), "utf8");
	await rm(f.common);
	await rm(f.privatePath);
	const repeated = f.start("--extension", "missing-again.ts");
	assert.equal(repeated.status, 0, repeated.stderr);
	assert.equal(lastLine(repeated.stdout), run.id);
	assert.equal(await readFile(join(groupPath(run), "run.json"), "utf8"), original);
	assert.equal((await readdir(join(f.root, ".limen/jobs"))).length, 2);
	assert.match(f.launch(run, "team-2").stderr, /cannot use extension/);
	assert.equal((await readRun(f.root, run.id)).members.length, 2);
	assert.equal(f.start("--new-run").status, 1);
});

test("malformed new maps fail closed; legacy groups keep explicit spawn and parent replacement", async (context) => {
	const f = await fixture();
	context.after(f.cleanup);
	const started = f.start();
	assert.equal(started.status, 0, started.stderr);
	const run = await readRun(f.root, lastLine(started.stdout));
	for (const member of run.members) await f.checkJob(member.id, []);
	assert.match(f.launch(run, "team-1", "--extension", f.common).stderr, /recorded team extensions/);
	assert.equal((await readRun(f.root, run.id)).members.length, 2);
	for (const map of [null, [], {}, { "team-1": [], "team-2": ["relative.ts"] }, { "team-1": [], "team-2": "bad" }]) {
		await saveJson(join(groupPath(run), "run.json"), { ...run, teamExtensions: map });
		await assert.rejects(readRun(f.root, run.id), /invalid teamExtensions/);
		assert.match(f.launch(run, "team-1").stderr, /invalid teamExtensions/);
	}
	delete run.teamExtensions;
	await saveJson(join(groupPath(run), "run.json"), run);
	const child = f.launch(run, "team-1", "--extension", f.common);
	assert.equal(child.status, 0, child.stderr);
	const id = lastLine(child.stdout);
	await f.checkJob(id, [f.common]);
	const inherited = f.resume(id);
	assert.equal(inherited.status, 0, inherited.stderr);
	await f.checkJob(lastLine(inherited.stdout), [f.common]);
	await rm(f.common);
	const replaced = f.resume(id, "--extension", f.privatePath);
	assert.equal(replaced.status, 0, replaced.stderr);
	await f.checkJob(lastLine(replaced.stdout), [f.privatePath]);
	assert.equal("teamExtensions" in (await readRun(f.root, run.id)), false);
});
