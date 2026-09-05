import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import limenWake, { deliverySettled, progressFilename } from "../hook/wake.ts";

test("unwatched completion crosses fallback grace on the timer alone", async (context) => {
	const h = harness(context);
	h.job("mine", "done", "coordinator", "coordinator");
	h.job("orphan", "running", "closed-session");
	await h.start();
	h.put("orphan/state", "done");
	h.put("orphan/finished-at", new Date(h.now()).toISOString());
	await h.sweep();
	assert.equal(h.messages.length, 0);
	h.advance(999);
	await h.sweep();
	assert.equal(h.messages.length, 0, "no fallback inside grace");
	h.advance(1);
	await h.sweep();
	assert.equal(h.events.length, 0, "no filesystem event was supplied, even for completion");
	assert.equal(h.messages.length, 1);
	assert.match(h.messages[0]?.content ?? "", /is done \(orphan\)/);
	assert.equal(h.messages[0]?.deliverAs, undefined, "fallback starts a normal idle turn");
	await h.answer();
	assert.ok(fs.existsSync(join(h.jobs, "orphan/notify/delivered/_fallback")));
	await h.sweep();
	assert.equal(h.messages.length, 1);
});

test("busy completion stays claimed until its one followUp turn finishes", async (context) => {
	const h = harness(context);
	h.job("busy", "running", "coordinator");
	h.idle(false);
	await h.start();
	h.put("busy/state", "done");
	h.event("busy/state");
	await h.sweep();
	assert.equal(h.messages.length, 1);
	assert.equal(h.messages[0]?.deliverAs, "followUp");
	for (let index = 0; index < 3; index += 1) {
		h.advance(31_000);
		await h.sweep();
	}
	assert.equal(h.messages.length, 1, "busy claims survive cache refresh and repeated sweeps");
	assert.equal(deliverySettled(join(h.jobs, "busy"), "coordinator"), false);
	assert.equal(fs.existsSync(join(h.jobs, "busy/notify/delivered/coordinator")), false, "queued is not delivered");
	h.idle(true);
	await h.answer();
	assert.ok(fs.existsSync(join(h.jobs, "busy/notify/delivered/coordinator")));
	await h.sweep();
	h.advance(31_000);
	await h.sweep();
	assert.equal(h.messages.length, 1, "next idle turn confirms exactly one wake");
});

test("second full sweep skips 473 settled records and shares two running jobs with status and reaper", async (context) => {
	const h = harness(context);
	for (let index = 0; index < 473; index += 1) {
		const id = `settled-${String(index).padStart(3, "0")}`;
		h.job(id, ["done", "failed", "stopped"][index % 3] ?? "done", "coordinator", "coordinator");
	}
	for (const id of ["live-a", "live-b"]) h.job(id, "running", "coordinator");
	await h.start();
	h.reads.length = 0;
	const elapsed = await h.sweep();
	assert.equal(h.reads.filter((path) => path.includes("/settled-")).length, 0, "warm sweep must not open any settled record");
	assert.match(h.status() ?? "", /limen 2/);
	assert.equal(h.messages.length, 0);
	context.diagnostic(
		`475 records (473 settled, 2 running): second full sweep including reaper and status ${elapsed.toFixed(3)} ms; ${h.reads.length} sync filesystem calls; 0 settled-record reads`,
	);
	assert.ok(elapsed < 20, `second full sweep took ${elapsed.toFixed(3)} ms`);
});

test("settlement keeps fallback, blocked claims, and new subscriptions observable", (context) => {
	const h = harness(context);
	h.job("legacy", "done");
	h.job("pending", "done", "other");
	h.job("advisory-only", "failed", "other", "_advisory.other");
	h.job("foreign", "stopped", "other", "other");
	h.job("blocked", "done", "coordinator", "coordinator");
	h.put("blocked/notify/claims/_fallback/blocked", "human recovery needed");
	assert.equal(deliverySettled(join(h.jobs, "legacy"), "coordinator"), true);
	for (const id of ["pending", "advisory-only", "blocked"]) assert.equal(deliverySettled(join(h.jobs, id), "coordinator"), false, id);
	assert.equal(deliverySettled(join(h.jobs, "foreign"), "coordinator"), true);
	h.put("foreign/notify/subscribers/coordinator", "1");
	assert.equal(deliverySettled(join(h.jobs, "foreign"), "coordinator"), false);
});

