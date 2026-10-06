// U2: the finish webhook sender (bin/tony-finish-ping.sh) is a trust boundary. A bad credential, destination, target
// list or author map sends nothing at all; no run prints a secret; the job's receipt keeps only allowlisted lines.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseFinishReceipt, parseFinishSelection } from "../src/integrations/finish-receipt.ts";
import { plant, requests, respond } from "./plant.ts";

const SENDER = fileURLToPath(new URL("../bin/tony-finish-ping.sh", import.meta.url));
const AUTH = "Bearer synthetic-secret._~+/-==";
const URL_ONE = "https://finish.example.test/private-one";
const SECRET = /synthetic-secret|private-|finish\.example\.test/;
const two = [
	{ url: URL_ONE, auth: AUTH },
	{ url: "https://finish.example.test/private-two", auth: "Bearer second-synthetic-secret" },
];
const single = (url: string, auth?: string) =>
	`LIMEN_FINISH_WEBHOOK_URL='${url}'\n${auth === undefined ? "" : `LIMEN_FINISH_WEBHOOK_AUTH='${auth}'\n`}`;
const multi = (targets: unknown, map?: string) =>
	`LIMEN_FINISH_WEBHOOK_TARGETS='${typeof targets === "string" ? targets : JSON.stringify(targets)}'\n${map === undefined ? "" : `LIMEN_FINISH_WEBHOOK_AUTHOR_TARGETS='${map}'\n`}`;

test("the sender sends nothing for a bad credential, destination, target list or author map, and prints no secret", async (t) => {
	const p = await plant();
	t.after(p.cleanup);
	const marker = join(p.parent, "executed");
	await respond(p, [
		{ match: "private-redirect", status: 302, body: {} },
		{ match: "private-reject", status: 500, body: { error: "synthetic-secret" } },
		{ match: "private-broken", status: 600, body: {} },
	]);
	const send = async (config: string | undefined, override?: string) => {
		const path = join(p.parent, "webhook.env");
		if (config !== undefined) {
			await writeFile(path, config, { mode: 0o600 });
		}
		const env = { ...p.env, LIMEN_FINISH_WEBHOOK_ENV: override ?? path, LIMEN_FINISH_WEBHOOK_AUTHOR: "@alice" };
		const before = requests(p).length;
		const run = spawnSync(SENDER, ["F001 demo", "done", "limen/demo"], { cwd: p.root, env, encoding: "utf8" });
		assert.doesNotMatch(run.stdout + run.stderr, SECRET);
		return { status: run.status, sent: requests(p).slice(before) };
	};

	const refused: ReadonlyArray<readonly [string, string, number?]> = [
		["missing auth", single(URL_ONE)],
		["raw token", single(URL_ONE, "synthetic-secret")],
		["Basic auth", single(URL_ONE, "Basic synthetic-secret")],
		["lower-case bearer", single(URL_ONE, "bearer synthetic-secret")],
		["empty bearer", single(URL_ONE, "Bearer ")],
		["bearer with a second word", single(URL_ONE, "Bearer synthetic-secret extra")],
		["bearer with a header injection", single(URL_ONE, "Bearer synthetic-secret\r\nX-Evil: yes")],
		["http URL", single("http://finish.example.test/private-one", AUTH)],
		["URL with userinfo", single("https://user:synthetic-secret@finish.example.test/", AUTH)],
		["URL with a fragment", single("https://finish.example.test/#synthetic-secret", AUTH)],
		["empty URL", single("", AUTH)],
		["target list not JSON", multi("not-json")],
		["empty target list", multi("[]")],
		["one target with a raw token", multi([two[0], { ...two[1], auth: "synthetic-secret" }])],
		["one target with an unknown key", multi([two[0], { ...two[1], bot: "two" }])],
		["65 targets", multi(Array.from({ length: 65 }, () => two[0]))],
		["author map not JSON", multi(two, "not-json")],
		["author key without @", multi(two, '{"alice":[1]}')],
		["author route to target 0", multi(two, '{"@alice":[0]}')],
		["author route listed twice", multi(two, '{"@alice":[1,1]}')],
		["author route past the list", multi(two, '{"@alice":[3]}')],
		["no route for this author", multi(two, "{}"), 0],
		[
			"env file with shell",
			`touch '${marker}'\nLIMEN_FINISH_WEBHOOK_URL='${URL_ONE}'\nLIMEN_FINISH_WEBHOOK_AUTH="Bearer $(touch '${marker}')"\n`,
		],
	];
	for (const [name, config, status = 1] of refused) {
		assert.deepEqual(await send(config), { status, sent: [] }, name);
	}
	assert.equal(existsSync(marker), false, "the env file is data, never a shell script");
	for (const override of ["relative.env", join(p.parent, "missing.env"), p.parent]) {
		assert.deepEqual(await send(undefined, override), { status: 1, sent: [] }, override);
	}

	for (const route of ["redirect", "reject", "broken"]) {
		const failed = await send(single(`https://finish.example.test/private-${route}`, AUTH));
		assert.deepEqual([failed.status, failed.sent.length], [1, 1], route);
	}
	const fanOut = await send(multi([{ ...two[0], url: "https://finish.example.test/private-reject" }, two[1]]));
	assert.deepEqual(
		[fanOut.status, fanOut.sent.map((request) => request.url)],
		[1, ["https://finish.example.test/private-reject", two[1]?.url]],
	);

	const accepted = await send(single(URL_ONE, AUTH));
	assert.equal(accepted.status, 0);
	assert.deepEqual(
		accepted.sent.map((request) => [request.method, request.url, request.headers.authorization]),
		[["POST", URL_ONE, AUTH]],
	);
	const body = JSON.parse(accepted.sent[0]?.body ?? "{}");
	assert.deepEqual([body.job, body.branch, body.jobState], ["F001 demo", "limen/demo", "done"]);
	assert.doesNotMatch(accepted.sent[0]?.body ?? "", SECRET);
	const routed = await send(multi(two, '{"@alice":[2],"*":[1]}'));
	assert.deepEqual([routed.status, routed.sent.map((request) => request.headers.authorization)], [0, [two[1]?.auth]]);
});

test("the private receipt channel drops malformed and secret-bearing sender lines", () => {
	const accepted = { target: 1, at: "2026-09-11T12:00:00.000Z", transport: "accepted", http: "2xx" };
	assert.deepEqual(parseFinishReceipt(JSON.stringify(accepted)), accepted);
	const receipts = [
		{ ...accepted, token: "synthetic-secret" },
		{ ...accepted, url: URL_ONE },
		{ ...accepted, target: 65 },
		{ ...accepted, transport: "observed" },
		{ ...accepted, http: "5xx" },
		{ ...accepted, at: "synthetic-secret" },
	].map((value) => JSON.stringify(value));
	for (const line of [...receipts, "synthetic-secret".repeat(3000), '{"target":1,']) {
		assert.equal(parseFinishReceipt(line), undefined, line.slice(0, 80));
	}
	assert.equal(parseFinishSelection(JSON.stringify({ selection: "mapped @alice -> 1, 2" })), "mapped @alice -> 1, 2");
	for (const value of [
		{ selection: URL_ONE },
		{ selection: "fan-out", token: "synthetic-secret" },
		{ route: "fan-out" },
	]) {
		assert.equal(parseFinishSelection(JSON.stringify(value)), undefined, JSON.stringify(value));
	}
});
