// U9: a recorded process is the same process only while its pid and its birth both match. A recycled pid with another
// birth is a stranger: containment never signals it and names it in the cleanup note; the recorded birth is signaled.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { containEscapedDescendants, processInfo } from "../src/runtime/contain.ts";

// The real identity query, with a deadline that load cannot miss (the product's one-second default can, and then
// counts the process as unknown).
const query = (pid: number) => processInfo(pid, Date.now() + 60_000);

test("a recycled pid with another birth is never signaled and is named for cleanup; the recorded birth is signaled", async (t) => {
	const job = await mkdtemp(join(tmpdir(), "u9-"));
	const child = spawn(process.execPath, ["-e", "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)"], {
		detached: true,
		stdio: "ignore",
	});
	t.after(() => rm(job, { recursive: true, force: true }));
	t.after(() => child.kill("SIGKILL"));
	const exited = once(child, "exit");
	const info = await query(child.pid ?? 0);
	assert.equal(info.kind, "present");
	if (info.kind !== "present") {
		return;
	}
	await containEscapedDescendants(job, [{ ...info.process, born: "0.000000" }], "u9", { query });
	assert.deepEqual([child.exitCode, child.signalCode], [null, null], "the stranger is still running");
	assert.match(await readFile(join(job, "cleanup"), "utf8"), new RegExp(`^${info.process.pid} 0\\.000000 `, "m"));
	await containEscapedDescendants(job, [info.process], "u9", { query });
	assert.deepEqual(await exited, [null, "SIGTERM"]);
});
