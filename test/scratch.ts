import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const CONTROL = fileURLToPath(new URL("../bin/control", import.meta.url));

export type Scratch = {
	readonly root: string;
	readonly fakeBin: string;
	cleanup(): Promise<void>;
};

export async function scratchRepo(fakePi = defaultFakePi): Promise<Scratch> {
	const parent = await mkdtemp(join(tmpdir(), "control-test-"));
	const root = join(parent, "repo");
	const fakeBin = join(parent, "bin");
	await mkdir(root);
	await mkdir(fakeBin);
	git(root, "init", "-b", "main");
	git(root, "config", "user.email", "control@example.test");
	git(root, "config", "user.name", "Control Test");
	await writeFile(join(root, "README.md"), "scratch\n");
	git(root, "add", ".");
	git(root, "commit", "-m", "initial");
	await writeFakePi(fakeBin, fakePi);
	return {
		root,
		fakeBin,
		cleanup: () => rm(parent, { recursive: true, force: true }),
	};
}

export function control(
	scratch: Scratch,
	...args: readonly string[]
): { readonly stdout: string; readonly stderr: string; readonly status: number } {
	const environment: NodeJS.ProcessEnv = {
		...process.env,
		PATH: `${scratch.fakeBin}:${process.env.PATH}`,
		CONTROL_PI: "pi",
	};
	for (const name of [
		"CONTROL_INTERNAL_RUN",
		"CONTROL_JOB",
		"CONTROL_JOB_ID",
		"CONTROL_JOB_DIR",
		"CONTROL_WORKTREE",
		"CONTROL_TASK_FILE",
		"CONTROL_PREAMBLE",
		"CONTROL_TIMEOUT_MS",
		"CONTROL_MODEL",
	])
		delete environment[name];
	const result = spawnSync(process.execPath, [CONTROL, ...args], {
		cwd: scratch.root,
		encoding: "utf8",
		env: environment,
	});
	if (result.error) throw result.error;
	return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status ?? 1 };
}

export async function waitForState(root: string, id: string, expected: string, timeoutMs = 10_000): Promise<void> {
	const path = join(root, ".control", "jobs", id, "state");
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
writeFileSync("pi-env.json", JSON.stringify({ internal: process.env.CONTROL_INTERNAL_RUN, job: process.env.CONTROL_JOB, id: process.env.CONTROL_JOB_ID }));
console.log("fake pi completed");
if (task.includes("make commit")) {
  writeFileSync("candidate.txt", "candidate\\n");
  execFileSync("git", ["add", "."]);
  execFileSync("git", ["commit", "-m", "candidate"]);
}
if (task.includes("fail now")) process.exit(7);
`;
