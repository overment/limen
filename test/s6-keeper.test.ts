// S6 · Spec keeper. Ticket numbers in one plant and in a series of two, place ids, the keeper's start rules and
// ticket-author paths, all through the real CLI. The strict ticket gate is s5's land refusal and u1's diagnostics.
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";
import { git, jobDir, jobFile, limen, plant, release, repository, spawnJob, start, TICKET, waitJob } from "./plant.ts";

const p = await plant();
after(p.cleanup);
const ROUTE = ["--engine", "omp", "--provider", "p", "--model", "m", "--thinking", "high"];
const ARCHIVE =
	"path\tnumber\ttitle\tclose_month\nspec/features/done/2026-09/F012-c\tF012\tc\t2026-09\nhigh-water\tF012\n";
const lane = (name: string) =>
	existsSync(join(p.root, "spec/features", name)) ? readdirSync(join(p.root, "spec/features", name)) : [];

// The F009 job stays running until the keeper refusal below has been seen.
await mkdir(join(p.root, "spec/features/done/2026-09/F004-x"), { recursive: true });
git(p.root, "branch", "limen/f007-y");
const worker = spawnJob(p, "block\ncommit", ["--label", "F009 keeper proof"]);

test("ticket new refuses an unknown place id before any file exists, then takes the number past folders, limen branches and job labels", () => {
	const before = lane("planned");
	const refused = limen(p, ["ticket", "new", "y", "--touches", "nope"]);
	assert.match(`${refused.status} ${refused.stderr}`, /^1 .*nope/s);
	assert.deepEqual(lane("planned"), before);
	const made = limen(p, ["ticket", "new", "x", "--touches", "demo.place"]);
	assert.equal(made.stdout, "spec/features/planned/F010-x/ticket.md\n", made.stderr);
	assert.ok(existsSync(join(p.root, made.stdout.trim())));
});

test("picture build --dir takes a plant root from any folder and stops on a folder with no map", () => {
	const built = limen(p, ["picture", "build", "--strict", "--dir", p.root], { cwd: p.parent });
	assert.match(`${built.status} ${built.stdout}`, /^0 picture: [1-9]\d* places/, built.stderr);
	const { status, stderr } = limen(p, ["picture", "build", "--dir", p.bin]);
	assert.match(`${status} ${stderr}`, /^1 \S+\/bin has no plant file .+ no map yet in \S+\/bin\/\.limen\/picture\./);
});

test("keeper refuses a running job, then starts on a new branch at the candidate tip", async () => {
	const refused = limen(p, ["keeper", TICKET, "--job", worker, ...ROUTE]);
	assert.equal(refused.status, 1);
	assert.match(refused.stderr, new RegExp(worker));
	assert.deepEqual([git(p.root, "branch", "--list", "limen/keeper-*"), jobFile(p, worker, "state")], ["", "running"]);

	await release(jobDir(p, worker));
	assert.equal(waitJob(p, worker), "done");
	const branch = jobFile(p, worker, "branch");
	const tip = git(p.root, "rev-parse", branch);
	assert.notEqual(tip, git(p.root, "rev-parse", "main"));
	// The worker's task named the planned lane; the keeper follows the one F001 folder at the tip.
	const started = limen(p, ["keeper", "spec/features/planned/F001-demo/ticket.md", "--job", worker, ...ROUTE]);
	const keeper = started.stdout.trim().split("\n").at(-1) ?? "";
	const keeperBranch = `limen/keeper-f001-${tip.slice(0, 7)}`;
	assert.deepEqual([jobFile(p, keeper, "branch"), jobFile(p, keeper, "base")], [keeperBranch, tip]);
	assert.ok(jobFile(p, keeper, "task.md").split("\n").includes(`Ticket: ${TICKET}`));
	assert.deepEqual([git(p.root, "rev-parse", branch), waitJob(p, keeper)], [tip, "done"]);
	const again = limen(p, ["keeper", TICKET, "--job", worker, ...ROUTE]);
	assert.equal(again.status, 1);
	assert.match(again.stderr, new RegExp(keeperBranch));
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
		assert.ok(found.stdout.includes(commit), `${found.stdout}${found.stderr}`);
	}
	for (const path of ["spec/features/planned/F010-x/ticket.md", "missing.md", "spec", "../outside.md"]) {
		const result = limen(p, ["ticket-author", path]);
		assert.equal(result.status, 1, path);
		assert.equal(result.stdout, "", path);
	}
});

test("cancelled and archived numbers stay taken, a series never gives a number twice, and readers follow", async () => {
	await mkdir(join(p.root, "spec/features/cancelled/F011-c"), { recursive: true });
	assert.match(limen(p, ["ticket", "new", "c"]).stdout, /F012-c/);
	// Branch dup takes F010 and F012 out of main's lanes; F012 goes to the archive register, still taken and closed.
	git(p.root, "checkout", "-qb", "dup");
	git(p.root, "add", "spec/features/planned");
	git(p.root, "commit", "-qm", "dup");
	git(p.root, "checkout", "-q", "main");
	await writeFile(join(p.root, "spec/features/archive.tsv"), ARCHIVE);
	assert.match(limen(p, ["ticket", "new", "a"]).stdout, /F013-a/);
	assert.match(limen(p, ["close", "F012"]).stderr, /herdr is not available/);
	assert.match(limen(p, ["board"]).stdout, /`F012-c` \(🟢 PROVEN\): c\n- 2026-09: 1 landed\. \S+archive\.tsv\n/);
	const q = join(p.parent, "api");
	await repository(q);
	await mkdir(join(q, "spec/features/done/2026-09/F010-q"), { recursive: true });
	assert.equal(limen(p, ["ticket", "series", "pair", p.root, q]).status, 0);
	const made = await Promise.all([p.root, q, p.root, q].map((cwd) => start(p, ["ticket", "new", "z"], { cwd }).done));
	assert.deepEqual(made.map((run) => /F\d+/.exec(run.stdout)?.[0]).sort(), ["F014", "F015", "F016", "F017"]);
	assert.match(
		limen(p, ["ticket", "series"]).stdout,
		/^series pair\nplant .*\/repo\nplant .*\/api\nmark F017\nnext F018\n$/,
	);
	const check = limen(p, ["ticket", "check", "dup"]);
	assert.match(`${check.status} ${check.stderr}`, /^1 .*F010-x.*\/api\/\S+\/F010-q.*\n.*F012-c.*archive\.tsv:2/s);
});
