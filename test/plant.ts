// The shared throwaway plant every scenario runs on: a temp Git repo after a real `limen init`, an environment built
// from an allowlist, the scripted fake engine (test/fake-engine.mjs) as `pi` and `omp`, and a fetch sink that records
// every request a Limen process makes. Scenarios wait on `limen wait`, file events and FIFOs; nothing here sleeps.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, watch } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const LIMEN = fileURLToPath(new URL("../bin/limen", import.meta.url));
const FAKE_ENGINE = fileURLToPath(new URL("./fake-engine.mjs", import.meta.url));

export type Plant = {
	readonly parent: string;
	readonly root: string;
	readonly bin: string;
	readonly env: Readonly<Record<string, string>>;
	cleanup(): Promise<void>;
};
export type Run = { readonly stdout: string; readonly stderr: string; readonly status: number };
export type RunOptions = {
	readonly cwd?: string;
	readonly env?: Readonly<Record<string, string>>;
	readonly input?: string;
};

export const TICKET = "spec/features/active/F001-demo/ticket.md";
const ticket = `---
touches:
  - demo.place
opened: 2026-10-06
---

# F001 · The demo plant has one ticket

## Outcome

A throwaway plant for one test file.

## Scope

- Everything.

## Out of scope

- Nothing.

## Acceptance

- The scenario passes.
`;
const node = (kind: string, id: string, parent: string) => `---
schema: architecture-map/1
kind: ${kind}
id: ${id}
project: demo
title: ${id}
status: ready
parent: ${parent}
sources:
  - README.md
---
`;

/** A fresh plant. `root` is the real path: macOS tmpdir is a /var symlink and Git reports /private/var. */
export async function plant(): Promise<Plant> {
	const parent = await realpath(await mkdtemp(join(tmpdir(), "limen-plant-")));
	const root = join(parent, "repo");
	const bin = join(parent, "bin");
	await Promise.all([mkdir(bin), mkdir(join(parent, "home"))]);
	await Promise.all(["pi", "omp"].map((name) => symlink(FAKE_ENGINE, join(bin, name))));
	await writeFile(join(parent, "sink.mjs"), sinkSource(parent));
	const env = {
		PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
		HOME: join(parent, "home"),
		TMPDIR: tmpdir(),
		LIMEN_HOME: parent,
		LIMEN_HERDR: "0",
		LIMEN_HUNK: "0",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		NODE_NO_WARNINGS: "1",
		NODE_OPTIONS: `--import=${join(parent, "sink.mjs")}`,
	};
	const made: Plant = {
		parent,
		root,
		bin,
		env,
		cleanup: async () => {
			// Engines carry the plant path in argv; ending them lets their wrappers finish before the files go.
			spawnSync("pkill", ["-f", parent]);
			await rm(parent, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
		},
	};
	await repository(root);
	const init = limen(made, ["init"]);
	if (init.status !== 0) {
		throw new Error(`limen init failed: ${init.stderr}`);
	}
	await mkdir(join(root, dirname(TICKET)), { recursive: true });
	await mkdir(join(root, ".limen/picture/nodes"), { recursive: true });
	await writeFile(join(root, TICKET), ticket);
	await writeFile(join(root, ".limen/picture/nodes/demo.md"), node("plant", "demo", "null"));
	await writeFile(join(root, ".limen/picture/nodes/demo.place.md"), node("module", "demo.place", "demo"));
	git(root, "add", "-A");
	git(root, "commit", "-q", "-m", "limen init");
	return made;
}

/** A Git repo with one commit, configured for commits under GIT_CONFIG_GLOBAL=/dev/null. */
export async function repository(root: string): Promise<void> {
	await mkdir(root, { recursive: true });
	git(root, "init", "-q", "-b", "main");
	git(root, "config", "user.email", "limen@example.test");
	git(root, "config", "user.name", "Limen Test");
	await writeFile(join(root, "README.md"), "plant\n");
	git(root, "add", ".");
	git(root, "commit", "-q", "-m", "initial");
}

/** Runs the real CLI in the plant with the allowlisted environment plus `options.env`. */
export function limen(plant: Plant, args: readonly string[], options: RunOptions = {}): Run {
	const result = spawnSync(process.execPath, [LIMEN, ...args], {
		cwd: options.cwd ?? plant.root,
		encoding: "utf8",
		env: { ...plant.env, ...options.env },
		...(options.input !== undefined ? { input: options.input } : {}),
	});
	if (result.error) {
		throw result.error;
	}
	return { stdout: result.stdout, stderr: result.stderr, status: result.status ?? 1 };
}

/** `limen spawn [flags] <task>`; returns the job id or throws with the CLI output. */
export function spawnJob(plant: Plant, task: string, flags: readonly string[] = [], options: RunOptions = {}): string {
	const run = limen(plant, ["spawn", ...flags, task], options);
	const id = run.stdout.trim().split("\n").at(-1);
	if (run.status !== 0 || !id) {
		throw new Error(`spawn failed (${run.status}): ${run.stdout}${run.stderr}`);
	}
	return id;
}

/** Blocks on `limen wait <id>` and returns the terminal state. */
export function waitJob(plant: Plant, id: string, options: RunOptions = {}): string {
	const run = limen(plant, ["wait", id], options);
	if (run.status !== 0) {
		throw new Error(`wait failed: ${run.stderr}`);
	}
	return run.stdout.split(" ")[0]?.toLowerCase() ?? "";
}

export function jobDir(plant: Plant, id: string): string {
	return join(plant.root, ".limen", "jobs", id);
}

/** A job file's text, trimmed; "" when it does not exist. */
export function jobFile(plant: Plant, id: string, name: string): string {
	const path = join(jobDir(plant, id), name);
	return existsSync(path) ? readFileSync(path, "utf8").trim() : "";
}

/**
 * Resolves once `check()` holds, re-checked on every file event below `dir`; bounded only by the test timeout.
 * macOS starts a directory watch asynchronously, so a file made just after `watch()` can raise no event; the
 * one-second re-check closes that gap, as `limen wait` does. Nothing here waits for time to pass.
 */
export function until(dir: string, check: () => boolean): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	const settle = () => {
		if (!check()) {
			return;
		}
		watcher.close();
		clearInterval(fallback);
		resolve();
	};
	const watcher = watch(dir, { recursive: true }, settle);
	const fallback = setInterval(settle, 1_000);
	settle();
	return promise;
}

