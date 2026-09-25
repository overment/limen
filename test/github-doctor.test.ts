import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { githubDoctor } from "../src/commands/github-doctor.ts";
import { git, scratchRepo } from "./scratch.ts";

test("unprovisioned seat reports every missing prerequisite without printing credential bytes", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	const seat = await mkdtemp(join(tmpdir(), "limen-doctor-"));
	context.after(() => rm(seat, { recursive: true, force: true }));
	const key = join(seat, "private.pem");
	const secret = "SECRET_APP_KEY_DO_NOT_PRINT";
	await writeFile(key, secret, { mode: 0o600 });
	const unsafeNode = join(seat, "worker-node");
	const unsafeHerdr = join(seat, "worker-herdr");
	await writeFile(unsafeNode, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	await writeFile(unsafeHerdr, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	const messages: string[] = [];
	const original = console.log;
	console.log = (message: string) => messages.push(message);
	try {
		await assert.rejects(
			githubDoctor(scratch.root, {
				release: join(seat, "missing-release"),
				key,
				state: join(seat, "missing-state"),
				registry: join(seat, "missing-registry"),
				timer: "limen-github-test-missing.timer",
				poller: "limen-github-test-missing",
				node: unsafeNode,
				herdr: unsafeHerdr,
				cli: join(seat, "missing-cli"),
				alternateNode: unsafeNode,
			}),
			/prerequisites need repair/,
		);
	} finally {
		console.log = original;
	}
	const text = messages.join("\n");
	for (const expected of [
		"App PEM poller-only",
		"enabled active GitHub timer",
		"registry ACL",
		"worker in limen-github group",
		"coordinator binding",
		"live registered Herdr agent",
		"root-owned Node 24 interpreter",
		"root-owned Herdr handoff binary",
		"root-owned Limen CLI available on PATH",
		"alternate Node path is not worker-controlled",
		"safe poller service command",
	]) {
		assert.match(text, new RegExp(expected));
	}
	assert.match(text, /ln -sfnT .*\/bin\/limen .*\/missing-cli/);
	assert.doesNotMatch(text, new RegExp(secret));
	assert.equal(await readFile(key, "utf8"), secret);
});

test("multiple registered projects each diagnose their own binding and warm idle agent", async (context) => {
	const first = await scratchRepo();
	const second = await scratchRepo();
	context.after(first.cleanup);
	context.after(second.cleanup);
	const seat = await mkdtemp(join(tmpdir(), "limen-doctor-many-"));
	context.after(() => rm(seat, { recursive: true, force: true }));
	const bin = join(seat, "bin");
	await mkdir(bin);
	const herdr = join(bin, "herdr");
	await writeFile(herdr, '#!/bin/sh\necho \'{"id":"cli:agent:get","result":{"agent":{"pane_id":"w1K:p2","agent_status":"done","interactive_ready":true}}}\'\n');
	await chmod(herdr, 0o755);
	const oldHerdr = process.env.LIMEN_HERDR;
	process.env.LIMEN_HERDR = herdr;
	context.after(() => {
		if (oldHerdr === undefined) delete process.env.LIMEN_HERDR;
		else process.env.LIMEN_HERDR = oldHerdr;
	});
	for (const project of [first, second]) {
		git(project.root, "remote", "add", "origin", "https://github.com/iceener/alice.git");
		await mkdir(join(project.root, ".limen/github"), { recursive: true });
		await writeFile(
			join(project.root, ".limen/github/binding.json"),
			JSON.stringify({ repo: "iceener/alice", coordinator: "w1K:p2", user: "wrong-user", connectedAt: new Date().toISOString() }),
		);
	}
	const registry = join(seat, "projects");
	const inactive = join(seat, "old-project");
	await writeFile(registry, `${first.root}\n${second.root}\n${inactive}\n`);
	const messages: string[] = [];
	const original = console.log;
	console.log = (message: string) => messages.push(message);
	try {
		await assert.rejects(
			githubDoctor(first.root, {
				release: join(seat, "missing-release"),
				key: join(seat, "missing-key"),
				state: join(seat, "missing-state"),
				registry,
				timer: "limen-github-test-missing.timer",
				poller: "limen-github-test-missing",
				node: join(seat, "missing-node"),
				herdr: join(seat, "missing-herdr"),
			}),
			/need repair/,
		);
	} finally {
		console.log = original;
	}
	for (const project of [first, second]) assert.ok(messages.includes(`OK project ${project.root} live registered Herdr agent`));
	assert.equal(messages.filter((line) => line.includes("live registered Herdr agent")).length, 2);
	assert.ok(messages.includes(`SKIP project ${inactive} has no GitHub binding`));
	assert.ok(!messages.some((line) => line.startsWith(`FIX project ${inactive}`)));
	await writeFile(herdr, '#!/bin/sh\necho \'{"id":"cli:agent:get","result":{"agent":{"pane_id":"w1K:p2","agent_status":"done","interactive_ready":false}}}\'\n');
	messages.length = 0;
	console.log = (message: string) => messages.push(message);
	try {
		await assert.rejects(
			githubDoctor(first.root, {
				release: join(seat, "missing-release"),
				key: join(seat, "missing-key"),
				state: join(seat, "missing-state"),
				registry,
				timer: "limen-github-test-missing.timer",
				poller: "limen-github-test-missing",
				node: join(seat, "missing-node"),
				herdr: join(seat, "missing-herdr"),
			}),
			/need repair/,
		);
	} finally {
		console.log = original;
	}
	assert.match(messages.join("\n"), new RegExp(`FIX project ${first.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} live registered Herdr agent`));
});