test("cache invalidates ready, subscriptions, whole-job changes, and manual delivery repair", async (context) => {
	const h = harness(context);
	h.job("legacy", "done");
	h.job("foreign", "done", "other", "other");
	await h.start();
	h.put("legacy/notify/ready", "1");
	h.put("legacy/notify/subscribers/coordinator", "1");
	h.event("legacy/notify");
	await h.sweep();
	assert.equal(h.messages.length, 1, "ready makes cached legacy history routable");
	await h.answer();
	h.put("foreign/notify/subscribers/coordinator", "1");
	h.event("foreign/notify/subscribers/coordinator");
	await h.sweep();
	assert.equal(h.messages.length, 2, "a new subscription reopens foreign-delivered history");
	await h.answer();
	fs.rmSync(join(h.jobs, "foreign/notify/delivered/coordinator"), { recursive: true });
	h.event("foreign/notify/delivered/coordinator");
	await h.sweep();
	assert.equal(h.messages.length, 3, "bookkeeping does not schedule churn but does invalidate for repair");
	await h.answer();
	h.put("foreign/state", "running");
	h.event("foreign");
	await h.sweep();
	assert.match(h.status() ?? "", /limen 1/);
});

test("ownership cache notices whole-job addition and deletion", async (context) => {
	const h = harness(context);
	h.job("orphan", "done", "other");
	h.put("orphan/finished-at", "2000-01-01T00:00:00.000Z");
	await h.start();
	assert.equal(h.messages.length, 0, "session owns no jobs");
	h.reads.length = 0;
	h.event("orphan/log");
	await h.sweep();
	assert.equal(h.reads.filter((path) => path === h.jobs).length, 1, "ordinary events retain session ownership; only collection lists history");
	h.job("mine", "done", "coordinator", "coordinator");
	h.event("mine");
	await h.sweep();
	assert.equal(h.messages.length, 1, "whole-directory event invalidates cached false ownership");
	await h.answer();
	fs.rmSync(join(h.jobs, "mine"), { recursive: true });
	h.event("mine");
	h.job("second", "done", "other");
	h.put("second/finished-at", "2000-01-01T00:00:00.000Z");
	await h.sweep();
	assert.equal(h.messages.length, 1, "deleted last subscription invalidates cached true ownership");
});

test("missed events and watcher failure recover settled records and ownership within thirty seconds", async (context) => {
	const h = harness(context);
	h.job("mine", "done", "coordinator", "coordinator");
	await h.start();
	fs.rmSync(join(h.jobs, "mine/notify/delivered/coordinator"), { recursive: true });
	await h.sweep();
	assert.equal(h.messages.length, 0, "record is cached without an event");
	h.advance(30_000);
	await h.sweep();
	assert.equal(h.messages.length, 1, "bounded refresh reopens manual repair without an event");
	await h.answer();
	fs.rmSync(join(h.jobs, "mine"), { recursive: true });
	h.job("orphan", "done", "other");
	h.put("orphan/finished-at", "2000-01-01T00:00:00.000Z");
	h.watcher.emit("error", new Error("watch lost"));
	await h.sweep();
	assert.equal(h.messages.length, 1, "watch failure refreshes stale ownership");
	h.job("new-owner", "done", "coordinator", "coordinator");
	h.advance(30_000);
	await h.sweep();
	assert.equal(h.messages.length, 2, "timer recovers ownership even after watcher closes");
	await h.answer();
});

test("progress events neither invalidate settled records nor schedule sweeps", async (context) => {
	const h = harness(context);
	h.job("history", "done", "coordinator", "coordinator");
	await h.start();
	h.reads.length = 0;
	for (const name of ["activity", "changed-files", "last-tool"]) {
		assert.equal(progressFilename(`history/${name}`), true);
		assert.equal(progressFilename(`history\\${name}`), true);
		h.event(`history/${name}`);
	}
	assert.equal(h.scheduled.length, 0);
	await h.sweep();
	assert.equal(h.reads.filter((path) => path.includes("/history/")).length, 0);
	for (const name of [null, "activity", "activity/state", "job/state", "job/advisory", "job/notify/subscribers/activity", "job/session/activity"]) {
		assert.equal(progressFilename(name), false, String(name));
	}
	h.event(null);
	await h.sweep();
	assert.ok(
		h.reads.some((path) => path.includes("/history/")),
		"unknown events invalidate all cached records",
	);
});

