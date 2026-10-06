// U4: a finished job's wake is claimed before it is injected, so two listeners on one session inject it once.
// Claim age comes from file mtimes (set here with utimes, never by waiting). A live listener's heartbeat keeps an
// aged claim (F042, 7e43d23); a dead owner's claim is recovered; two unsuccessful attempts stop retries (a14640f).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, utimesSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { claimDelivery, recordUnconfirmed, recoverClaims, refreshClaim } from "../src/job/wake-delivery.ts";

const SLOT = "coord";

async function job(t: TestContext) {
	const dir = await mkdtemp(join(tmpdir(), "u4-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const claim = join(dir, "notify", "claims", SLOT);
	const events: string[] = [];
	let sends = 0;
	/** One listener's attempt; `send` may return a promise (a wake still being accepted) or throw (a rejected injection). */
	const listen = (name: string, send: () => void | Promise<void> = () => {}) =>
		claimDelivery(
			dir,
			SLOT,
			() => true,
			() => {
				sends += 1;
				return send();
			},
			{
				blocked: () => events.push(`${name} blocked`),
				protected: () => false,
				pending: () => {},
				accepted: () => events.push(`${name} accepted`),
				released: () => events.push(`${name} released`),
			},
		);
	/** Moves the claim, and its heartbeat when asked, 31 seconds into the past: past the 30-second stale line. */
	const age = (heartbeat: boolean) => {
		const old = new Date(Date.now() - 31_000);
		if (heartbeat) {
			utimesSync(join(claim, "live"), old, old);
		}
		utimesSync(claim, old, old);
	};
	return { dir, claim, events, listen, age, sends: () => sends };
}

test("a second listener never takes a live claim, even one aged past 30 seconds while its owner's heartbeat is fresh", async (t) => {
	const { claim, events, listen, age, sends } = await job(t);
	assert.equal(listen("a"), true);
	assert.equal(listen("b"), false);
	refreshClaim(claim);
	age(false);
	assert.equal(listen("b"), false);
	assert.equal(sends(), 1);
	assert.deepEqual(events, ["a accepted"]);
	assert.ok(existsSync(join(claim, "accepted")));
});

test("a dead owner's claim is recovered: an unaccepted one is released, an accepted one spends one attempt and is delivered again", async (t) => {
	const { dir, claim, events, listen, age, sends } = await job(t);
	assert.equal(
		listen("a", () => Promise.withResolvers<void>().promise),
		true,
	);
	age(false);
	assert.equal(listen("b"), true);
	refreshClaim(claim);
	age(true);
	assert.equal(listen("c"), true);
	assert.equal(sends(), 3);
	assert.deepEqual(events, ["b released", "b accepted", "c released", "c accepted"]);
	assert.equal(readFileSync(join(dir, "notify", "unconfirmed", "_completion"), "utf8"), "1\n");
});

test("after two unsuccessful attempts the claim stays blocked for a human and no listener retries it", async (t) => {
	for (const failure of ["rejected injection", "errored turn"]) {
		const { dir, claim, events, listen, sends } = await job(t);
		const fail = () => {
			if (failure === "rejected injection") {
				throw new Error("pane is gone");
			}
		};
		for (const name of ["a", "b"]) {
			assert.equal(listen(name, fail), failure === "errored turn", failure);
			if (failure === "errored turn") {
				recordUnconfirmed(claim);
			}
		}
		assert.equal(listen("c"), false);
		assert.equal(recoverClaims(dir), false, "a blocked claim is not recovered again");
		assert.equal(sends(), 2, failure);
		assert.ok(existsSync(join(claim, "blocked")), failure);
		assert.deepEqual(readdirSync(join(dir, "notify", "delivered")), []);
		if (failure === "rejected injection") {
			assert.deepEqual(events, ["a released", "b released", "b blocked"]);
		}
	}
});
