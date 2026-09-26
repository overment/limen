import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { argvFor, ENGINES, jobProfile, prepareSkillConfig, resolveSpawnEngine } from "../src/engine.ts";

const slots = {
	jobDir: "/job",
	label: "slice",
	preamble: "PREAMBLE",
	extensions: ["/hook/steering.ts", "/hook/communication.ts"],
	taskFile: "/job/task.md",
};

test("new spawns default to omp while explicit engine and environment choices win", (context) => {
	const previous = process.env.LIMEN_ENGINE;
	context.after(() => {
		if (previous === undefined) delete process.env.LIMEN_ENGINE;
		else process.env.LIMEN_ENGINE = previous;
	});
	delete process.env.LIMEN_ENGINE;
	assert.equal(resolveSpawnEngine().id, "omp");
	process.env.LIMEN_ENGINE = "   ";
	assert.equal(resolveSpawnEngine().id, "omp");
	process.env.LIMEN_ENGINE = "pi";
	assert.equal(resolveSpawnEngine().id, "pi");
	assert.equal(resolveSpawnEngine("omp").id, "omp");
	process.env.LIMEN_ENGINE = "omp";
	assert.equal(resolveSpawnEngine("pi").id, "pi");
});

test("old job records without an engine still use pi", async (context) => {
	const jobDir = await mkdtemp(join(tmpdir(), "limen-old-engine-"));
	context.after(() => rm(jobDir, { recursive: true, force: true }));
	assert.equal((await jobProfile(jobDir)).id, "pi");
});

test("detached pi argv keeps approve and name, never auto-approve or no-title", () => {
	const argv = argvFor(ENGINES.pi, { ...slots, jsonMode: true });
	assert.deepEqual(argv.slice(0, 10), [
		"--mode",
		"json",
		"--approve",
		"--no-extensions",
		"--session-dir",
		"/job/session",
		"--name",
		"limen: slice",
		"--append-system-prompt",
		"PREAMBLE",
	]);
	assert.equal(argv.includes("--auto-approve"), false);
	assert.equal(argv.includes("--no-title"), false);
	assert.equal(argv.at(-1), "@/job/task.md");
});

test("detached omp argv uses json, auto-approve, and no-title, never approve or name", () => {
	const argv = argvFor(ENGINES.omp, { ...slots, jsonMode: true });
	assert.equal(argv[argv.indexOf("--mode") + 1], "json");
	assert.equal(argv.includes("--auto-approve"), true);
	assert.equal(argv.includes("--no-title"), true);
	assert.equal(argv.includes("--no-extensions"), true);
	assert.equal(argv.includes("--session-dir"), true);
	assert.equal(argv.includes("--append-system-prompt"), true);
	assert.equal(argv.includes("--extension"), true);
	assert.equal(argv.includes("--approve"), false);
	assert.equal(argv.includes("--name"), false);
	assert.equal(argv.at(-1), "@/job/task.md");
});

test("hosted launches omit json mode and keep the profile flags", () => {
	const pi = argvFor(ENGINES.pi, { ...slots, jsonMode: false, extensions: ["/hook/hosted.ts", ...slots.extensions] });
	const omp = argvFor(ENGINES.omp, { ...slots, jsonMode: false, extensions: ["/hook/hosted.ts", ...slots.extensions] });
	assert.equal(pi.includes("--mode"), false);
	assert.equal(omp.includes("--mode"), false);
	assert.equal(pi.includes("--approve"), true);
	assert.equal(pi.includes("--name"), true);
	assert.equal(omp.includes("--auto-approve"), true);
	assert.equal(omp.includes("--no-title"), true);
	assert.equal(omp.includes("--approve"), false);
	assert.equal(omp.includes("--name"), false);
	assert.equal(pi[pi.indexOf("--extension") + 1], "/hook/hosted.ts");
});

test("OMP launch view exposes legacy skills without shadowing native or changing Pi", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "limen-skills-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const project = join(root, "project");
	const job = join(root, "job");
	const fake = join(root, "omp");
	const previous = process.env.LIMEN_OMP;
	context.after(() => {
		if (previous === undefined) delete process.env.LIMEN_OMP;
		else process.env.LIMEN_OMP = previous;
	});
	await writeFile(fake, '#!/usr/bin/env node\nconsole.log(JSON.stringify({ value: ["/tmp/retained-skills"] }));\n');
	await chmod(fake, 0o755);
	process.env.LIMEN_OMP = fake;
	await mkdir(join(project, ".pi/skills/folder"), { recursive: true });
	await mkdir(join(project, ".agents/skills/native"), { recursive: true });
	await mkdir(join(project, ".omp/skills/omp-native"), { recursive: true });
	await mkdir(job);
	await writeFile(join(project, ".pi/skills/flat.md"), "# Flat\n");
	await writeFile(join(project, ".pi/skills/native.md"), "# Legacy duplicate\n");
	await writeFile(join(project, ".pi/skills/omp-native.md"), "# Legacy OMP duplicate\n");
	await writeFile(join(project, ".pi/skills/folder/SKILL.md"), "# Folder\n");
	await writeFile(join(project, ".pi/skills/folder/guide.md"), "# Guide\n");
	await writeFile(join(project, ".agents/skills/native/SKILL.md"), "# Native\n");
	await writeFile(join(project, ".omp/skills/omp-native/SKILL.md"), "# OMP native\n");
	await symlink(join(project, ".pi/skills/flat.md"), join(project, ".pi/skills/linked.md"));
	const config = await prepareSkillConfig(project, job);
	assert.equal(config, join(job, "skills-config.yml"));
	assert.deepEqual(await readdir(join(job, "skills")), ["flat", "folder", "linked"]);
	assert.equal(await readFile(join(job, "skills/flat/SKILL.md"), "utf8"), "# Flat\n");
	assert.equal(await readFile(join(job, "skills/folder/guide.md"), "utf8"), "# Guide\n");
	assert.match(await readFile(config!, "utf8"), /customDirectories:\n    - "\/tmp\/retained-skills"\n/);
	const omp = argvFor(ENGINES.omp, { ...slots, jobDir: job, skillConfig: config, jsonMode: false });
	assert.equal(omp[omp.indexOf("--config") + 1], config);
	assert.equal(argvFor(ENGINES.pi, { ...slots, skillConfig: config, jsonMode: false }).includes("--config"), false);
	await rm(join(project, ".pi/skills/flat.md"));
	await writeFile(join(project, ".pi/skills/new.md"), "# New\n");
	await prepareSkillConfig(project, job);
	assert.deepEqual(await readdir(join(job, "skills")), ["folder", "new"]);
	assert.equal(await readFile(join(project, ".agents/skills/native/SKILL.md"), "utf8"), "# Native\n");
});