/** Waits until the fake engine reaches its `n`th `block` in `dir`, then releases it. */
export async function release(dir: string, n = 1): Promise<void> {
	await until(dir, () => existsSync(join(dir, `fake-blocked-${n}`)));
	await writeFile(join(dir, "fake-gate"), "go\n");
}

/** What the fake engine received through the extension API: steers, follow-ups, messages, notices, its exit. */
export function engineEvents(
	dir: string,
): Array<{ readonly event: string; readonly text?: string; readonly code?: number }> {
	const path = join(dir, "fake-events.jsonl");
	return existsSync(path) ? JSON.parse(`[${readFileSync(path, "utf8").trim().split("\n").join(",")}]`) : [];
}

/** Every fetch any Limen process in this plant made; `respond` rows answer the first request whose URL contains `match`. */
export function requests(plant: Plant): Array<{
	readonly url: string;
	readonly method: string;
	readonly headers: Record<string, string>;
	readonly body: string;
}> {
	const path = join(plant.parent, "fetch.jsonl");
	return existsSync(path) ? JSON.parse(`[${readFileSync(path, "utf8").trim().split("\n").join(",")}]`) : [];
}
export async function respond(
	plant: Plant,
	rows: ReadonlyArray<{ readonly match: string; readonly status?: number; readonly body: unknown }>,
): Promise<void> {
	await writeFile(join(plant.parent, "fetch-responses.json"), JSON.stringify(rows));
}

export function git(cwd: string, ...args: readonly string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
	}).trim();
}

function sinkSource(parent: string): string {
	return `import { appendFileSync, existsSync, readFileSync } from "node:fs";
globalThis.fetch = async (input, init = {}) => {
	const url = String(input instanceof Request ? input.url : input);
	const body = typeof init.body === "string" ? init.body : init.body ? String(init.body) : "";
	appendFileSync(${JSON.stringify(join(parent, "fetch.jsonl"))}, JSON.stringify({ url, method: init.method ?? "GET", headers: Object.fromEntries(new Headers(init.headers)), body }) + "\\n");
	const file = ${JSON.stringify(join(parent, "fetch-responses.json"))};
	const row = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).find((candidate) => url.includes(candidate.match)) : undefined;
	return new Response(JSON.stringify(row?.body ?? {}), { status: row?.status ?? 200, headers: { "content-type": "application/json" } });
};
`;
}
