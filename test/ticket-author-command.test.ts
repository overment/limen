import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { git, limen, scratchRepo } from "./scratch.ts";

test("ticket authors survive another collaborator's edits and lane moves", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	const first = "spec/features/active/F001-first/ticket.md";
	const second = "spec/features/active/F002-second/ticket.md";
	for (const path of [first, second]) await mkdir(dirname(join(scratch.root, path)), { recursive: true });
	await writeFile(join(scratch.root, first), "# First ticket\n\nAn outcome for the first collaborator.\n");
	git(scratch.root, "add", first);
	git(scratch.root, "commit", "--author", "Alice Filer <1234+alice@users.noreply.github.com>", "-m", "file first ticket");
	const firstCommit = git(scratch.root, "rev-parse", "HEAD");
	assert.equal(git(scratch.root, "show", "-s", "--format=%ce", "HEAD"), "limen@example.test");
	await writeFile(join(scratch.root, second), "# Second ticket\n\nA different outcome.\n");
	git(scratch.root, "add", second);
	git(scratch.root, "commit", "--author", "Bob Filer <bob@example.test>", "-m", "file second ticket");
	const secondCommit = git(scratch.root, "rev-parse", "HEAD");
	const moved = "spec/features/done/F001-first/ticket.md";
	await mkdir(dirname(join(scratch.root, moved)), { recursive: true });
	git(scratch.root, "mv", first, moved);
	git(scratch.root, "commit", "--author", "Bob Filer <bob@example.test>", "-m", "move first ticket");
	await writeFile(join(scratch.root, moved), "# First ticket\n\nAn outcome for the first collaborator.\n\nReviewed by Bob.\n");
	git(scratch.root, "commit", "-am", "edit first ticket", "--author", "Bob Filer <bob@example.test>");
	const before = git(scratch.root, "status", "--porcelain");
	const alice = limen(scratch, "ticket-author", moved);
	assert.equal(alice.status, 0, alice.stderr);
	assert.match(alice.stdout, /Author: Alice Filer <1234\+alice@users\.noreply\.github\.com>/);
	assert.match(alice.stdout, /GitHub: @alice/);
	assert.ok(alice.stdout.includes(`Creation commit: ${firstCommit}`), alice.stdout);
	assert.doesNotMatch(alice.stdout, /Bob Filer|Limen Test/);
	const bob = limen(scratch, "ticket-author", second);
	assert.equal(bob.status, 0, bob.stderr);
	assert.match(bob.stdout, /Author: Bob Filer <bob@example\.test>/);
	assert.ok(bob.stdout.includes(`Creation commit: ${secondCommit}`), bob.stdout);
	assert.doesNotMatch(bob.stdout, /GitHub:/);
	assert.equal(git(scratch.root, "status", "--porcelain"), before);
});

test("copied ticket content belongs to its filer, not the template author", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	const content = "# Ticket\n\nOutcome.\n";
	await writeFile(join(scratch.root, "template.md"), content);
	git(scratch.root, "add", ".");
	git(scratch.root, "commit", "-m", "add template");
	await writeFile(join(scratch.root, "ticket.md"), content);
	git(scratch.root, "add", ".");
	git(scratch.root, "commit", "--author", "Legacy Filer <alice@users.noreply.github.com>", "-m", "file from template");
	const result = limen(scratch, "ticket-author", "ticket.md");
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Author: Legacy Filer <alice@users\.noreply\.github\.com>/);
	assert.match(result.stdout, /GitHub: @alice/);
	assert.ok(result.stdout.includes(`Creation commit: ${git(scratch.root, "rev-parse", "HEAD")}`), result.stdout);
});

