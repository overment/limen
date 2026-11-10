// U14: the task note shows at a job's first prompt, keeps its first version, logs each change, and is checked once.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import limenCommunication from "../hook/communication.ts";
import limenFinish from "../hook/finish.ts";
import { noteCheckOpen, noteSteer } from "../src/job/task-note.ts";

type Result = { message?: { content: string }; entries?: { content: string }[]; content: { text: string }[] };
type Hook = (...args: unknown[]) => Result | undefined;
function load(hook: (pi: never) => void) {
	const handlers = new Map<string, Hook>();
	hook({
		on: handlers.set.bind(handlers),
		registerTool: (tool: { execute: Hook }) => handlers.set("finish", tool.execute),
	} as never);
	const end = async (handoff: string) => (await handlers.get("finish")?.("t", { handoff }, 0, 0, {}))?.content[0]?.text;
	return { call: (name: string, ...args: unknown[]) => handlers.get(name)?.(...args), end, handlers };
}

test("a job's note shows once, keeps its first version, logs changes, and is checked once before the finish", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "u14-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const job = join(root, ".limen/jobs/j1");
	const reminders = join(root, ".agents/limen/reminders.md");
	await Promise.all([join(job, "session"), join(root, ".agents/limen")].map((dir) => mkdir(dir, { recursive: true })));
	await Promise.all([writeFile(join(job, "log"), ""), writeFile(reminders, " \n")]);
	Object.assign(process.env, { LIMEN_JOB: "1", LIMEN_CONTEXT_ROOT: root, LIMEN_JOB_ID: "j1", LIMEN_HOSTED: "0" });
	const hook = load(limenCommunication);
	const prompt = (pi = hook) => pi.call("before_agent_start", {}, { cwd: root })?.message?.content ?? "";
	const first = prompt();
	assert.ok(first.includes(`${job}/note.md, or write it if there is none.\nWrite a plan`) && !/🔴|🟡|⚪/.test(first));
	assert.match(first, /\n- Done means: .*\n- Easy to miss: .*\n- Not proven yet: .*\nRead an existing note [^\n]*$/s);
	assert.ok(!prompt().includes(`${job}/note.md`), "the second prompt");
	for (const text of ["- a.", "- a.", "- a.\nChanged: b. Reason: c."]) {
		await writeFile(join(job, "note.md"), text);
		hook.call("tool_result", { toolName: "bash", content: [] }, { cwd: root });
	}
	assert.equal(await readFile(join(job, "note.first.md"), "utf8"), "- a.");
	assert.equal((await readFile(join(job, "log"), "utf8")).split("] note changed\n").length, 3);
	await writeFile(reminders, "- R.\n");
	const follow = "Follow each binding reminder. Do not copy them into the note.";
	assert.ok(prompt(load(limenCommunication)).endsWith(`(${reminders}):\n- R.\n${follow}`));
	assert.match(noteSteer(job), /old line and append "Changed: .*Seen pointers\. .*\nIf a reminder changes, .*file\.$/);
	// Detached: a run that ends without finish gets the check as one more turn, once; finish then ends the job.
	const detached = load(limenFinish);
	const ask = detached.call("agent_before_settle", { outcome: "completed", entries: [] })?.entries?.[0]?.content ?? "";
	assert.match(ask, /^\[limen\] Your note now:\n- a\.\nChanged: b\. Reason: c\.\nYour note at the start:\n- a\.\n/);
	assert.match(ask, /\nProject reminders:\n- R\.\nCompare the note .*\nReport each binding .*completion\.$/s);
	assert.equal(detached.call("agent_before_settle", { outcome: "completed", entries: [] }), undefined);
	assert.equal(await detached.end("handoff"), "done");
	// Hosted: the first finish answers with the check and ends nothing; a missing note is rebuilt from the task.
	process.env.LIMEN_HOSTED = "1";
	await Promise.all([rm(join(job, "note.md")), rm(reminders)]);
	const hosted = load(limenFinish);
	assert.equal(hosted.handlers.has("agent_before_settle") || hosted.handlers.has("session_stop"), false);
	const rebuild = (await hosted.end("early")) ?? "";
	assert.ok(rebuild.startsWith(`[limen] No note exists in ${job}/note.md. Read ${job}/task.md and reconstruct`));
	assert.match(rebuild, /^\[limen\] No note .*\nCompare .*\nGive .*\nDo not repeat .*\nThen call finish again\. .*$/);
	assert.deepEqual([await readFile(join(job, "result"), "utf8"), await hosted.end("final")], ["handoff\n", "done"]);
	assert.equal((await readFile(join(job, "log"), "utf8")).split("] note check sent\n").length, 3);
	// A sent check left unanswered is open. A proven command counts only from a bash call that a real shell ended with
	// exit 0, joined by `&&` alone, with no pipe after it. The `npm` stub records each run it really made.
	assert.deepEqual(noteCheckOpen(job), ["Note check: missing from the final message"]);
	await writeFile(join(root, "npm"), '#!/bin/sh\necho "$*" >> "$0.ran"\n', { mode: 0o755 });
	const cases = Object.entries({
		"cd . && CI=1 npm test 0 -- x": "",
		"printf '%s\\n' 'npm test 1'": "no shell call names it as a command",
		"false && npm test 2": "its shell call did not end with exit 0",
		"false && npm test 3; true": "its shell call holds `;`",
		"if true; then exit 0; fi; npm test 4": "its shell call holds `if`",
		"true && 'exit' 0 && npm test 5": "its shell call holds `'exit'`",
		"! PATH=/x npm test 6": "its shell call holds `!`",
		"PATH=/x npm test 7 | cat": "a `|` follows it and hides its exit status",
		"npm test 8": "no shell call names it as a command", // a tool that is not a shell records it
		"npm test 9": "its shell call did not end with exit 0", // the only result answers another call
	});
	const records = cases.flatMap(([command], id) => {
		const name = id === 8 ? "eval" : "bash";
		const exit = id < 8 ? spawnSync("bash", ["-c", command], { cwd: root, env: { PATH: `${root}:/bin` } }).status : 0;
		const call = { content: [{ type: "toolCall", id: `${id}`, name, arguments: { command } }] };
		return [call, { role: "toolResult", toolCallId: id === 9 ? "x" : `${id}`, toolName: name, isError: exit !== 0 }];
	});
	await writeFile(join(job, "session/a.jsonl"), records.map((message) => JSON.stringify({ message })).join("\n"));
	const open = (result: string) => writeFile(join(job, "result"), result).then(() => noteCheckOpen(job));
	const named = cases.map((_, id) => `- C${id}: proven. \`npm test ${id}\`\n`).join("");
	const proven = "- **A: proven.** `npm test 0`\n- B: proven `log:2`\n- C: proven\n  `note.first.md`\n- R: followed";
	const gap = (id: number, why: string) => `C${id}: not proven. Limen: no proof that \`npm test ${id}\` ran (${why})`;
	const gaps = cases.flatMap(([, why], id) => (why ? [`${gap(id, why)}, and no such file`] : []));
	const result = `## Note check\n${named}- E: proven, trust me\n${proven}\n# Next\n- D: not proven`;
	assert.deepEqual(await open(result), [...gaps, "E: not proven. Limen: it names no command or file in backticks"]);
	assert.equal(await readFile(join(root, "npm.ran"), "utf8"), "test 0 -- x\n");
	assert.deepEqual(await open("**Note check**\nAll proven."), ['Note check: no line reads "<check>: <mark>"']);
});

test("a CRLF shell continuation proves the command, and a bare line break still does not", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "u14-crlf-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const job = join(root, ".limen/jobs/j1");
	await mkdir(join(job, "session"), { recursive: true });
	const records = ["cd . &&\\\r\nCI=1 npm test 0 -- x", "true\nnpm test 0"].flatMap((command, id) => {
		const call = { content: [{ type: "toolCall", id: `h${id}`, name: "bash", arguments: { command } }] };
		return [call, { role: "toolResult", toolCallId: `h${id}`, toolName: "bash", isError: false }];
	});
	await writeFile(join(job, "session/a.jsonl"), records.map((message) => JSON.stringify({ message })).join("\n"));
	const open = (result: string) => writeFile(join(job, "result"), result).then(() => noteCheckOpen(job));
	assert.deepEqual(await open("## Note check\n- C0: proven. `npm test 0`\n"), []);
	assert.deepEqual(await open("## Note check\n- Only: proven. `true`\n"), [
		"Only: not proven. Limen: no proof that `true` ran (its shell call holds a line break), and no such file",
	]);
});
