import assert from "node:assert/strict";
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
	assert.ok(sourceLines <= 3000, `src has ${sourceLines} lines; audit against first principles`);
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
	assert.doesNotMatch(sourceAndHook.join("\n"), /registerTool|contentHash|receipt|watchdog|schema/);
	assert.doesNotMatch((await Promise.all((await filesBelow(join(ROOT, "src"))).map((path) => readFile(path, "utf8")))).join("\n"), /registerCommand/);
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
	])
		assert.match(agents.toLowerCase(), new RegExp(phrase));
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
