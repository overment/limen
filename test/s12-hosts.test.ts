// S12 · Remote hosts. Config, ranking, and quoting are pure. A fake ssh on PATH runs the real starter and the real
// launch script in a temp directory, so finalize, fast-forward, stop, and overflow are the seat's own code.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { cmdQuote, type HostPlatform, launchScript, type RemoteHost, sshArgv } from "../src/runtime/host-shell.ts";
import { parseHostPool, rankHosts, validateRemoteLaunch } from "../src/runtime/hosts.ts";
import * as plant from "./plant.ts";

const HOOK = fileURLToPath(new URL("../hook", import.meta.url));
const gate = { cpuIdle: 25, memoryFree: 20 };

function host(over: Partial<RemoteHost> & Pick<RemoteHost, "alias">): RemoteHost {
	return {
		ssh: over.alias,
		platform: "darwin",
		root: "/repo",
		hook: "/hook",
		maxConcurrent: 2,
		enabled: true,
		distro: "Ubuntu",
		path: "",
		model: "",
		...over,
	};
}

test("hosts.json parses darwin and WSL hosts and rejects a bad platform or a duplicate alias", () => {
	const parsed = parseHostPool(
		{
			overflow: true,
			extra: 1,
			hosts: [
				{
					alias: "mbp",
					ssh: "ada@mbp",
					platform: "darwin",
					root: "/Users/ada/src/limen-sandbox/",
					hook: "/Users/ada/src/limen/hook",
					maxConcurrent: 2,
					note: "desk",
				},
				{
					alias: "win",
					ssh: "ada@laptop",
					platform: "windows-wsl",
					root: "/home/ada/src/limen-sandbox",
					hook: "/home/ada/src/limen/hook",
					maxConcurrent: 1,
					enabled: false,
					distro: "Ubuntu",
				},
			],
		},
		"hosts.json",
	);
	assert.equal(parsed.overflow, true);
	assert.deepEqual(parsed.ignored, ["extra", "mbp.note"]);
	assert.equal(parsed.hosts[0]?.root, "/Users/ada/src/limen-sandbox");
	assert.equal(parsed.hosts[0]?.enabled, true);
	assert.equal(parsed.hosts[0]?.distro, "Ubuntu");
	assert.equal(parsed.hosts[1]?.enabled, false);
	assert.throws(
		() =>
			parseHostPool(
				{ hosts: [{ alias: "mbp", ssh: "h", platform: "win32", root: "/a", hook: "/h", maxConcurrent: 1 }] },
				"hosts.json",
			),
		/platform/,
	);
	assert.throws(
		() =>
			parseHostPool(
				{
					hosts: [
						{ alias: "mbp", ssh: "h", platform: "darwin", root: "/a", hook: "/h", maxConcurrent: 1 },
						{ alias: "mbp", ssh: "h", platform: "darwin", root: "/a", hook: "/h", maxConcurrent: 1 },
					],
				},
				"hosts.json",
			),
		/twice/,
	);
});

test("rankHosts skips a disabled, full, or idle-starved host and prefers the freer one", () => {
	const mbp = host({ alias: "mbp", maxConcurrent: 1 });
	const win = host({ alias: "win", platform: "windows-wsl", maxConcurrent: 2 });
	const mac = host({ alias: "mac", maxConcurrent: 2 });
	const readings = {
		mbp: { cpuIdle: 80, memoryFree: 80 },
		win: { cpuIdle: 90, memoryFree: 90 },
		mac: { cpuIdle: 10, memoryFree: 90 },
	};
	assert.equal(rankHosts([mbp, win, mac], { mbp: 1, win: 0, mac: 0 }, readings, gate)?.alias, "win");
	assert.equal(rankHosts([win], { win: 0 }, { win: undefined }, gate), undefined);
	assert.equal(rankHosts([{ ...win, enabled: false }], { win: 0 }, readings, gate), undefined);
	const tie = rankHosts(
		[host({ alias: "b", maxConcurrent: 2 }), host({ alias: "a", maxConcurrent: 2 })],
		{ a: 0, b: 0 },
		{
			a: { cpuIdle: 50, memoryFree: 50 },
			b: { cpuIdle: 50, memoryFree: 50 },
		},
		gate,
	);
	assert.equal(tie?.alias, "a");
});

