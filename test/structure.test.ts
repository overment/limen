import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import test from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;

test("architecture stays small, pure, direct, and dependency-free", async () => {
	const packageJson = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as {
		dependencies?: Record<string, string>;
	};
	assert.deepEqual(packageJson.dependencies, {});
	const source = await filesBelow(join(ROOT, "src"));
	const sourceLines = (await Promise.all(source.map((path) => readFile(path, "utf8")))).reduce(
		(sum, text) => sum + text.split("\n").length - 1,
		0,
	);
	assert.ok(sourceLines <= 1100, `src has ${sourceLines} lines; audit against first principles`);
	assert.doesNotMatch(await readFile(join(ROOT, "src/job.ts"), "utf8"), /from ["']node:/);
	assert.deepEqual((await readdir(join(ROOT, "src/commands"))).sort(), [
		"init.ts",
		"jobs.ts",
		"spawn.ts",
		"stop.ts",
		"wait.ts",
	]);
	const all = await filesBelow(ROOT);
	assert.equal(
		all.some((path) => /\/(index|types|utils)\.ts$/.test(path)),
		false,
	);
	const names = all.filter((path) => path.endsWith(".ts")).map((path) => basename(path));
	assert.equal(new Set(names).size, names.length, "TypeScript basenames must be unique");
	const main = await readFile(join(ROOT, "src/main.ts"), "utf8");
	assert.match(main, /satisfies Record<"init" \| "spawn" \| "stop" \| "wait" \| "jobs"/);
});

test("strict TypeScript and templates preserve the capability-judgment line", async () => {
	const tsconfig = await readFile(join(ROOT, "tsconfig.json"), "utf8");
	for (const option of ["strict", "noUncheckedIndexedAccess", "exactOptionalPropertyTypes", "erasableSyntaxOnly"])
		assert.match(tsconfig, new RegExp(`"${option}": true`));
	const sourceAndHook = await Promise.all(
		(await filesBelow(join(ROOT, "src")))
			.concat(await filesBelow(join(ROOT, "hook")))
			.map((path) => readFile(path, "utf8")),
	);
	assert.doesNotMatch(sourceAndHook.join("\n"), /registerTool|registerCommand|contentHash|receipt|watchdog|schema/);
	const agents = await readFile(join(ROOT, "templates/agents.md"), "utf8");
	for (const phrase of [
		"human-owned",
		"fresh reviewer",
		"control wait",
		"never poll",
		"control jobs",
		"merge",
		"genuine ambiguity",
		"never blocks",
		"recovery",
	])
		assert.match(agents.toLowerCase(), new RegExp(phrase));
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
