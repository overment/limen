#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initCommand } from "../src/commands/init.ts";

const root = process.argv[2] && resolve(process.argv[2]);
if (!root || process.argv.length !== 3) {
	throw new Error("usage: node bin/limen-group-fixture.mjs /absolute/new/disposable/repository");
}
const candidate = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
if (root === candidate || root.startsWith(`${candidate}/`)) {
	throw new Error("fixture must be outside the Limen checkout");
}
await mkdir(root);
function git(...args) {
	const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(result.stderr || result.error?.message || "git failed");
	}
	return result.stdout.trim();
}
git("init", "-b", "main");
git("config", "user.name", "Limen Group Proof");
git("config", "user.email", "group-proof@example.test");
// Keep this disposable fixture's seat registration local; never alter the owner's registry.
process.env.LIMEN_HOME = root;
await initCommand([], root);
const feature = "spec/features/active/F001-job-summary";
const files = {
	"package.json": JSON.stringify(
		{
			name: "limen-group-proof",
			private: true,
			type: "module",
			scripts: { test: "node --test test/*.test.ts" },
			engines: { node: ">=24" },
		},
		null,
		2,
	),
	".gitignore": "/.limen/\n",
	"README.md":
		"# Disposable job-summary collaboration proof\n\nNo remote, finish webhook, or autonomous landing. Implement the committed ticket; src/summary.ts intentionally does not exist yet.\n",
	[`${feature}/ticket.md`]:
		"# F001 · Job records produce a checked latest-revision summary\n\nImplement `summarizeJobs(records)` in `src/summary.ts` with no dependencies. For each ID keep the highest numeric revision. States are running, done, failed and stopped. Return `{ counts: { running, done, failed, stopped }, attention: string[] }`, where attention is sorted failed/stopped IDs. IDs are nonempty strings and revisions are finite numbers. Reject non-array input, null/non-object records, invalid IDs/revisions/states, and conflicting states at the same ID/revision, even if that revision is stale. Identical duplicate records are allowed. Do not mutate the input. Empty input returns zero counts and empty attention.\n\nRun `npm test`, commit a clean candidate, and exchange an evidence-based finding and response with the other team before finishing or report the recorded deadline. Do not read another team's candidate before publishing your initial hypothesis.\n",
	[`${feature}/group/brief.md`]:
		"# Shared job-summary brief\n\nBoth teams implement the same ticket and committed acceptance tests. Team 1 starts with a single-pass map. Team 2 starts with sorting/grouping and separate validation. These are hypotheses, not restrictions. Each coordinator first publishes its own hypothesis, then launches exactly one worker with the recorded engine/provider/model and high reasoning. Include the ticket pointer, npm test, a concrete edge-case finding, and an evidence-based response to another team's finding in the worker task. Each worker first publishes its own hypothesis, then uses group wait when idle; it cannot finish until it responds to one peer finding or its deadline expires. Coordinators stay in bounded waits until their child finishes, inspect only their team's candidate, publish a summary, and commit their clean evidence. No helpers, extra workers, model fallback, push, main merge, board edit or group-member land. The interactive lead writes synthesis, optionally integrates locally for the final check, then stops and deliberately closes the clean group.\n",
	[`${feature}/group/teams/team-1.md`]:
		"# Single-pass map hypothesis\n\nExplore a map that validates each record and retains the latest state per ID. Publish this hypothesis before any other tool. Find a counterexample around duplicate or stale revisions and compare time/space costs. Evidence may change the approach.\n",
	[`${feature}/group/teams/team-2.md`]:
		"# Sorting and separate-validation hypothesis\n\nExplore validating all records, then sorting a copy and grouping by ID/revision. Publish this hypothesis before any other tool. Find a counterexample around conflict precedence or input mutation and compare costs. Evidence may change the approach.\n",
	"test/summary.test.ts": `import assert from "node:assert/strict";
import test from "node:test";
import { summarizeJobs } from "../src/summary.ts";

test("latest revisions determine counts and sorted attention without input mutation", () => {
  const records = [
    { id: "z", revision: -2.5, state: "failed" }, { id: "a", revision: 3, state: "stopped" },
    { id: "z", revision: -0.5, state: "done" }, { id: "b", revision: 1, state: "failed" },
    { id: "c", revision: 0, state: "running" }, { id: "b", revision: 1, state: "failed" },
  ];
  const original = structuredClone(records);
  Object.freeze(records); records.forEach(Object.freeze);
  assert.deepEqual(summarizeJobs(records), { counts: { running: 1, done: 1, failed: 1, stopped: 1 }, attention: ["a", "b"] });
  assert.deepEqual(records, original);
});
test("empty input produces zeros", () => assert.deepEqual(summarizeJobs([]), { counts: { running: 0, done: 0, failed: 0, stopped: 0 }, attention: [] }));
test("conflicts at any revision are rejected independently of order", () => {
  const records = [{ id: "x", revision: 1, state: "done" }, { id: "x", revision: 1, state: "failed" }, { id: "x", revision: 2, state: "running" }];
  assert.throws(() => summarizeJobs(records));
  assert.throws(() => summarizeJobs([...records].reverse()));
});
test("malformed records and malformed containers are rejected", () => {
  for (const value of [null, {}, "records", [null], [{ id: "", revision: 0, state: "done" }], [{ id: 4, revision: 0, state: "done" }], [{ id: "x", revision: Infinity, state: "done" }], [{ id: "x", revision: NaN, state: "done" }], [{ id: "x", revision: 0, state: "unknown" }]]) assert.throws(() => summarizeJobs(value));
});
`,
};
for (const [name, content] of Object.entries(files)) {
	const path = `${root}/${name}`;
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${content.trimEnd()}\n`, { flag: name === ".gitignore" ? "w" : "wx" });
}
git("add", ".");
git("commit", "-m", "Prepare two-team job-summary proof");
console.log(
	`Fixture: ${root}\nPacket commit: ${git("rev-parse", "HEAD")}\nNo agents launched. No remote configured.\n\nOpen an INTERACTIVE lead (Herdr coordinator pane, LIMEN_COORDINATOR=1 — not a limen spawn job) in this fixture with:\n  export LIMEN_COORDINATOR=1\n  export LIMEN_PACKAGE=${JSON.stringify(candidate)}\n  export PATH=${JSON.stringify(`${candidate}/bin`)}:$PATH\n  export LIMEN_HOME=${JSON.stringify(root)}\n  cd ${JSON.stringify(root)}\n  omp --no-extensions --extension ${JSON.stringify(`${candidate}/templates/limen-extension.ts`)} --provider openai-codex --model gpt-6.1-sol --thinking xhigh\n\nIn that lead's bash tool (not a separate shell):\n  limen group start ${feature} --teams 2 --workers-per-team 1 --timeout 30m --worker-timeout 20m --engine omp --provider openai-codex --model gpt-6.1-sol --thinking xhigh --worker-thinking high --detached\n\nRetain the group ID. Require finding/response exchanges in actual recipient turns and a lead synthesis. Then group status ID, group stop ID, resolve dirty recovery deliberately, and group close ID. File evidence against scenario.md; transport acceptance is not collaboration proof.`,
);
