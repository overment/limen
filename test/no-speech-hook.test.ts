import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import limenCommunication from "../hook/communication.ts";

test("communication hook never registers /speak, even with the CLI installed", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "limen-no-speech-"));
	const previousPath = process.env.PATH;
	context.after(async () => {
		if (previousPath === undefined) delete process.env.PATH;
		else process.env.PATH = previousPath;
		await rm(root, { recursive: true, force: true });
	});
	await writeFile(join(root, "speak"), "#!/bin/sh\nexit 1\n");
	await chmod(join(root, "speak"), 0o755);

	for (const path of [root, ""]) {
		process.env.PATH = path;
		const commands: string[] = [];
		const pi = {
			on() {},
			registerCommand(name: string) {
				commands.push(name);
			},
		};
		limenCommunication(pi);
		assert.equal(commands.includes("speak"), false, `registered /speak with PATH=${path}`);
	}
});
