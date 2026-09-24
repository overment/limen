import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;

async function filesBelow(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const paths = await Promise.all(
		entries
			.filter((entry) => !["node_modules", ".git", ".omp", ".pi"].includes(entry.name))
			.map(async (entry) => {
				const path = join(dir, entry.name);
				return entry.isDirectory() ? filesBelow(path) : [path];
			}),
	);
	return paths.flat();
}

test("runtime remains dependency-free and TypeScript basenames stay unambiguous", async () => {
	const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
	assert.deepEqual(pkg.dependencies, {});
	const names = (await filesBelow(root)).filter((path) => path.endsWith(".ts")).map((path) => basename(path));
	assert.equal(new Set(names).size, names.length, "TypeScript basenames must be unique");
});
