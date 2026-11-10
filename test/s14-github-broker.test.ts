// The seat token client is limen-git-token. These tests never start the broker server and never call sudo.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	githubTokenLines,
	mintHostToken,
	missingTokenLine,
	parseGithubBroker,
	resolveBrokerCommand,
} from "../src/runtime/github-broker.ts";
import { parseHostPool } from "../src/runtime/hosts.ts";

const token = "ghs_testtokenvalue";

async function client(dir: string, name: string, body: string): Promise<string> {
	const path = join(dir, name);
	await writeFile(path, body, { mode: 0o755 });
	await chmod(path, 0o755);
	return path;
}

test("hosts.json names the token client, and direct false is refused", () => {
	const parsed = parseHostPool(
		{
			githubBroker: { command: "/Users/agent/.local/bin/limen-git-token", direct: true, note: "seat" },
			hosts: [{ alias: "mbp", ssh: "h", platform: "linux", root: "/a", hook: "/h", maxConcurrent: 1 }],
		},
		"hosts.json",
	);
	assert.equal(parsed.githubBroker?.command, "/Users/agent/.local/bin/limen-git-token");
	assert.equal(parsed.githubBroker?.direct, true);
	assert.deepEqual(parsed.ignored, ["githubBroker.note"]);
	assert.throws(
		() => parseGithubBroker({ command: "/bin/limen-git-token", direct: false }, "hosts.json", []),
		/does not start the broker server/,
	);
});

test("env wins over hosts.json, hosts.json wins over ~/.local/bin, and sudo is never used", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "broker-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const seen = join(root, "seen");
	const fromEnv = await client(
		root,
		"from-env",
		`#!/bin/sh\nprintf '%s\\n' "$1" > ${JSON.stringify(seen)}\nprintf '%s\\n' ${JSON.stringify(token)}\n`,
	);
	const fromFile = await client(root, "from-file", "#!/bin/sh\nprintf '%s\\n' 'from-file'\n");
	const previous = process.env.LIMEN_GITHUB_BROKER;
	t.after(() => {
		if (previous === undefined) {
			delete process.env.LIMEN_GITHUB_BROKER;
		} else {
			process.env.LIMEN_GITHUB_BROKER = previous;
		}
	});
	process.env.LIMEN_GITHUB_BROKER = fromEnv;
	const envMint = await mintHostToken("HorizonFlex/limen-sandbox", { command: fromFile, direct: true });
	assert.equal(envMint.minted?.token, token);
	assert.equal(await (await import("node:fs/promises")).readFile(seen, "utf8"), "HorizonFlex/limen-sandbox\n");

	delete process.env.LIMEN_GITHUB_BROKER;
	const fileMint = await mintHostToken("HorizonFlex/limen-sandbox", { command: fromFile, direct: true });
	assert.equal(fileMint.minted?.token, "from-file");

	const home = join(root, "home");
	await mkdir(join(home, ".local/bin"), { recursive: true });
	const detected = await client(
		join(home, ".local/bin"),
		"limen-git-token",
		"#!/bin/sh\nprintf '%s\\n' 'username=x-access-token' 'password=ghs_fromhelper'\n",
	);
	assert.equal(detected, join(home, ".local/bin/limen-git-token"));
	const homeBefore = process.env.HOME;
	process.env.HOME = home;
	t.after(() => {
		if (homeBefore === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = homeBefore;
		}
	});
	assert.equal(await resolveBrokerCommand(), detected);
	const helper = await mintHostToken("HorizonFlex/jira-ops");
	assert.equal(helper.minted?.token, "ghs_fromhelper");
	const lines = await githubTokenLines(["https://github.com/HorizonFlex/jira-ops.git", "/tmp/not-github"]);
	assert.deepEqual(lines, ["github token ok HorizonFlex/jira-ops"]);
	assert.equal(lines.join("\n").includes("ghs_fromhelper"), false);
	assert.match(missingTokenLine("HorizonFlex/limen-sandbox", "no broker"), /limen-git-token is not configured/);
	assert.equal(missingTokenLine("HorizonFlex/limen-sandbox", `exit ${token}`).includes(token), false);
});

test("a JSON client can name the bot without the token appearing in the report", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "broker-json-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const command = await client(
		root,
		"limen-git-token",
		`#!/bin/sh\nprintf '%s\\n' '{"token":"${token}","name":"limen-macmini[bot]","email":"bot@users.noreply.github.com"}'\n`,
	);
	const previous = process.env.LIMEN_GITHUB_BROKER;
	process.env.LIMEN_GITHUB_BROKER = command;
	t.after(() => {
		if (previous === undefined) {
			delete process.env.LIMEN_GITHUB_BROKER;
		} else {
			process.env.LIMEN_GITHUB_BROKER = previous;
		}
	});
	const minted = await mintHostToken("HorizonFlex/agent-pipeline");
	assert.equal(minted.minted?.name, "limen-macmini[bot]");
	assert.equal(minted.minted?.token, token);
	const lines = await githubTokenLines(["git@github.com:HorizonFlex/agent-pipeline.git"]);
	assert.deepEqual(lines, ["github token ok HorizonFlex/agent-pipeline"]);
	assert.equal(lines.join("\n").includes(token), false);
});