test("validateRemoteLaunch refuses a group, a tab, and a non-Pi engine", () => {
	const pool = parseHostPool(
		{ hosts: [{ alias: "mbp", ssh: "h", platform: "darwin", root: "/a", hook: "/h", maxConcurrent: 1 }] },
		"hosts.json",
	);
	const launch = { tab: false, grouped: false, engine: "pi" };
	assert.doesNotThrow(() => validateRemoteLaunch(pool, undefined, launch));
	assert.throws(() => validateRemoteLaunch(pool, "missing", launch), /not in/);
	assert.throws(() => validateRemoteLaunch(pool, "mbp", { ...launch, grouped: true }), /group/);
	assert.throws(() => validateRemoteLaunch(pool, "mbp", { ...launch, tab: true }), /omit --tab/);
	assert.throws(() => validateRemoteLaunch(pool, "mbp", { ...launch, engine: "omp" }), /Pi/);
});

test("ssh quoting runs the same script on the darwin starter and the WSL command", () => {
	const script = "echo quoted-ok\n";
	for (const platform of ["darwin", "windows-wsl"] as const satisfies readonly HostPlatform[]) {
		const argv = sshArgv("ssh", { ssh: "ada@host", platform, distro: "Ubuntu 24" });
		assert.equal(argv[0], "ssh");
		assert.ok(argv.includes("BatchMode=yes"));
		const command = argv.at(-1) ?? "";
		if (platform === "windows-wsl") {
			assert.ok(command.startsWith(`wsl.exe -d ${cmdQuote("Ubuntu 24")} -- bash -c "`), command);
		} else {
			assert.ok(command.startsWith("bash -c '"), command);
		}
		// Darwin: the remote shell receives one single-quoted `bash -c`. Windows cmd does not expand `$`;
		// the starter is the double-quoted argument WSL's bash -c runs, so run that argument directly.
		const ran =
			platform === "windows-wsl"
				? spawnSync("bash", ["-c", command.match(/bash -c "([^"]*)"$/)?.[1] ?? ""], {
						input: script,
						encoding: "utf8",
					})
				: spawnSync("bash", ["-lc", command], { input: script, encoding: "utf8" });
		assert.equal(ran.status, 0, ran.stderr);
		assert.equal(ran.stdout, "quoted-ok\n");
	}
});

test("the launch script quotes a label and a task for both platforms and passes bash -n", () => {
	const script = launchScript({
		host: host({ alias: "mbp", root: "/Users/ada/My Repo", hook: "/Users/ada/limen/hook", path: "/opt/homebrew/bin" }),
		jobId: "job-1",
		branch: "limen/job-1",
		label: `say "hi"`,
		piArgs: ["--name", `limen: say "hi"`, "--approve"],
		bridged: false,
		task: "line one\nline 'two'\n",
	});
	assert.match(script, /export PATH='\/opt\/homebrew\/bin':"\$PATH"/);
	assert.match(script, /My Repo/);
	assert.match(script, /limen\/job-1/);
	const syntax = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });
	assert.equal(syntax.status, 0, syntax.stderr);
	const decoded = spawnSync(
		"bash",
		[
			"-lc",
			`node -e 'const c=[];process.stdin.on("data",d=>c.push(d));process.stdin.on("end",()=>process.stdout.write(Buffer.from(Buffer.concat(c).toString().trim(),"base64")))' <<'LIMEN_TASK'\n${Buffer.from("line one\nline 'two'\n", "utf8").toString("base64")}\nLIMEN_TASK`,
		],
		{ encoding: "utf8" },
	);
	assert.equal(decoded.stdout, "line one\nline 'two'\n");
});

