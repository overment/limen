import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { argvFor, ENGINES, jobProfile, resolveSpawnEngine } from "../src/engine.ts";

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