test("uncommitted, missing, directory, and outside paths do not invent an author", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	await mkdir(join(scratch.root, "tickets"));
	await writeFile(join(scratch.root, "tickets/new.md"), "not filed\n");
	for (const path of ["tickets/new.md", "missing.md", "tickets", ".", "../other/ticket.md"]) {
		const result = limen(scratch, "ticket-author", path);
		assert.equal(result.status, 1, path);
		assert.match(result.stderr, /ticket author unavailable|ticket path must be a file inside this repository/);
		assert.equal(result.stdout, "");
	}
	git(scratch.root, "add", ".");
	assert.match(limen(scratch, "ticket-author", "tickets/new.md").stderr, /not a committed file at HEAD/);
	git(scratch.root, "commit", "-m", "file ticket");
	assert.match(limen(scratch, "ticket-author", "tickets").stderr, /not a committed file at HEAD/);
	for (const args of [[], ["README.md", "tickets/new.md"]]) {
		const result = limen(scratch, "ticket-author", ...args);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /requires one ticket path/);
	}
});

test("shallow history reports unavailable instead of attributing an edit as creation", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	await writeFile(join(scratch.root, "README.md"), "edited by someone else\n");
	git(scratch.root, "commit", "-am", "edit", "--author", "Editor <editor@example.test>");
	const clone = join(dirname(scratch.root), "shallow");
	git(scratch.root, "clone", "--depth=1", pathToFileURL(scratch.root).href, clone);
	const result = limen({ ...scratch, root: clone }, "ticket-author", "README.md");
	assert.equal(result.status, 1);
	assert.match(result.stderr, /ticket author unavailable: shallow history/);
	assert.equal(result.stdout, "");
});

test("paths are literal and resolve from subdirectories, absolute paths, and worktrees", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	const path = "tickets/[draft] ticket.md";
	await mkdir(join(scratch.root, "tickets"));
	await writeFile(join(scratch.root, path), "filed\n");
	git(scratch.root, "add", ".");
	git(scratch.root, "commit", "--author", "Filer <filer@example.test>", "-m", "file literal path");
	const commit = git(scratch.root, "rev-parse", "HEAD");
	const worktree = join(dirname(scratch.root), "worker");
	git(scratch.root, "worktree", "add", "-b", "worker", worktree);
	for (const [cwd, ticket] of [
		[scratch.root, join(scratch.root, path)],
		[join(scratch.root, "tickets"), "[draft] ticket.md"],
		[worktree, path],
	] as const) {
		const result = limen({ ...scratch, root: cwd }, "ticket-author", ticket);
		assert.equal(result.status, 0, result.stderr);
		assert.ok(result.stdout.includes(`Ticket: ${path}`), result.stdout);
		assert.ok(result.stdout.includes(`Creation commit: ${commit}`), result.stdout);
	}
	await writeFile(join(worktree, "only-worker.md"), "filed on another branch\n");
	git(worktree, "add", ".");
	git(worktree, "commit", "-m", "file on worker branch");
	assert.equal(limen({ ...scratch, root: worktree }, "ticket-author", "only-worker.md").status, 0);
	assert.match(limen(scratch, "ticket-author", "only-worker.md").stderr, /not a committed file at HEAD/);
});

test("a recreated ticket has its own author and local mailmap cannot rewrite the recorded identity", async (context) => {
	const scratch = await scratchRepo();
	context.after(scratch.cleanup);
	git(scratch.root, "rm", "README.md");
	git(scratch.root, "commit", "-m", "remove old ticket");
	await writeFile(join(scratch.root, "README.md"), "a new ticket at the old path\n");
	git(scratch.root, "add", ".");
	git(scratch.root, "commit", "--author", "New Filer <new@example.test>", "-m", "file replacement");
	const commit = git(scratch.root, "rev-parse", "HEAD");
	await writeFile(join(scratch.root, ".mailmap"), "Mapped Name <mapped@example.test> New Filer <new@example.test>\n");
	const before = git(scratch.root, "status", "--porcelain");
	const result = limen(scratch, "ticket-author", "README.md");
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Author: New Filer <new@example\.test>/);
	assert.ok(result.stdout.includes(`Creation commit: ${commit}`), result.stdout);
	assert.doesNotMatch(result.stdout, /Mapped Name|Limen Test|GitHub:/);
	assert.equal(git(scratch.root, "status", "--porcelain"), before);
});