const sshProgram = `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "-o" || args[i] === "-p") { i += 1; continue; }
  if (args[i].startsWith("-")) continue;
  positional.push(args[i]);
}
let command = positional.slice(1).join(" ");
const secret = process.env.FAKE_SSH_SECRET || "";
const stdin = readFileSync(0);
const secretInStdin = secret !== "" && stdin.includes(secret);
const secretInCommand = secret !== "" && command.includes(secret);
appendFileSync(process.env.FAKE_SSH_LOG, JSON.stringify({ host: positional[0] ?? "", command, secretInStdin, secretInCommand }) + "\\n");
const wsl = /^wsl\\.exe -d (?:"([^"]*)"|(\\S+)) -- bash -c "(.*)"$/.exec(command);
const result = wsl
  ? spawnSync("bash", ["-c", wsl[3]], { input: stdin, maxBuffer: 64 * 1024 * 1024 })
  : spawnSync("bash", ["-lc", command], { input: stdin, maxBuffer: 64 * 1024 * 1024 });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
`;

async function remotePlant(platform: HostPlatform, alias: string) {
	const made = await plant.plant();
	const origin = join(made.parent, "origin.git");
	const clone = join(made.parent, "host-repo");
	plant.git(made.parent, "init", "-q", "--bare", "-b", "main", origin);
	plant.git(made.root, "remote", "add", "origin", origin);
	plant.git(made.root, "push", "-q", "origin", "main");
	plant.git(made.parent, "clone", "-q", origin, clone);
	plant.git(clone, "config", "user.email", "limen@example.test");
	plant.git(clone, "config", "user.name", "Limen Test");
	await writeFile(join(made.bin, "ssh"), sshProgram);
	await chmod(join(made.bin, "ssh"), 0o755);
	const log = join(made.parent, "ssh.jsonl");
	await writeFile(
		join(made.parent, ".limen", "hosts.json"),
		`${JSON.stringify(
			{
				overflow: false,
				hosts: [
					{
						alias,
						ssh: `${alias}.tailnet`,
						platform,
						root: clone,
						hook: HOOK,
						maxConcurrent: 2,
						enabled: true,
					},
				],
			},
			null,
			2,
		)}\n`,
	);
	const env = { FAKE_SSH_LOG: log, LIMEN_HOST_STEER_MS: "50" };
	return { made, clone, log, env, alias };
}

