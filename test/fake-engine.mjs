#!/usr/bin/env node
// The one fake pi/omp. It loads the real hook extensions Limen passes, runs the task text as a script, and records
// what it saw in the record dir (the parent of --session-dir, so a job's own dir). Script lines:
//   commit · fail <code> · error (assistant stop reason "error") · say <text> · tool <command> · block · orphan · finish <handoff>
//   · /<command> <args> (runs a command a hook registered, as a user typing it)
// `block` writes fake-blocked-<n> and waits for one write to the FIFO fake-gate. Records: fake-argv.json, fake-env.json
// (variable names), fake-task.txt, fake-system.txt (system prompt after before_agent_start), fake-context.txt (the hidden
// context messages before_agent_start returned), fake-events.jsonl, and one transcript line per run in --session-dir.
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
if (args[0] === "--version") {
	process.exit(console.log("0.0.0-test") ?? 0);
}
if (args[0] === "config") {
	process.exit(console.log(JSON.stringify({ value: [] })) ?? 0);
}
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const dir = dirname(flag("--session-dir") ?? join(process.cwd(), "session"));
const prompt = args.find((value) => value.startsWith("@"));
const task = prompt ? readFileSync(prompt.slice(1), "utf8") : (flag("--continue") ?? "");
const preamble = flag("--append-system-prompt") ?? "";
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "fake-argv.json"), JSON.stringify(args));
writeFileSync(
	join(dir, "fake-env.json"),
	JSON.stringify(
		Object.keys(process.env)
			.filter((name) => /^(LIMEN|HERDR|PI)_/.test(name))
			.sort(),
	),
);
writeFileSync(join(dir, "fake-task.txt"), task);
if (flag("--session-dir")) {
	mkdirSync(flag("--session-dir"), { recursive: true });
	appendFileSync(join(flag("--session-dir"), "fake.jsonl"), `${JSON.stringify({ task })}\n`);
}
const record = (entry) => appendFileSync(join(dir, "fake-events.jsonl"), `${JSON.stringify(entry)}\n`);
const emit = (event) => console.log(JSON.stringify(event));

const handlers = new Map();
const tools = new Map();
const commands = new Map();
const queued = [];
let idle = true;
let turns = Promise.resolve();
let shutdown = false;
const fire = async (event, payload) => {
	const results = [];
	for (const handler of handlers.get(event) ?? []) {
		results.push(await handler(payload, context));
	}
	return results;
};
const ui = new Proxy(
	{},
	{
		get: (_, method) =>
			method === "then" ? undefined : (text) => method === "notify" && record({ event: "notify", text }),
	},
);
const context = {
	cwd: process.cwd(),
	ui,
	hasUI: true,
	isIdle: () => idle,
	sessionManager: {
		getSessionId: () => process.env.PI_SESSION_ID ?? "fake",
		getSessionFile: () => join(dir, "session.jsonl"),
		getSessionName: () => "fake",
	},
	shutdown: () => {
		shutdown = true;
	},
};
// A steer joins the running turn. Other messages queue; every message queued before a turn starts enters that turn,
// and the turn gets one assistant reply, as Pi does with followUpMode "all". A hook's sendMessage enters as role custom.
const deliver = (kind, text, as) => {
	record({ event: as ?? kind, text });
	if (as === "steer") {
		return;
	}
	queued.push({ role: kind === "message" ? "custom" : "user", content: [{ type: "text", text }] });
	if (queued.length === 1) {
		turns = turns.then(() => turn(queued.splice(0), "ok"));
	}
};
const api = {
	on: (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
	registerTool: (tool) => tools.set(tool.name, tool),
	registerCommand: (name, command) => commands.set(name, command),
	sendUserMessage: (text, options) => deliver("user", text, options?.deliverAs),
	sendMessage: (message, options) => deliver("message", message.content, options?.deliverAs),
};
async function turn(messages, reply, stopReason) {
	idle = false;
	for (const message of messages) {
		await fire("message_start", { message });
		await fire("message_end", { message });
	}
	await fire("turn_start", {});
	// Pi hands the hooks the turn's messages in a context event before each model call.
	await fire("context", { messages });
	const assistant = {
		role: "assistant",
		content: [{ type: "text", text: reply }],
		...(stopReason ? { stopReason } : {}),
	};
	emit({ type: "message_end", message: assistant });
	await fire("message_end", { message: assistant });
	await fire("turn_end", {});
	idle = true;
	await fire("agent_settled", {});
}
let blocks = 0;
async function block() {
	const gate = join(dir, "fake-gate");
	if (!existsSync(gate)) {
		execFileSync("mkfifo", [gate]);
	}
	blocks += 1;
	const released = new Promise((resolve) => createReadStream(gate).once("data", resolve));
	writeFileSync(join(dir, `fake-blocked-${blocks}`), "");
	await released;
}

for (let index = args.indexOf("--extension"); index >= 0; index = args.indexOf("--extension", index + 1)) {
	await (await import(args[index + 1])).default(api);
}
await fire("session_start", {});
const started = await fire("before_agent_start", { prompt: task, systemPrompt: preamble });
writeFileSync(join(dir, "fake-system.txt"), started.map((result) => result?.systemPrompt ?? "").join("\n"));
writeFileSync(join(dir, "fake-context.txt"), started.map((result) => result?.message?.content ?? "").join("\n"));
emit({ type: "agent_start" });
let reply = "fake engine done";
let stopReason;
let code = 0;
for (const line of task.split("\n")) {
	const [word = "", ...rest] = line.trim().split(" ");
	const value = rest.join(" ");
	if (word === "commit") {
		writeFileSync(`fake-${process.pid}-${blocks}-${Date.now()}.txt`, `${task}\n`);
		execFileSync("git", ["add", "."]);
		execFileSync("git", ["commit", "-q", "-m", "fake commit"]);
	} else if (word === "fail") {
		code = Number(value) || 1;
	} else if (word === "error") {
		stopReason = "error";
	} else if (word === "say") {
		reply = value;
	} else if (word === "tool") {
		emit({ type: "tool_execution_start", toolName: "bash", args: { command: value } });
		await fire("tool_execution_start", { toolName: "bash", args: { command: value } });
		emit({ type: "tool_execution_end", toolName: "bash" });
		await fire("tool_execution_end", { toolName: "bash" });
	} else if (word === "block") {
		await block();
	} else if (word === "orphan") {
		const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1e9)"], { detached: true, stdio: "ignore" });
		child.unref();
		writeFileSync(join(dir, "fake-orphan"), String(child.pid));
	} else if (word === "finish") {
		await tools.get("finish")?.execute("fake", { handoff: value }, undefined, undefined, context);
	} else if (word.startsWith("/")) {
		await commands.get(word.slice(1))?.handler(value, context);
	}
}
turns = turns.then(() => turn([{ role: "user", content: [{ type: "text", text: task }] }], reply, stopReason));
await turns;
await fire("session_shutdown", {});
record({ event: "exit", code, shutdown });
process.exit(code);
