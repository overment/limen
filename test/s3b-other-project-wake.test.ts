// S3b · a coordinator hears its jobs in every registered project. A coordinator watches the jobs directory of the
// project it was started in; a job it spawns in another registered project (`cd <repo> && limen spawn`) must wake it
// too, exactly once, and a job of another session in that project must not wake it. The coordinator is the fake engine
// running the real hook/wake.ts under PI_SESSION_ID. Absence is proved by order: the other session's job ends before
// the coordinator's own job, and every sweep reads the whole other project, so once the second wake is delivered the
// first job has been read too.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { engineEvents, git, limen, type Plant, plant, release, repository, spawnJob, until } from "./plant.ts";

const WAKE_HOOK = fileURLToPath(new URL("../hook/wake.ts", import.meta.url));
const ROUTE = ["--engine", "pi", "--provider", "p", "--model", "m", "--thinking", "high", "--detached"];
let p: Plant;
let other = "";
let coord = "";
const sessions: ChildProcess[] = [];

/** A coordinator session in the plant's own repository: the fake engine with the real wake hook. */
function coordinator(name: string, session: string, script: string, env: Record<string, string> = {}): string {
	const dir = join(p.parent, name);
	mkdirSync(dir);
	writeFileSync(join(dir, "task.md"), script);
	const args = ["--session-dir", join(dir, "session"), "--extension", WAKE_HOOK, `@${join(dir, "task.md")}`];
	sessions.push(
		spawn(join(p.bin, "pi"), args, { cwd: p.root, env: { ...p.env, ...env, PI_SESSION_ID: session }, stdio: "ignore" }),
	);
	return dir;
}
/** A detached job in the other project, spawned from `session` (and the coordinator tab in `env`, if any). */
const otherJob = (script: string, label: string, session: string, env: Record<string, string> = {}) =>
	spawnJob(p, script, [...ROUTE, "--label", label], { cwd: other, env: { ...env, PI_SESSION_ID: session } });
const otherJobDir = (id: string) => join(other, ".limen", "jobs", id);
const wakes = (dir: string, id: string) =>
	engineEvents(dir).filter((event) => event.text?.startsWith("Limen job") && event.text.includes(id));

before(async () => {
	p = await plant();
	// A second project on the same seat: `limen init` registers it next to the plant's own repository.
	other = join(p.parent, "other");
	await repository(other);
	const init = limen(p, ["init"], { cwd: other });
	assert.equal(init.status, 0, init.stderr);
	git(other, "add", "-A");
	git(other, "commit", "-q", "-m", "limen init");
	coord = coordinator("coord", "coord", "block\n");
});
after(async () => {
	for (const session of sessions) {
		session.kill();
	}
	await p.cleanup();
});

test("a job a coordinator spawns in another registered project wakes it once; another session's job there does not", async () => {
	const foreign = otherJob("fail 3", "someone else's", "elsewhere");
	await until(join(other, ".limen", "jobs"), () => existsSync(join(otherJobDir(foreign), "finished-at")));
	const own = otherJob("fail 4", "spawned elsewhere", "coord");
	await until(join(other, ".limen", "jobs"), () => existsSync(join(otherJobDir(own), "notify", "delivered", "coord")));
	assert.equal(wakes(coord, own).length, 1, "the coordinator heard its job in the other project once");
	assert.equal(wakes(coord, foreign).length, 0, "another session's job in that project did not wake it");
});

test("a coordinator started again in the same tab hears the job its earlier session left running in another project", async () => {
	const tab = { HERDR_TAB_ID: "tab-7" };
	const left = otherJob("block", "left running", "before", tab);
	await until(otherJobDir(left), () => existsSync(join(otherJobDir(left), "pid")));
	const again = coordinator("again", "again", "block\n", tab);
	await until(otherJobDir(left), () => existsSync(join(otherJobDir(left), "notify", "subscribers", "again")));
	await release(otherJobDir(left));
	await until(otherJobDir(left), () => existsSync(join(otherJobDir(left), "notify", "delivered", "again")));
	assert.equal(wakes(again, left).length, 1, "the new session heard the job its tab left running once");
});
