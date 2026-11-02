// U15: the doorbell's seat facts read the same on Linux and macOS: group ids, the poller's access rights and the
// launchd poller job. Each parser takes the tool's text output, so both platforms are checked on either one.
import assert from "node:assert/strict";
import test from "node:test";
import {
	type Access,
	darwinAclAllows,
	launchdDisabled,
	launchdPollerOk,
	linuxAclAllows,
	parseGroupId,
} from "../src/integrations/seat-os.ts";

test("a group id comes from getent on Linux and from Directory Services on macOS, and is never zero or missing", () => {
	assert.equal(parseGroupId("limen-github:x:998:worker", "linux"), 998);
	assert.equal(parseGroupId("PrimaryGroupID: 701\n", "darwin"), 701);
	assert.equal(parseGroupId("GroupMembership: worker\nPrimaryGroupID: 702", "darwin"), 702);
	assert.equal(parseGroupId("wheel:x:0:", "linux"), undefined);
	assert.equal(parseGroupId("PrimaryGroupID: 0", "darwin"), undefined);
	assert.equal(parseGroupId("No such key: PrimaryGroupID", "darwin"), undefined);
	assert.equal(parseGroupId("broken", "linux"), undefined);
});

const dir = (fields: Partial<Access>): Access => ({
	permission: "x",
	poller: "poller",
	pollerUid: 600,
	gid: 700,
	owner: 0,
	group: 0,
	mode: 0o750,
	directory: true,
	...fields,
});

test("macOS: a named allow or deny entry decides first, in order; without one the POSIX class decides", () => {
	const head = "drwxr-x---+ 3 root  wheel  96  1 Nov 10:00 /seat/project\n";
	const allow = `${head} 0: user:poller allow list,search\n`;
	assert.equal(darwinAclAllows(allow, dir({})), true);
	assert.equal(darwinAclAllows(allow, dir({ permission: "r" })), true);
	assert.equal(darwinAclAllows(`${head} 0: user:poller inherited allow search\n`, dir({})), true);
	const deny = `${head} 0: user:poller deny search\n 1: user:poller allow list,search\n`;
	assert.equal(darwinAclAllows(deny, dir({ mode: 0o755 })), false);
	assert.equal(darwinAclAllows(`${head} 0: user:pollerx allow search\n`, dir({})), false, "another user's entry");
	assert.equal(darwinAclAllows(head, dir({ mode: 0o751 })), true, "other may traverse");
	assert.equal(darwinAclAllows(head, dir({ group: 700, mode: 0o750 })), true, "the poller's group may traverse");
	assert.equal(darwinAclAllows(head, dir({ owner: 600, mode: 0o700 })), true, "the poller owns it");
	assert.equal(darwinAclAllows(head, dir({ mode: 0o750 })), false);
	const file = "-rw-r-----+ 1 worker  limen  10  1 Nov 10:00 binding.json\n 0: user:poller allow read\n";
	assert.equal(darwinAclAllows(file, dir({ permission: "r", directory: false, mode: 0o640 })), true);
	assert.equal(darwinAclAllows(file, dir({ permission: "x", directory: false, mode: 0o640 })), false);
});

test("Linux: the named entry under the mask, else the owner, group or other class from getfacl", () => {
	const listing = "user::rwx\nuser:poller:--x\ngroup::r-x\nmask::r-x\nother::---";
	assert.equal(linuxAclAllows(listing, dir({})), true);
	assert.equal(linuxAclAllows(listing.replace("mask::r-x", "mask::r--"), dir({})), false);
	assert.equal(linuxAclAllows("user::rwx\ngroup::r-x\nother::---", dir({})), false);
	assert.equal(linuxAclAllows("user::rwx\ngroup::r-x\nother::---", dir({ group: 700 })), true);
});

const plist = (fields: object) =>
	JSON.stringify({
		Label: "dev.limen.github",
		UserName: "limen-github",
		ProgramArguments: ["/usr/local/bin/node", "/opt/limen/bin/limen", "github", "poll"],
		EnvironmentVariables: { PATH: "/usr/bin:/usr/local/bin", LIMEN_GITHUB_APP_ID: "7" },
		StartInterval: 60,
		...fields,
	});
const want = {
	label: "dev.limen.github",
	user: "limen-github",
	node: "/usr/local/bin/node",
	release: "/opt/limen",
};

test("the launchd poller runs the root-owned interpreter on the release as the poller, on a timer, with a safe PATH", () => {
	assert.equal(launchdPollerOk(plist({}), want), true);
	assert.equal(launchdPollerOk(plist({ UserName: "worker" }), want), false);
	assert.equal(launchdPollerOk(plist({ Label: "other" }), want), false);
	assert.equal(launchdPollerOk(plist({ Program: "/bin/sh" }), want), false);
	assert.equal(launchdPollerOk(plist({ StartInterval: undefined }), want), false);
	assert.equal(
		launchdPollerOk(plist({ EnvironmentVariables: { PATH: "/Users/worker/bin:/usr/bin:/usr/local/bin" } }), want),
		false,
	);
	assert.equal(
		launchdPollerOk(
			plist({ ProgramArguments: ["/opt/homebrew/bin/node", "/opt/limen/bin/limen", "github", "poll"] }),
			want,
		),
		false,
	);
	assert.equal(
		launchdPollerOk(plist({ ProgramArguments: [...JSON.parse(plist({})).ProgramArguments, "--extra"] }), want),
		false,
	);
	assert.equal(launchdPollerOk("not json", want), false);
});

test("a launchd label reads as disabled only when the system listing marks that exact label", () => {
	const listing = 'disabled services = {\n\t"dev.limen.github" => disabled\n\t"com.example.x" => enabled\n}';
	assert.equal(launchdDisabled(listing, "dev.limen.github"), true);
	assert.equal(launchdDisabled(listing, "com.example.x"), false);
	assert.equal(launchdDisabled('"dev.limen.github" => true', "dev.limen.github"), true);
	assert.equal(launchdDisabled('"dev.limen.githubx" => disabled', "dev.limen.github"), false);
	assert.equal(launchdDisabled(listing, "dev.limen"), false);
});
