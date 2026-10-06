// U3: what one settled coordinator turn tells the shepherd. A blocker always counts; idle and done wait for the
// coordinator's own running jobs; an aborted turn means the owner is at the pane and never counts.
import assert from "node:assert/strict";
import test from "node:test";
import { type CoordinatorTurn, turnSignal } from "../src/integrations/coordinator-signal.ts";

const todo = (content: string, status: string, blocker?: string) => ({
	content,
	status,
	...(blocker ? { blocker } : {}),
});
const goal = (status: string) => ({ id: "g", objective: "Ship F781", status });
const base: CoordinatorTurn = { todos: [], todosClosed: false, stop: "stop", ownedRunning: 0 };
const open = [todo("Review", "pending"), todo("Land F781", "in_progress")];
const closed = [todo("Spawn", "completed"), todo("Report", "abandoned"), todo("Land F781", "completed")];

const rows: ReadonlyArray<readonly [string, Partial<CoordinatorTurn>, string | undefined]> = [
	["nothing open", {}, undefined],
	["open todos", { todos: open }, "coordinator.idle"],
	["open todos while an owned job runs", { todos: open, ownedRunning: 1 }, undefined],
	[
		"a blocked todo while owned jobs run",
		{ todos: [todo("Land F781", "blocked", "needs owner")], ownedRunning: 2 },
		"coordinator.blocked",
	],
	[
		"a goal out of token budget while an owned job runs",
		{ goal: goal("budget-limited"), ownedRunning: 1 },
		"coordinator.blocked",
	],
	["an active goal", { goal: goal("active") }, "coordinator.idle"],
	["a paused goal", { goal: goal("paused") }, "coordinator.idle"],
	["every todo closed this turn", { todos: closed, todosClosed: true }, "coordinator.goal-done"],
	["every todo closed while an owned job runs", { todos: closed, todosClosed: true, ownedRunning: 1 }, undefined],
	[
		"every todo closed while the goal stays active",
		{ todos: closed, todosClosed: true, goal: goal("active") },
		"coordinator.idle",
	],
	["todos closed in an earlier turn", { todos: closed }, undefined],
	["a failed turn with nothing open", { stop: "error" }, "coordinator.idle"],
	["an aborted turn with open todos", { stop: "aborted", todos: open }, undefined],
	["an aborted turn with a blocked todo", { stop: "aborted", todos: [todo("Land", "blocked")] }, undefined],
];

test("a settled coordinator turn gives the signal its todos, goal, stop reason and owned jobs call for", () => {
	for (const [name, turn, kind] of rows) {
		assert.equal(turnSignal({ ...base, ...turn })?.kind, kind, name);
	}
});

test("a blocked signal names the blocked todo and its blocker; an idle one names the next open todo", () => {
	const blocked = turnSignal({
		...base,
		todos: [todo("Review", "pending"), todo("Land F781", "blocked", "needs owner")],
	});
	assert.ok(blocked?.reason.includes("Land F781") && blocked.reason.includes("needs owner"));
	assert.ok(turnSignal({ ...base, todos: open })?.reason.includes("Land F781"));
});
