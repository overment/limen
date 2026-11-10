// The seat account and host log lines. The token is a file the rotator already keeps; these checks never print it.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { cleanToken, resolveSeatAccount } from "../src/runtime/claude-account.ts";
import { oauthInstallScript, prefixHostChunk, sshArgv } from "../src/runtime/host-shell.ts";

const TOKEN = "sk-ant-oat01-test-token-value";
const previous = process.env.LIMEN_CLAUDE_ACCOUNTS;
after(() => {
	if (previous === undefined) {
		delete process.env.LIMEN_CLAUDE_ACCOUNTS;
	} else {
		process.env.LIMEN_CLAUDE_ACCOUNTS = previous;
	}
});

test("a seat account is the flat active token, and a directory token is only a fallback", async () => {
	const root = await mkdtemp(join(tmpdir(), "limen-accounts-"));
	await writeFile(join(root, "active"), "acc4\n");
	await writeFile(join(root, "acc4.token"), `${TOKEN}\n`);
	await mkdir(join(root, "acc4"));
	await writeFile(join(root, "acc4", "token"), "sk-ant-oat01-directory-token-not-used\n");
	process.env.LIMEN_CLAUDE_ACCOUNTS = root;
	assert.equal(resolveSeatAccount()?.token, TOKEN);
	await mkdir(join(root, "acc5"));
	await writeFile(join(root, "active"), "acc5\n");
	await writeFile(join(root, "acc5", "token"), `${TOKEN}\n`);
	assert.equal(resolveSeatAccount()?.name, "acc5");
	assert.equal(cleanToken("not a token"), undefined);
});

test("host stderr is prefixed per line and the oauth script stays off the ssh command", () => {
	const first = prefixHostChunk("mbp", "", "fetch origin\nwork");
	assert.equal(first.text, "[mbp] fetch origin\n");
	assert.equal(first.pending, "work");
	const second = prefixHostChunk("mbp", first.pending, "tree\n");
	assert.equal(second.text, "[mbp] worktree\n");
	const script = oauthInstallScript("job-1", TOKEN);
	const command = sshArgv("ssh", { ssh: "ada@mbp", platform: "darwin", distro: "Ubuntu" }).join(" ");
	assert.equal(script.includes(TOKEN), true);
	assert.equal(command.includes(TOKEN), false);
});
