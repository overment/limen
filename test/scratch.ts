import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const LIMEN = fileURLToPath(new URL("../bin/limen", import.meta.url));

export type Scratch = {
	readonly root: string;
	readonly fakeBin: string;
	cleanup(): Promise<void>;
};

export async function scratchRepo(fakePi = defaultFakePi): Promise<Scratch> {
	const parent = await mkdtemp(join(tmpdir(), "limen-test-"));
	const root = join(parent, "repo");
	const fakeBin = join(parent, "bin");
	await createRepository(root);
	await mkdir(fakeBin);
	await writeFakePi(fakeBin, fakePi);
	return { root, fakeBin, cleanup: () => rm(parent, { recursive: true, force: true }) };
}
export async function scratchWorkspace(fakePi = defaultFakePi): Promise<Scratch & { readonly repositories: Readonly<Record<"api" | "web", string>> }> {
	const parent = await mkdtemp(join(tmpdir(), "limen-workspace-"));
	const root = join(parent, "workspace");
	const fakeBin = join(parent, "bin");
	const repositories = { api: join(root, "api"), web: join(root, "web") };
	await mkdir(root);
	await Promise.all(Object.values(repositories).map(createRepository));
	await mkdir(fakeBin);
	await writeFakePi(fakeBin, fakePi);
	return { root, fakeBin, repositories, cleanup: () => rm(parent, { recursive: true, force: true }) };
}
async function createRepository(root: string): Promise<void> {
	await mkdir(root);
	git(root, "init", "-b", "main");
	git(root, "config", "user.email", "limen@example.test");
	git(root, "config", "user.name", "Limen Test");
	await writeFile(join(root, "README.md"), "scratch\n");
	git(root, "add", ".");
	git(root, "commit", "-m", "initial");
}

export function limen(scratch: Scratch, ...args: readonly string[]): { readonly stdout: string; readonly stderr: string; readonly status: number } {
	return runLimen(scratch, {}, args);
}
export function limenWithSession(scratch: Scratch, session: string, ...args: readonly string[]): { readonly stdout: string; readonly stderr: string; readonly status: number } {
	return runLimen(scratch, { PI_SESSION_ID: session, PI_SESSION_FILE: `/sessions/${session}.jsonl` }, args);
}
export function limenWithEnv(
	scratch: Scratch,
	added: NodeJS.ProcessEnv,
	...args: readonly string[]
): { readonly stdout: string; readonly stderr: string; readonly status: number } {
	return runLimen(scratch, added, args);
}
function runLimen(scratch: Scratch, addedEnvironment: NodeJS.ProcessEnv, args: readonly string[]): { readonly stdout: string; readonly stderr: string; readonly status: number } {
	const environment: NodeJS.ProcessEnv = {
		...process.env,
		PATH: `${scratch.fakeBin}:${process.env.PATH}`,
		LIMEN_PI: "pi",
	};
	for (const name of [
		"LIMEN_INTERNAL_RUN",
		"LIMEN_JOB",
		"LIMEN_JOB_ID",
		"LIMEN_JOB_DIR",
		"LIMEN_WORKTREE",
		"LIMEN_TASK_FILE",
		"LIMEN_PREAMBLE",
		"LIMEN_TIMEOUT_MS",
		"LIMEN_MODEL",
		"LIMEN_LABEL",
		"LIMEN_JOB_LABEL",
		"LIMEN_CONTEXT_ROOT",
		"PI_SESSION_ID",
		"PI_SESSION_FILE",
		"PI_PROVIDER",
		"PI_MODEL",
		"PI_REASONING_LEVEL",
	])
		delete environment[name];
	Object.assign(environment, addedEnvironment);
	const result = spawnSync(process.execPath, [LIMEN, ...args], {
		cwd: scratch.root,
		encoding: "utf8",
		env: environment,
	});
	if (result.error) throw result.error;
	return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status ?? 1 };
}

export async function waitForState(root: string, id: string, expected: string, timeoutMs = 10_000): Promise<void> {
	const path = join(root, ".limen", "jobs", id, "state");
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const state = await readFile(path, "utf8").then(
			(value) => value.trim(),
			() => "",
		);
		if (state === expected) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`job ${id} did not reach ${expected}`);
}

export function git(cwd: string, ...args: readonly string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

export async function writeFakePi(fakeBin: string, source: string): Promise<void> {
	const path = join(fakeBin, "pi");
	await writeFile(path, source);
	await chmod(path, 0o755);
}

export function onlyJobId(stdout: string): string {
	const lines = stdout.trim().split("\n");
	const id = lines.at(-1);
	if (!id) throw new Error(`missing job id in ${JSON.stringify(stdout)}`);
	return id;
}

const defaultFakePi = `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const args = process.argv.slice(2);
const promptIndex = args.findIndex((value) => value.startsWith("@"));
const task = promptIndex >= 0 ? readFileSync(args[promptIndex].slice(1), "utf8") : "";
writeFileSync("pi-args.json", JSON.stringify(args));
writeFileSync("pi-task.txt", task);
writeFileSync("pi-env.json", JSON.stringify({ internal: process.env.LIMEN_INTERNAL_RUN, job: process.env.LIMEN_JOB, id: process.env.LIMEN_JOB_ID, label: process.env.LIMEN_JOB_LABEL, ...(process.env.LIMEN_CONTEXT_ROOT ? { contextRoot: process.env.LIMEN_CONTEXT_ROOT } : {}), herdr: Object.keys(process.env).filter((key) => key.startsWith("HERDR_")), pi: Object.keys(process.env).filter((key) => key.startsWith("PI_SESSION_") || key === "PI_PROVIDER" || key === "PI_MODEL" || key === "PI_REASONING_LEVEL") }));
console.log(JSON.stringify({ type: "agent_start" }));
console.log(JSON.stringify({ type: "tool_execution_start", toolName: "bash", args: { command: "git status" } }));
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "fake pi completed" }] } }));
if (task.includes("make commit")) {
  writeFileSync("candidate.txt", "candidate\\n");
  execFileSync("git", ["add", "."]);
  execFileSync("git", ["commit", "-m", "candidate"]);
}
if (task.includes("fail now")) process.exit(7);
`;
