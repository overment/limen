import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatDrift, listDrift, templateHistoryText } from "../hook/inherit.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const HISTORY = ["agents.md", "communication.md", "judge.md", "picture.md", "quality.md", "researcher.md", "reviewer.md", "worker.md"] as const;

test("a git package root classifies leftover, stale, and overlay", async (context) => {
	const packaged = await gitPackage(context);
	const project = await projectRoot(context);
	const reviewer = join(project, ".agents/limen/reviewer.md");
	await withPackage(packaged.root, async () => {
		await writeFile(reviewer, packaged.v2);
		assert.deepEqual(listDrift(project), [{ path: ".agents/limen/reviewer.md", kind: "leftover" }]);
		await writeFile(reviewer, packaged.v1);
		const stale = listDrift(project);
		assert.deepEqual(stale, [{ path: ".agents/limen/reviewer.md", kind: "stale", matchedAt: "2026-01-15", changedAt: "2026-02-01" }]);
		assert.match(formatDrift(stale), /stale \(package text as of 2026-01-15; package changed 2026-02-01\): \.agents\/limen\/reviewer\.md/);
		assert.match(formatDrift(stale), /delete leftovers and stale copies \(inherit the package\)/);
		await writeFile(reviewer, "custom overlay\n");
		assert.deepEqual(listDrift(project), [{ path: ".agents/limen/reviewer.md", kind: "overlay" }]);
	});
});

test("a shipped hash list classifies leftover, stale, and overlay without git", async (context) => {
	const v1 = "reviewer v1\n";
	const v2 = "reviewer v2\n";
	const packaged = await mkdtemp(join(tmpdir(), "limen-pkg-nongit-"));
	context.after(() => rm(packaged, { recursive: true, force: true }));
	await mkdir(join(packaged, "templates/.history"), { recursive: true });
	await writeFile(join(packaged, "templates/reviewer.md"), v2);
	await writeFile(join(packaged, "templates/.history/reviewer.md"), `${digest(v2)} 2026-02-01\n${digest(v1)} 2026-01-15\n`);
	const project = await projectRoot(context);
	const reviewer = join(project, ".agents/limen/reviewer.md");
	await withPackage(packaged, async () => {
		await writeFile(reviewer, v2);
		assert.deepEqual(listDrift(project), [{ path: ".agents/limen/reviewer.md", kind: "leftover" }]);
		await writeFile(reviewer, v1);
		const stale = listDrift(project);
		assert.deepEqual(stale, [{ path: ".agents/limen/reviewer.md", kind: "stale", matchedAt: "2026-01-15", changedAt: "2026-02-01" }]);
		assert.match(formatDrift(stale), /stale \(package text as of 2026-01-15; package changed 2026-02-01\): \.agents\/limen\/reviewer\.md/);
		await writeFile(reviewer, "custom overlay\n");
		assert.deepEqual(listDrift(project), [{ path: ".agents/limen/reviewer.md", kind: "overlay" }]);
	});
});

test("shipped template history matches git log/show of this clone", async () => {
	for (const name of HISTORY) {
		const path = join(ROOT, "templates/.history", name);
		const expected = templateHistoryText(`templates/${name}`);
		if (process.env.LIMEN_WRITE_HISTORY === "1") await writeFile(path, expected);
		assert.equal(await readFile(path, "utf8"), expected, `regenerate ${path}: LIMEN_WRITE_HISTORY=1 node --test test/inherit.test.ts`);
		assert.equal((await readFile(path, "utf8")).split("\n")[0]?.split(" ")[0], digest(await readFile(join(ROOT, "templates", name), "utf8")));
	}
});

async function gitPackage(context: test.TestContext): Promise<{ readonly root: string; readonly v1: string; readonly v2: string }> {
	const root = await mkdtemp(join(tmpdir(), "limen-pkg-git-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	execFileSync("git", ["init", "-b", "main"], { cwd: root });
	execFileSync("git", ["config", "user.email", "limen@example.test"], { cwd: root });
	execFileSync("git", ["config", "user.name", "Limen Test"], { cwd: root });
	await mkdir(join(root, "templates"), { recursive: true });
	const v1 = "reviewer v1\n";
	const v2 = "reviewer v2\n";
	await writeFile(join(root, "templates/reviewer.md"), v1);
	commit(root, "v1", "2026-01-15T00:00:00Z");
	await writeFile(join(root, "templates/reviewer.md"), v2);
	commit(root, "v2", "2026-02-01T00:00:00Z");
	return { root, v1, v2 };
}

async function projectRoot(context: test.TestContext): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "limen-drift-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, ".agents/limen"), { recursive: true });
	return root;
}

async function withPackage(packaged: string, run: () => Promise<void>): Promise<void> {
	const previous = process.env.LIMEN_PACKAGE;
	process.env.LIMEN_PACKAGE = packaged;
	try {
		await run();
	} finally {
		if (previous === undefined) delete process.env.LIMEN_PACKAGE;
		else process.env.LIMEN_PACKAGE = previous;
	}
}

function commit(cwd: string, message: string, date: string): void {
	execFileSync("git", ["add", "templates/reviewer.md"], { cwd });
	execFileSync("git", ["commit", "-m", message], { cwd, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
}

function digest(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}