test("a --host job runs Pi over ssh, copies the handoff home, and fast-forwards", async () => {
	const { made, clone, env, alias } = await remotePlant("darwin", "mbp");
	try {
		const id = plant.spawnJob(
			made,
			"note The plan stays.\ncommit\nfinish\nfinish Hello from the host",
			["--host", alias, "--label", "remote"],
			{
				env,
			},
		);
		assert.equal(plant.waitJob(made, id, { env }), "done");
		assert.equal(plant.jobFile(made, id, "result").split("\n")[0], "Hello from the host");
		assert.equal(plant.jobFile(made, id, "host"), alias);
		assert.match(plant.jobFile(made, id, "log"), /remote host mbp: fetching/);
		assert.match(plant.jobFile(made, id, "log"), /\[mbp\] limen-remote: fetch/);
		const branch = plant.jobFile(made, id, "branch");
		const work = plant.jobFile(made, id, "worktree");
		const origin = plant.git(clone, "remote", "get-url", "origin");
		assert.equal(plant.git(work, "rev-parse", "HEAD"), plant.git(origin, "rev-parse", branch));
		assert.throws(() => plant.git(clone, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`));
		assert.ok(plant.jobFile(made, id, "session-ended"));
		assert.equal(plant.jobFile(made, id, "note.md"), "The plan stays.");
		assert.ok(existsSync(join(plant.jobDir(made, id), "session", "fake.jsonl")));
		assert.match(plant.jobFile(made, id, "commits"), /fake commit/);
		assert.equal(existsSync(join(made.parent, `.host-repo-limen-worktrees/${id}`)), false);
		assert.equal(existsSync(join(clone, ".limen", "jobs", id)), false);
	} finally {
		await made.cleanup();
	}
});

test("a windows-wsl host is reached with wsl.exe and finalizes the same way", async () => {
	const { made, log, env, alias } = await remotePlant("windows-wsl", "win");
	try {
		const id = plant.spawnJob(made, "finish\nfinish from wsl", ["--host", alias, "--label", "wsl"], { env });
		assert.equal(plant.waitJob(made, id, { env }), "done");
		assert.equal(plant.jobFile(made, id, "result").split("\n")[0], "from wsl");
		const calls = (await import("node:fs")).readFileSync(log, "utf8");
		assert.match(calls, /wsl\.exe -d \\"Ubuntu\\" -- bash -c /);
	} finally {
		await made.cleanup();
	}
});

test("limen stop kills a remote Pi and the job records stopped", async () => {
	const { made, clone, env, alias } = await remotePlant("darwin", "mbp");
	try {
		const id = plant.spawnJob(made, "block\nfinish\nfinish stopped late", ["--host", alias, "--label", "block"], {
			env,
		});
		const remoteJob = join(clone, ".limen", "jobs", id);
		await plant.until(clone, () => existsSync(join(remoteJob, "fake-blocked-1")));
		assert.equal(plant.limen(made, ["stop", id, "enough"], { env }).status, 0);
		assert.equal(plant.waitJob(made, id, { env }), "stopped");
	} finally {
		await made.cleanup();
	}
});

test("overflow sends a job when the seat gate is closed and a host has room", async () => {
	const seat = await remotePlant("darwin", "mbp");
	try {
		const poolPath = join(seat.made.parent, ".limen", "hosts.json");
		const { readFileSync } = await import("node:fs");
		await writeFile(poolPath, readFileSync(poolPath, "utf8").replace('"overflow": false', '"overflow": true'));
		await writeFile(join(seat.made.parent, "start-reading.json"), '{"cpuIdle":0,"memoryFree":0}\n');
		const env = { ...seat.env, LIMEN_HOST_READING: '{"cpuIdle":80,"memoryFree":80}' };
		const id = plant.spawnJob(seat.made, "finish\nfinish overflowed", ["--label", "overflow"], { env });
		assert.equal(plant.waitJob(seat.made, id, { env }), "done");
		assert.equal(plant.jobFile(seat.made, id, "host"), "mbp");
		assert.equal(plant.jobFile(seat.made, id, "result").split("\n")[0], "overflowed");
	} finally {
		await seat.made.cleanup();
	}
});

test("a review on a host fast-forwards the candidate and keeps the handoff", async () => {
	const { made, env, alias } = await remotePlant("darwin", "mbp");
	try {
		plant.git(made.root, "checkout", "-q", "-b", "candidate");
		await writeFile(join(made.root, "note.txt"), "review me\n");
		plant.git(made.root, "add", "note.txt");
		plant.git(made.root, "commit", "-q", "-m", "candidate");
		plant.git(made.root, "push", "-q", "origin", "candidate");
		plant.git(made.root, "checkout", "-q", "main");
		const id = plant.spawnJob(
			made,
			"finish\nfinish reviewed",
			["--review", "--detached", "--branch", "candidate", "--host", alias, "--label", "review"],
			{ env },
		);
		assert.equal(plant.waitJob(made, id, { env }), "done");
		assert.equal(plant.jobFile(made, id, "result").split("\n")[0], "reviewed");
		assert.equal(plant.jobFile(made, id, "host"), alias);
	} finally {
		await made.cleanup();
	}
});

test("a host model is the default, a bridged model is checked on the host, and the seat token is not logged", async () => {
	const seat = await remotePlant("darwin", "mbp");
	const token = "sk-ant-oat01-test-token-value";
	const accounts = join(seat.made.parent, "accounts");
	await mkdir(accounts);
	await writeFile(join(accounts, "active"), "work\n");
	await writeFile(join(accounts, "work.token"), `${token}\n`);
	const pool = JSON.parse(readFileSync(join(seat.made.parent, ".limen", "hosts.json"), "utf8")) as {
		hosts: Array<{ model?: string }>;
		pruneBranches?: boolean;
	};
	const host = pool.hosts[0];
	if (!host) {
		throw new Error("missing host");
	}
	host.model = "host-model/test";
	pool.pruneBranches = true;
	await writeFile(join(seat.made.parent, ".limen", "hosts.json"), `${JSON.stringify(pool)}\n`);
	const env = { ...seat.env, LIMEN_CLAUDE_ACCOUNTS: accounts, FAKE_SSH_SECRET: token };
	try {
		const bridged = plant.limen(
			seat.made,
			["spawn", "--host", "mbp", "--model", "claude-bridge/claude-sonnet-5-5", "finish"],
			{ env },
		);
		assert.notEqual(bridged.status, 0);
		assert.match(bridged.stderr, /host mbp: bridge missing/);
		assert.doesNotMatch(bridged.stderr, /pi is not on PATH/);
		const local = plant.limen(seat.made, ["spawn", "--model", "claude-bridge/claude-sonnet-5-5", "finish"], { env });
		assert.match(local.stderr, /pi-claude-bridge/);
		const id = plant.spawnJob(seat.made, "commit\nfinish\nfinish billed", ["--host", "mbp", "--label", "billed"], {
			env,
		});
		assert.equal(plant.waitJob(seat.made, id, { env }), "done");
		assert.equal(plant.jobFile(seat.made, id, "model"), "host-model/test");
		const logged = plant.jobFile(seat.made, id, "log");
		assert.match(logged, /seat Claude account work for this job/);
		assert.equal(logged.includes(token), false);
		const calls = readFileSync(seat.log, "utf8");
		assert.equal(calls.includes(token), false);
		assert.match(calls, /"secretInStdin":true/);
		assert.doesNotMatch(calls, /"secretInCommand":true/);
		const branch = plant.jobFile(seat.made, id, "branch");
		assert.match(logged, new RegExp(`deleted origin/${branch.replaceAll("/", "\\/")}`));
		await writeFile(join(seat.made.bin, "claude"), "#!/bin/sh\nexit 0\n");
		await chmod(join(seat.made.bin, "claude"), 0o755);
		const check = plant.limen(seat.made, ["hosts", "check", "mbp"], { env });
		assert.equal(check.status, 0, check.stderr);
		assert.match(check.stdout, /pi ok/);
		assert.match(check.stdout, /node ok/);
		assert.match(check.stdout, /hook ok/);
		assert.match(check.stdout, /git ok/);
		assert.match(check.stdout, /seat account work/);
		const pruned = plant.limen(seat.made, ["hosts", "prune"], { env });
		assert.match(pruned.stdout, /already gone|no limen branches deleted/);
	} finally {
		await seat.made.cleanup();
	}
});

test("hosts check prints a claude keychain failure, and prune uses the repo when the worktree is gone", async () => {
	const seat = await remotePlant("darwin", "mbp");
	await writeFile(
		join(seat.made.bin, "claude"),
		"#!/bin/sh\necho 'Error: User interaction is not allowed (os error -25308)'\nexit 1\n",
	);
	await chmod(join(seat.made.bin, "claude"), 0o755);
	const p = await plant.plant();
	try {
		const check = plant.limen(seat.made, ["hosts", "check", "mbp"], { env: seat.env });
		assert.equal(check.status, 1, check.stdout);
		assert.match(check.stdout, /claude fail/);
		assert.match(check.stdout, /-25308/);
		assert.match(check.stdout, /keychain -25308/);
		const origin = join(p.parent, "origin.git");
		plant.git(p.parent, "init", "-q", "--bare", "-b", "main", origin);
		plant.git(p.root, "remote", "add", "origin", origin);
		plant.git(p.root, "push", "-q", "origin", "main");
		plant.git(p.root, "checkout", "-q", "-b", "limen/gone");
		plant.git(p.root, "push", "-q", "origin", "limen/gone");
		plant.git(p.root, "checkout", "-q", "main");
		const job = join(p.root, ".limen/jobs/gone-job");
		await mkdir(job);
		await writeFile(join(job, "state"), "done\n");
		await writeFile(join(job, "branch"), "limen/gone\n");
		await writeFile(join(job, "worktree"), `${join(p.parent, "missing-worktree")}\n`);
		const pruned = plant.limen(p, ["hosts", "prune"]);
		assert.equal(pruned.status, 0, `${pruned.stdout}${pruned.stderr}`);
		assert.match(pruned.stdout, /deleted origin\/limen\/gone/);
		assert.doesNotMatch(`${pruned.stdout}${pruned.stderr}`, /ENOENT/);
		const dry = plant.limen(p, ["hosts", "prune", "--dry-run"]);
		assert.match(dry.stdout, /no limen branches to delete/);
		assert.doesNotMatch(dry.stdout, /limen\/gone/);
	} finally {
		await p.cleanup();
		await seat.made.cleanup();
	}
});
