// S4 · Steering and context injection. A running worker gets each steer once, in order, and an ended one refuses a
// late steer; every prompt carries the project's guidance once, also after a second `limen init` over old hook copies
// (236b8e7); `limen continue` resumes the old session with the parent's extensions or a replacement.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	engineEvents,
	git,
	jobDir,
	jobFile,
	limen,
	type Plant,
	plant,
	release,
	spawnJob,
	until,
	waitJob,
} from "./plant.ts";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const FLAGS = ["--engine", "pi", "--detached"];
// One marker per guidance source; the checks never read product wording.
const STYLE = "style-marker-s4";
const REGISTER = "register-marker-s4";
const VISION = "vision-marker-s4";
const BOARD = "board-body-marker-s4";

let p: Plant;
let parent = "";
let first = "";
let second = "";
before(async () => {
	p = await plant();
	const files: Record<string, string> = {
		".agents/limen/styleguide.md": `# Styleguide\n\n${STYLE}\n`,
		".agents/limen/communication.md": `# Communication\n\n${REGISTER}\n`,
		"spec/vision.md": `# Vision\n\n${VISION}\n`,
		"spec/build.md": `# Build\n\n## NOW\n\n- ${BOARD}\n`,
		// Copies an old `limen init` planted next to the stub; vanilla Pi loads every .ts in these folders.
		".pi/extensions/limen-communication.ts": `export { default } from ${JSON.stringify(join(PACKAGE, "hook/communication.ts"))};\n`,
		".omp/extensions/limen-steering.ts": `export { default } from ${JSON.stringify(join(PACKAGE, "hook/steering.ts"))};\n`,
	};
	for (const [path, text] of Object.entries(files)) {
		writeFileSync(join(p.root, path), text);
	}
	git(p.root, "add", "-A");
	git(p.root, "commit", "-q", "-m", "project guidance and old hook copies");
	first = join(p.parent, "first.ts");
	second = join(p.parent, "second.ts");
	for (const path of [first, second]) {
		writeFileSync(path, "export default () => {};\n");
	}
});
after(() => p.cleanup());

const count = (text: string, marker: string) => text.split(marker).length - 1;
const steers = (dir: string) => engineEvents(dir).flatMap((entry) => (entry.event === "steer" ? [entry.text] : []));
const argv = (id: string): string[] => JSON.parse(jobFile(p, id, "fake-argv.json"));
const extensions = (id: string) =>
	argv(id).flatMap((value, index, all) => (value === "--extension" ? [all[index + 1] ?? ""] : []));

test("a second init removes old hook copies, so a coordinator gets each guidance source once", async () => {
	const init = limen(p, ["init"]);
	assert.equal(init.status, 0, init.stderr);
	// A coordinator Pi in the project loads every .ts in .pi/extensions; the stub then loads the package hooks.
	const coord = join(p.parent, "coord");
	mkdirSync(coord);
	writeFileSync(join(coord, "task.md"), "say hi\n");
	const loaded = readdirSync(join(p.root, ".pi/extensions")).flatMap((name) => [
		"--extension",
		join(p.root, ".pi/extensions", name),
	]);
	const child = spawn(
		join(p.bin, "pi"),
		["--session-dir", join(coord, "session"), ...loaded, `@${join(coord, "task.md")}`],
		{
			cwd: p.root,
			env: { ...p.env, LIMEN_PACKAGE: PACKAGE },
			stdio: "ignore",
		},
	);
	const { promise, resolve } = Promise.withResolvers<number | null>();
	child.once("exit", resolve);
	assert.equal(await promise, 0);
	const system = readFileSync(join(coord, "fake-system.txt"), "utf8");
	assert.equal(count(system, STYLE), 1, "styleguide");
	assert.equal(count(system, REGISTER), 1, "register");
	assert.equal(count(system, VISION), 1, "vision");
	assert.equal(count(system, BOARD), 1, "board");
	assert.deepEqual(readdirSync(join(p.root, ".pi/extensions")), ["limen.ts"]);
	assert.deepEqual(readdirSync(join(p.root, ".omp/extensions")), ["limen.ts"]);
});

test("a running worker gets each steer once and in order; an ended one refuses a late steer and writes nothing", async () => {
	parent = spawnJob(p, "block", [...FLAGS, "--extension", first]);
	const dir = jobDir(p, parent);
	await until(dir, () => existsSync(join(dir, "fake-blocked-1")));
	for (const [index, text] of ["one", "two"].entries()) {
		const steered = limen(p, ["steer", parent, text]);
		assert.equal(steered.status, 0, steered.stderr);
		// The hook has taken the file: a delivery (right or wrong) arrived, or the inbox emptied without one.
		await until(dir, () => steers(dir).length > index || readdirSync(join(dir, "steer/inbox")).length === 0);
	}
	await release(dir);
	assert.equal(waitJob(p, parent), "done");
	// The engine has exited, so every delivery it will ever get is recorded.
	assert.deepEqual(steers(dir), ["one", "two"]);
	const before = readdirSync(join(dir, "steer"), { recursive: true }).sort();
	const late = limen(p, ["steer", parent, "late"]);
	assert.equal(late.status, 1);
	assert.deepEqual(readdirSync(join(dir, "steer"), { recursive: true }).sort(), before);
	assert.equal(jobFile(p, parent, "state"), "done");
});

test("a worker prompt carries register and styleguide once, vision and board pointers, and no board body", () => {
	const system = jobFile(p, parent, "fake-system.txt");
	const context = jobFile(p, parent, "fake-context.txt");
	assert.equal(count(system, STYLE), 1, "styleguide");
	assert.equal(count(system, REGISTER), 1, "register");
	assert.ok(context.includes("`spec/vision.md`"), "vision pointer");
	assert.ok(context.includes("`spec/build.md`"), "board pointer");
	assert.equal(count(system + context, VISION), 0, "a worker reads the vision itself");
	assert.equal(count(system + context, BOARD), 0, "a worker never gets the board body");
	assert.equal(count(argv(parent).join(" "), "hook/steering.ts"), 1);
	assert.equal(count(argv(parent).join(" "), "hook/communication.ts"), 1);
});

test("continue resumes the parent's session, linked, with its extensions or a replacement", () => {
	const parentRecord = jobFile(p, parent, "extensions.json");
	const transcript = readFileSync(join(jobDir(p, parent), "session/fake.jsonl"), "utf8");
	const continued = (flags: readonly string[]) => {
		const run = limen(p, ["continue", parent, "say next", "--detached", ...flags]);
		assert.equal(run.status, 0, run.stderr);
		const id = run.stdout.trim().split("\n").at(-1) ?? "";
		assert.equal(waitJob(p, id), "done");
		return id;
	};
	const inherited = continued([]);
	assert.equal(jobFile(p, inherited, "parent"), parent);
	assert.equal(argv(inherited).at(-1), "say next");
	assert.equal(argv(inherited).at(-2), "--continue");
	assert.ok(!argv(inherited).some((value) => value.startsWith("@")));
	const resumed = readFileSync(join(jobDir(p, inherited), "session/fake.jsonl"), "utf8");
	assert.ok(
		resumed.startsWith(transcript) && resumed.length > transcript.length,
		"the child's transcript extends the parent's",
	);
	assert.deepEqual(extensions(inherited).slice(-1), [first]);
	const replaced = continued(["--extension", second]);
	assert.deepEqual(extensions(replaced).slice(-1), [second]);
	assert.equal(extensions(replaced).includes(first), false);
	assert.equal(jobFile(p, parent, "extensions.json"), parentRecord);
});
