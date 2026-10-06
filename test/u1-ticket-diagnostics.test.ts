// U1: ticket front matter faults each give the ticket file, the line and a fix; `limen ticket check` and land read these.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkTickets, readTickets } from "../src/picture/tickets.ts";

const tickets: Record<string, string> = {
	"active/F780-place":
		"---\ntouches:\n  - plant.viewer\n  - plant.misspelled\nopened: 2026-10-06\n---\n# F780 · Place\n\n## Outcome\n\nAdam reads **one** page. It stays current.\n",
	"active/F781-fields": `---
touch: plant.viewer
touches: plant.viewer
opened: 2026-02-30
needs-adam: "First line\\nsecond line"
wrong: This is wrong.
wrong-on: 2026-10-06
---
# F781 · Fields
`,
	"active/F782-flags":
		"---\nopened: 2026-10-06\nneeds-adam: Decide today.\nwrong-on: 2026-10-05\n---\n# F782 · Flags\n",
	"active/F783-legacy": "# F783 Legacy ticket\n",
	"done/2026-10/F784-landed": "---\nlanded: 2026-10-06\n---\n# F784 · Landed\n",
	"active/F785-duplicate": `---
touches:
  - plant.viewer
  - plant.viewer
opened: 2026-10-06
needs-adam: Keep the atlas?
needs-adam-on: 2026-10-05
wrong: The context is lost.
wrong-on: 2026-10-04
---
# F785 · Duplicate place
`,
	"active/F786-unclosed": "---\ntouches:\n  - plant.viewer\n",
	"active/F778-finish-signal": "---\ntouches:\n  - plant.viewer\nopened: 2026-10-06\n---\n# F778 · Finish signal\n",
	"active/F778-job-done": "# F778 · Job done\n",
	"done/2026-10/F778-older": "# F778 · Older\n",
};

test("each ticket fault is reported at its own file and line with a fix, and the valid fields still load", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "u1-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	for (const [folder, text] of Object.entries(tickets)) {
		await mkdir(join(root, "spec/features", folder), { recursive: true });
		await writeFile(join(root, "spec/features", folder, "ticket.md"), text);
	}
	const read = await readTickets(root);
	const diagnostics = [...read.diagnostics, ...checkTickets(read.tickets, new Set(["plant.viewer"]))];
	const found = diagnostics.map((d) => `${d.level} ${d.code} ${d.source}:${d.line}`).sort();
	const at = (level: string, code: string, folder: string, line: number) =>
		`${level} ${code} spec/features/${folder}/ticket.md:${line}`;
	assert.deepEqual(
		found,
		[
			at("error", "ticket.unknown-touch", "active/F780-place", 4),
			at("error", "ticket.bad-field", "active/F781-fields", 2),
			at("error", "ticket.bad-field", "active/F781-fields", 3),
			at("error", "ticket.bad-field", "active/F781-fields", 4),
			at("warn", "ticket.no-touches", "active/F781-fields", 3),
			at("error", "ticket.bad-field", "active/F781-fields", 5),
			at("error", "ticket.bad-field", "active/F782-flags", 3),
			at("error", "ticket.bad-field", "active/F782-flags", 4),
			at("warn", "ticket.no-touches", "active/F782-flags", 1),
			at("error", "ticket.no-front-matter", "active/F783-legacy", 1),
			at("error", "ticket.bad-field", "active/F785-duplicate", 4),
			at("error", "ticket.bad-field", "active/F786-unclosed", 1),
			at("error", "ticket.no-front-matter", "active/F778-job-done", 1),
			at("warn", "ticket.duplicate-id", "active/F778-job-done", 1),
			at("warn", "ticket.duplicate-id", "done/2026-10/F778-older", 1),
		].sort(),
	);
	for (const item of diagnostics) {
		assert.match(item.message, /; fix: \S/);
	}

	const byId = new Map(read.tickets.map((ticket) => [ticket.id, ticket]));
	assert.equal(byId.get("f778")?.path, "spec/features/active/F778-finish-signal/ticket.md");
	assert.equal(byId.get("f780")?.purpose, "Adam reads one page.");
	assert.deepEqual(byId.get("f780")?.touches, ["plant.viewer", "plant.misspelled"]);
	assert.deepEqual(byId.get("f781")?.wrong, { problem: "This is wrong.", on: "2026-10-06" });
	assert.equal(byId.get("f781")?.needsAdam, null);
	assert.equal(byId.get("f783")?.title, "Legacy ticket");
	assert.deepEqual([byId.get("f784")?.lane, byId.get("f784")?.landed], ["done", "2026-10-06"]);
	assert.deepEqual(byId.get("f785")?.needsAdam, { ask: "Keep the atlas?", on: "2026-10-05" });
	assert.deepEqual(byId.get("f785")?.wrong, { problem: "The context is lost.", on: "2026-10-04" });
});
