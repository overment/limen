// S6 · Spec keeper. One plant: ticket numbers, place ids, the ticket check, the keeper's start rules, picture bytes and
// ticket-author path resolution, all through the real CLI.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";
import { git, jobDir, jobFile, limen, plant, release, spawnJob, TICKET, waitJob } from "./plant.ts";

const p = await plant();
after(p.cleanup);
const ROUTE = ["--engine", "omp", "--provider", "p", "--model", "m", "--thinking", "high"];
const lane = (name: string) =>
	existsSync(join(p.root, "spec/features", name)) ? readdirSync(join(p.root, "spec/features", name)) : [];

// The F009 job stays running until the keeper refusal below has been seen.
await mkdir(join(p.root, "spec/features/done/2026-09/F004-x"), { recursive: true });
git(p.root, "branch", "limen/f007-y");
const worker = spawnJob(p, "block\ncommit", ["--label", "F009 keeper proof"]);

test("ticket new takes the next number past folders, limen branches and job labels", () => {
	const made = limen(p, ["ticket", "new", "x", "--touches", "demo.place"]);
	assert.equal(made.status, 0, made.stderr);
	assert.equal(made.stdout.trim(), "spec/features/planned/F010-x/ticket.md");
	assert.ok(existsSync(join(p.root, made.stdout.trim())));
});

test("ticket new refuses an unknown place id before any file exists", () => {
	const before = lane("planned");
	const refused = limen(p, ["ticket", "new", "y", "--touches", "nope"]);
	assert.equal(refused.status, 1);
	assert.match(refused.stderr, /nope/);
	assert.deepEqual(lane("planned"), before);
});

test("ticket check names the file, the line and a fix for each fault", async () => {
	const tree = join(p.parent, "check");
	git(p.root, "worktree", "add", "-q", "-b", "check", tree);
	const path = "spec/features/active/F020-bad/ticket.md";
	await mkdir(join(tree, "spec/features/active/F020-bad"), { recursive: true });
	await writeFile(
		join(tree, path),
		"---\ntouches:\n  - demo.place\nopened: 2026-13-45\ncolour: red\n---\n\n# F020 · Bad\n\n## Outcome\n\nBad.\n",
	);
	git(tree, "add", ".");
	git(tree, "commit", "-q", "-m", "bad ticket");
	const check = limen(p, ["ticket", "check", "check"]);
	assert.equal(check.status, 1);
	const errors = check.stderr.split("\n").filter((line) => line.startsWith("error "));
	const faults = errors.map((line) => /^error (\S+):(\d+): (.+); fix: (.+)$/.exec(line)?.slice(1, 3) ?? line);
	assert.deepEqual(faults.sort(), [
		[path, "4"],
		[path, "5"],
	]);
	assert.ok(
		check.stderr
			.split("\n")
			.includes(
				`fix: limen keeper ${path} --job <id> --engine <engine> --provider <provider> --model <model> --thinking <level>`,
			),
	);
});

test("keeper refuses a running job, then starts on a new branch at the candidate tip", async () => {
	const refused = limen(p, ["keeper", TICKET, "--job", worker, ...ROUTE]);
	assert.equal(refused.status, 1);
	assert.match(refused.stderr, new RegExp(worker));
	assert.equal(git(p.root, "branch", "--list", "limen/keeper-*"), "");
	assert.equal(jobFile(p, worker, "state"), "running");

	await release(jobDir(p, worker));
	assert.equal(waitJob(p, worker), "done");
	const branch = jobFile(p, worker, "branch");
	const tip = git(p.root, "rev-parse", branch);
	assert.notEqual(tip, git(p.root, "rev-parse", "main"));
	// The worker's task named the planned lane; the keeper follows the one F001 folder at the tip.
	const started = limen(p, ["keeper", "spec/features/planned/F001-demo/ticket.md", "--job", worker, ...ROUTE]);
	assert.equal(started.status, 0, started.stderr);
	const keeper = started.stdout.trim().split("\n").at(-1) ?? "";
	const keeperBranch = `limen/keeper-f001-${tip.slice(0, 7)}`;
	assert.equal(jobFile(p, keeper, "branch"), keeperBranch);
	assert.equal(jobFile(p, keeper, "base"), tip);
	assert.equal(jobFile(p, keeper, "role"), "keeper");
	assert.ok(jobFile(p, keeper, "task.md").split("\n").includes(`Ticket: ${TICKET}`));
	assert.equal(git(p.root, "rev-parse", branch), tip);
	assert.equal(waitJob(p, keeper), "done");
	const again = limen(p, ["keeper", TICKET, "--job", worker, ...ROUTE]);
	assert.equal(again.status, 1);
	assert.match(again.stderr, new RegExp(keeperBranch));
});

test("two strict picture builds give identical bytes", () => {
	const dir = join(p.root, ".limen/picture");
	const build = () => {
		const run = limen(p, [
			"picture",
			"build",
			"--dir",
			dir,
			"--out",
			join(p.parent, "map.html"),
			"--json",
			join(p.parent, "map.json"),
			"--strict",
		]);
		assert.equal(run.status, 0, run.stderr);
		return [readFileSync(join(p.parent, "map.html")), readFileSync(join(p.parent, "map.json"))];
	};
	assert.deepEqual(build(), build());
});

test("ticket-author resolves aliased paths and invents no author for others", async () => {
	const alias = join(p.parent, "alias");
	await symlink(p.root, alias, "dir");
	const commit = git(p.root, "log", "--format=%H", "--diff-filter=A", "--", TICKET);
	for (const [cwd, path] of [
		[p.root, join(alias, TICKET)],
		[join(alias, "spec/features/active"), "F001-demo/ticket.md"],
	] as const) {
		const found = limen(p, ["ticket-author", path], { cwd });
		assert.equal(found.status, 0, found.stderr);
		assert.ok(found.stdout.includes(commit), found.stdout);
	}
	for (const path of ["spec/features/planned/F010-x/ticket.md", "missing.md", "spec", "../outside.md"]) {
		const result = limen(p, ["ticket-author", path]);
		assert.equal(result.status, 1, path);
		assert.equal(result.stdout, "", path);
	}
});