function harness(context: TestContext) {
	const root = fs.mkdtempSync(join(tmpdir(), "limen-wake-sweep-"));
	const jobs = join(root, ".limen/jobs");
	fs.mkdirSync(join(root, ".agents/limen"), { recursive: true });
	fs.mkdirSync(jobs, { recursive: true });
	const previous = { ...process.env };
	delete process.env.LIMEN_JOB;
	delete process.env.LIMEN_WAKE;
	process.env.LIMEN_HERDR = "0";
	process.env.LIMEN_HOME = join(root, "home");
	process.env.LIMEN_WAKE_FALLBACK_MS = "1000";
	const realNow = Date.now;
	let now = realNow();
	context.mock.method(Date, "now", () => now);
	// Claims created after a clock jump must have a matching mtime, not look stale before injection.
	const realStat = fs.statSync;
	context.mock.method(fs, "statSync", (...args: unknown[]) => {
		const stat = Reflect.apply(realStat, fs, args);
		stat.mtimeMs += now - realNow();
		return stat;
	});
	const reads: string[] = [];
	for (const name of ["readFileSync", "existsSync", "readdirSync"] as const) {
		const original = fs[name];
		context.mock.method(fs, name, (...args: unknown[]) => {
			reads.push(String(args[0]));
			return Reflect.apply(original, fs, args);
		});
	}
	const watcher = Object.assign(new EventEmitter(), {
		close() {},
		ref() {
			return this;
		},
		unref() {
			return this;
		},
	});
	let changed: (event: string, filename: string | null) => void = () => {};
	context.mock.method(fs, "watch", (_path: unknown, _options: unknown, callback: typeof changed) => {
		changed = callback;
		return watcher as fs.FSWatcher;
	});
	syncBuiltinESMExports();
	const intervals = new Map<number, () => void>();
	const scheduled: number[] = [];
	const timers: NodeJS.Timeout[] = [];
	const realInterval = globalThis.setInterval;
	const realTimeout = globalThis.setTimeout;
	context.mock.method(globalThis, "setInterval", (callback: () => void, milliseconds: number) => {
		intervals.set(milliseconds, callback);
		const timer = realInterval(() => {}, 2 ** 30);
		timers.push(timer);
		return timer;
	});
	context.mock.method(globalThis, "setTimeout", (callback: () => void, milliseconds: number) => {
		scheduled.push(milliseconds);
		const timer = realTimeout(callback, 2 ** 30);
		timers.push(timer);
		return timer;
	});
	type Api = Parameters<typeof limenWake>[0];
	type Handler = Parameters<Api["on"]>[1];
	const handlers = new Map<string, Handler>();
	const messages: Array<{ content: string; deliverAs?: string }> = [];
	let idle = true;
	let status: string | undefined;
	let swept: () => void = () => {};
	const session = {
		cwd: root,
		isIdle: () => idle,
		sessionManager: { getSessionId: () => "coordinator" },
		ui: {
			notify() {},
			setStatus(_key: string, value: string | undefined) {
				status = value;
				swept();
			},
		},
	};
	limenWake({
		on(event, handler) {
			handlers.set(event, handler);
		},
		sendUserMessage(content, options) {
			messages.push({ content, ...(options ? { deliverAs: options.deliverAs } : {}) });
		},
	});
	const emit = (event: string, payload: unknown = {}) => handlers.get(event)?.(payload, session);
	const measure = async (start: () => void) => {
		const began = performance.now();
		await new Promise<void>((resolve) => {
			swept = resolve;
			start();
		});
		return performance.now() - began;
	};
	context.after(() => {
		emit("session_shutdown");
		for (const timer of timers) {
			clearInterval(timer);
			clearTimeout(timer);
		}
		context.mock.restoreAll();
		syncBuiltinESMExports();
		for (const key of ["LIMEN_JOB", "LIMEN_WAKE", "LIMEN_HERDR", "LIMEN_HOME", "LIMEN_WAKE_FALLBACK_MS"]) {
			if (previous[key] === undefined) delete process.env[key];
			else process.env[key] = previous[key];
		}
		fs.rmSync(root, { recursive: true, force: true });
	});
	const put = (path: string, content: string) => {
		fs.mkdirSync(dirname(join(jobs, path)), { recursive: true });
		fs.writeFileSync(join(jobs, path), `${content}\n`);
	};
	const events: Array<string | null> = [];
	return {
		jobs,
		messages,
		reads,
		scheduled,
		events,
		watcher,
		put,
		now: () => now,
		advance: (milliseconds: number) => {
			now += milliseconds;
		},
		idle: (value: boolean) => {
			idle = value;
		},
		status: () => status,
		event: (filename: string | null) => {
			events.push(filename);
			changed("rename", filename);
		},
		start: () => measure(() => emit("session_start")),
		sweep: () => measure(() => intervals.get(500)?.()),
		answer: () =>
			measure(() => {
				emit("message_start", { message: { role: "user", content: [{ type: "text", text: messages.at(-1)?.content }] } });
				emit("message_end", { message: { role: "assistant", content: [{ type: "text", text: "acknowledged" }], stopReason: "stop" } });
				emit("agent_settled");
			}),
		job(id: string, state: string, subscriber?: string, delivered?: string) {
			put(`${id}/state`, state);
			put(`${id}/label`, id);
			put(`${id}/started-at`, new Date(now).toISOString());
			if (subscriber) {
				put(`${id}/notify/subscribers/${subscriber}`, "1");
				put(`${id}/notify/ready`, "1");
			}
			if (delivered) put(`${id}/notify/delivered/${delivered}/accepted`, "1");
		},
	};
}
