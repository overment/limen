import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import test from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;

test("architecture stays small, pure, direct, and dependency-free", async () => {
	const packageJson = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as {
		dependencies?: Record<string, string>;
		bin?: Record<string, string>;
	};
	assert.deepEqual(packageJson.dependencies, {});
	assert.deepEqual(packageJson.bin, { limen: "bin/limen" });
	assert.deepEqual(await readdir(join(ROOT, "bin")), ["limen"]);
	const source = await filesBelow(join(ROOT, "src"));
	const sourceLines = (await Promise.all(source.map((path) => readFile(path, "utf8")))).reduce((sum, text) => sum + text.split("\n").length - 1, 0);
	assert.ok(sourceLines <= 3513, `src has ${sourceLines} lines; changed-file sampling and steer fan-out`);
	assert.doesNotMatch(await readFile(join(ROOT, "src/job.ts"), "utf8"), /from ["']node:/);
	assert.deepEqual((await readdir(join(ROOT, "src/commands"))).sort(), [
		"close.ts",
		"continue.ts",
		"diff.ts",
		"init.ts",
		"jobs.ts",
		"linear.ts",
		"open.ts",
		"prune.ts",
		"spawn.ts",
		"steer.ts",
		"stop.ts",
		"sweep.ts",
		"wait.ts",
		"watch.ts",
	]);
	const all = await filesBelow(ROOT);
	assert.equal(
		all.some((path) => /\/(index|types|utils)\.ts$/.test(path)),
		false,
	);
	const names = all.filter((path) => path.endsWith(".ts")).map((path) => basename(path));
	assert.equal(new Set(names).size, names.length, "TypeScript basenames must be unique");
	const main = await readFile(join(ROOT, "src/main.ts"), "utf8");
	assert.match(
		main,
		/satisfies\s+Record<\s*"init" \| "workspace" \| "spawn" \| "continue" \| "diff" \| "steer" \| "stop" \| "wait" \| "jobs" \| "prune" \| "watch" \| "unwatch" \| "open" \| "close" \| "sweep" \| "linear"\s*,?\s*Command\s*>/,
	);
});

test("strict TypeScript and templates preserve the capability-judgment line", async () => {
	const tsconfig = await readFile(join(ROOT, "tsconfig.json"), "utf8");
	for (const option of ["strict", "noUncheckedIndexedAccess", "exactOptionalPropertyTypes", "erasableSyntaxOnly"]) assert.match(tsconfig, new RegExp(`"${option}": true`));
	const sourceAndHook = await Promise.all((await filesBelow(join(ROOT, "src"))).concat(await filesBelow(join(ROOT, "hook"))).map((path) => readFile(path, "utf8")));
	assert.doesNotMatch(sourceAndHook.join("\n"), /contentHash|receipt|watchdog|schema/);
	const worker = await readFile(join(ROOT, "templates/worker.md"), "utf8");
	assert.match(worker, /finish/);
	assert.doesNotMatch(worker.toLowerCase(), /quit pi/);
	assert.doesNotMatch((await Promise.all((await filesBelow(join(ROOT, "src"))).map((path) => readFile(path, "utf8")))).join("\n"), /registerCommand/);
	assert.deepEqual((await readdir(join(ROOT, "templates/.history"))).sort(), [
		"advisor.md",
		"agents.md",
		"communication.md",
		"judge.md",
		"picture.md",
		"quality.md",
		"researcher.md",
		"reviewer.md",
		"worker.md",
	]);
	for (const name of ["advisor.md", "agents.md", "communication.md", "judge.md", "picture.md", "quality.md", "researcher.md", "reviewer.md", "worker.md"]) {
		const text = await readFile(join(ROOT, "templates", name), "utf8");
		const history = await readFile(join(ROOT, "templates/.history", name), "utf8");
		assert.equal(
			history.split("\n")[0]?.split(" ")[0],
			createHash("sha256").update(text, "utf8").digest("hex"),
			`templates/.history/${name} must start with the current template hash`,
		);
	}
	const register = await readFile(join(ROOT, "templates/communication.md"), "utf8");
	assert.ok(
		register.indexOf("### An identifier is an address") < register.indexOf("### Their clock stopped"),
		"the identifier rule leads the Human register",
	);
	const agents = await readFile(join(ROOT, "templates/agents.md"), "utf8");
	for (const phrase of [
		"human-owned",
		"fresh reviewer",
		"limen wait",
		"never poll",
		"short coordinator instruction",
		"limen jobs",
		"merge",
		"genuine ambiguity",
		"never blocks",
		"recovery",
		"last ten landed",
		"month line",
	])
		assert.match(agents.toLowerCase(), new RegExp(phrase));
});

test("shop manual tab titles say the work then the feature", async () => {
	const agents = await readFile(join(ROOT, "templates/agents.md"), "utf8");
	assert.doesNotMatch(agents, /Lead with the feature number/);
	assert.match(agents, /feature number goes last/);
	assert.match(agents, /about forty characters/);
});

test("a conversation tab is a stable stem plus a stage tail, not a label", async () => {
	const agents = await readFile(join(ROOT, "templates/agents.md"), "utf8");
	assert.doesNotMatch(agents, /same taste as `--label`/);
	for (const phrase of [
		"It is not a `--label`",
		"stable stem",
		"One to three words",
		"leave it alone for the life of the conversation",
		"**Tail.** Limen owns it",
		"Never type a tail",
	])
		assert.match(agents, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("shop manual states the picture pass after a shape moves", async () => {
	const agents = (await readFile(join(ROOT, "templates/agents.md"), "utf8")).toLowerCase();
	for (const phrase of [
		"--role picture --detached --model gpt-5.6-sol",
		"shape that moved",
		"one clause in the handoff",
		"spec/picture.md",
		"if that clause will not form",
		"do not spawn",
		"never block the next slice",
	])
		assert.match(agents, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("picture prompt rewrites one living file and forbids invented state", async () => {
	const picture = (await readFile(join(ROOT, "templates/picture.md"), "utf8")).toLowerCase();
	for (const phrase of ["spec/picture.md", "human register", "invent state", "second file", "the board", "feature folders", "git"]) assert.match(picture, new RegExp(phrase));
});

test("shop manual holds review and merge ceilings", async () => {
	const agents = (await readFile(join(ROOT, "templates/agents.md"), "utf8")).toLowerCase();
	for (const phrase of [
		"appetite the owner states",
		"holds for the conversation",
		"second fail",
		"labelled proven",
		"what remains and what it cost",
		"ticket line, not a repair",
		"names the findings file and the commit",
		"no probe list",
		"no verdict word",
		"no hash typed by hand",
		"one check that would prove",
		"on the candidate branch",
		"trailing whitespace",
		"zero changed files",
		"names the file and the first edit",
		"steer is ignored",
		"posted its handoff",
		"ends committed",
		"five minutes",
		"becomes a survey job",
		"only merge target",
		"stays clean",
		"render check",
		"two hundred words",
		"ticket problem",
		"file and the first edit",
		"rides on every later spawn",
		"board's decisions",
		"called `finish` is finished",
	])
		assert.match(agents, new RegExp(phrase));
});

test("shop manual handoff points at the board line", async () => {
	const agents = (await readFile(join(ROOT, "templates/agents.md"), "utf8")).toLowerCase();
	for (const phrase of [
		"board line carries the boundary this job must not cross",
		"handoff points at it",
		"rather than restating it",
		"board edit in the same coherent change",
		"not a new prompt or a steer",
		"steer that names the board line",
		"not a restatement of the rule",
	])
		assert.match(agents, new RegExp(phrase));
});

test("worker stays off the board and inside reading and check budgets", async () => {
	const worker = (await readFile(join(ROOT, "templates/worker.md"), "utf8")).toLowerCase();
	for (const phrase of [
		"never edit the board",
		"ticket status",
		"outcome files",
		"progress lives in the commit and the final message",
		"before the first edit",
		"findings file if any",
		"ten reads without a changed file",
		"reproducing the finding with the named test",
		"discriminating check first",
		"scoped to the diff",
		"full native lane once",
		"repo-wide formatter over untouched files",
		"no two lanes in parallel",
		"install from the lockfile",
		"never a symlink to another checkout",
		"acceptance line most likely to be false",
		"the check that would catch it",
		"a suite that only passes is not evidence",
		"more than the seam the handoff names",
		"write the question to a plain file",
	])
		assert.match(worker, new RegExp(phrase));
	assert.doesNotMatch(worker, /quit pi/);
	assert.doesNotMatch(worker, /as far as this slice earns/);
});

test("proof belongs to the candidate and outlives the worktree", async () => {
	const worker = (await readFile(join(ROOT, "templates/worker.md"), "utf8")).toLowerCase();
	for (const phrase of [
		"clean candidate commit",
		"after committing, not before it",
		"artifacts a reviewer must read",
		"out of the worktree",
		"name that path in the final message",
	])
		assert.match(worker, new RegExp(phrase));
	const agents = (await readFile(join(ROOT, "templates/agents.md"), "utf8")).toLowerCase();
	for (const phrase of ["review handoff carries", "retained-evidence path", "inspects retained evidence", "before deciding to rerun a lane"])
		assert.match(agents, new RegExp(phrase));
	const reviewer = (await readFile(join(ROOT, "templates/reviewer.md"), "utf8")).toLowerCase();
	for (const phrase of ["different commit or a dirty tree", "is unverified", "not a finding against the candidate"]) assert.match(reviewer, new RegExp(phrase));
});

test("shop manual states the quality pass", async () => {
	const agents = (await readFile(join(ROOT, "templates/agents.md"), "utf8")).toLowerCase();
	for (const phrase of ["ten proven landings", "human asks", "--role quality --detached --model gpt-5.6-sol:xhigh", "spec/quality/", "does not rewrite"])
		assert.match(agents, new RegExp(phrase));
});

test("quality prompt judges, forbids rewriting, and names the only outputs", async () => {
	const quality = (await readFile(join(ROOT, "templates/quality.md"), "utf8")).toLowerCase();
	for (const phrase of ["vision", "styleguide", "do not rewrite the tree", "spec/quality/yyyy-mm.md", "drop-candidate", "ticket", "slice", "only outputs"])
		assert.match(quality, new RegExp(phrase));
});

test("shop manual holds the research fan-out ritual", async () => {
	const agents = (await readFile(join(ROOT, "templates/agents.md"), "utf8")).toLowerCase();
	for (const phrase of [
		"never start research unprompted",
		"two researcher jobs on these models",
		"--role researcher --detached --model gpt-5.6-sol:xhigh",
		"--role researcher --detached --model grok-4.6:xhigh",
		"--role judge --detached",
		"report-1.md",
		"judgment.md",
		"spec/research/",
		"ticket, a decision, or a vision paragraph",
		"never merges",
	])
		assert.match(agents, new RegExp(phrase));
});

test("researcher requires a named source and forbids recalled API", async () => {
	const researcher = (await readFile(join(ROOT, "templates/researcher.md"), "utf8")).toLowerCase();
	for (const phrase of ["recalled api is not a source", "names no source", "say so", "stop", "verdict", "tradeoff", "source that proves", "never merge"])
		assert.match(researcher, new RegExp(phrase));
});

test("judge names divergence and forbids averaging", async () => {
	const judge = (await readFile(join(ROOT, "templates/judge.md"), "utf8")).toLowerCase();
	for (const phrase of ["diverged", "do not average", "blending", "ticket", "decision", "vision paragraph", "never merge"]) assert.match(judge, new RegExp(phrase));
});

test("reviewer verdict opens PASS or FAIL and never fails the environment", async () => {
	const reviewer = (await readFile(join(ROOT, "templates/reviewer.md"), "utf8")).toLowerCase();
	for (const phrase of [
		"the first line",
		"one word with the sha",
		"nothing before it",
		"pass carries notes",
		"acceptance bullet",
		"plausible is never blocking",
		"unverified is never blocking",
		"install from the lockfile",
		"bounded by the findings file",
		"outside the diff",
		"one full proof",
		"transient failure is reported as transient",
	])
		assert.match(reviewer, new RegExp(phrase));
	assert.doesNotMatch(reviewer, /installing is not reviewing/);
	assert.doesNotMatch(reviewer, /only when no substantive finding remains/);
});

test("pulse law is one function", async () => {
	const job = await readFile(join(ROOT, "src/job.ts"), "utf8");
	const wake = await readFile(join(ROOT, "hook/wake.ts"), "utf8");
	const jobs = await readFile(join(ROOT, "src/commands/jobs.ts"), "utf8");
	assert.match(wake, /import \{[^}]*derivePulse[^}]*\} from ["']\.\.\/src\/job\.ts["']/);
	assert.match(jobs, /derivePulse\(/);
	assert.doesNotMatch(jobs, /agentStatus === ["']working["']/);
	assert.match(job, /Number\.isSafeInteger\(pid\) && pid > 0/);
	assert.match(job, /readonly pid\?: number/);
	assert.doesNotMatch(job, /from ["']node:/);
	assert.match(wake, /claims\|delivered\|unconfirmed\|seat/, "seat ring bookkeeping must not churn coordinator watchers");
});

test("job-file table is written by spawn and read by jobs", async () => {
	const spawn = await readFile(join(ROOT, "src/commands/spawn.ts"), "utf8");
	const cont = await readFile(join(ROOT, "src/commands/continue.ts"), "utf8");
	const jobs = await readFile(join(ROOT, "src/commands/jobs.ts"), "utf8");
	for (const name of ["task.md", "label", "branch", "repo", "started-at", "tool-calls", "last-tool", "activity", "log", "state", "versions"]) {
		assert.ok(spawn.includes(name), `spawn must write ${name}`);
		assert.ok(cont.includes(name), `continue must write ${name}`);
		assert.ok(jobs.includes(name), `jobs must read ${name}`);
	}
	for (const name of ["pid", "finished-at", "commits", "result", "stop-reason", "parent"]) assert.ok(jobs.includes(name), `jobs must read ${name}`);
	assert.ok(spawn.includes("candidate"), "spawn must write candidate for review jobs");
	assert.ok(jobs.includes("candidate"), "jobs must print the candidate line");
	assert.ok(cont.includes("parent"), "continue must write parent");
	assert.ok(cont.includes("hosted"), "continue must write hosted");
	for (const name of ["base", "worktree"]) assert.ok(spawn.includes(name), `spawn must write ${name}`);
	for (const name of ["origin-session", "origin-tab", "notify/subscribers", "notify/ready"]) {
		assert.ok(spawn.includes(name), `spawn must write ${name}`);
		assert.ok(cont.includes(name), `continue must write ${name}`);
	}
	const watch = await readFile(join(ROOT, "src/commands/watch.ts"), "utf8");
	for (const name of ["PI_SESSION_ID", "notify/subscribers", "notify/ready"]) assert.ok(watch.includes(name), `watch must use ${name}`);
});

test("advisor names a tradeoff, writes nothing, and never merges", async () => {
	const advisor = (await readFile(join(ROOT, "templates/advisor.md"), "utf8")).toLowerCase();
	for (const phrase of ["perspective", "tradeoff", "no code, no commit", "never merge", "never edit the board", "filing is coordinator work", "detached", "guess"])
		assert.match(advisor, new RegExp(phrase));
});
test("shop manual states the second opinion and where it is filed", async () => {
	const agents = (await readFile(join(ROOT, "templates/agents.md"), "utf8")).toLowerCase();
	for (const phrase of ["--role advisor --engine claude --detached", "no interactive tab", "takes no steer", "advice-<n>.md", "never writes code", "that is what review is for"])
		assert.match(agents, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

async function filesBelow(path: string): Promise<string[]> {
	const entries = await readdir(path, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		if (entry.name === "node_modules" || entry.name === ".git") continue;
		const child = join(path, entry.name);
		if (entry.isDirectory()) files.push(...(await filesBelow(child)));
		else files.push(child);
	}
	return files;
}
