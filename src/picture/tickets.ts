import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter.ts";
import { inlineText, proseBlocks } from "./markdown.ts";
import type { Diagnostic } from "./picture-model.ts";

export interface TicketRecord {
	id: string;
	code: string;
	slug: string;
	title: string;
	lane: "planned" | "active" | "done" | "dropped";
	path: string;
	outcome: string;
	purpose: string;
	touches: string[];
	touchLines: Record<string, number>;
	opened: string | null;
	landed: string | null;
	needsAdam: { ask: string; on: string } | null;
	wrong: { problem: string; on: string } | null;
}

const FIELDS: Record<string, true> = {
	touches: true,
	opened: true,
	landed: true,
	"needs-adam": true,
	"needs-adam-on": true,
	wrong: true,
	"wrong-on": true,
};

/** Read ticket files in the four feature lanes, without deriving dates or state from the clock. */
export async function readTickets(root: string): Promise<{ tickets: TicketRecord[]; diagnostics: Diagnostic[] }> {
	const tickets: TicketRecord[] = [];
	const diagnostics: Diagnostic[] = [];
	const base = "spec/features";
	for (const lane of ["planned", "active", "done", "dropped"] as const) {
		const lanePath = `${base}/${lane}`;
		const groups = lane === "done" || lane === "dropped" ? await directories(join(root, lanePath)) : [""];
		for (const group of groups) {
			const parent = group ? `${lanePath}/${group}` : lanePath;
			for (const slug of await directories(join(root, parent))) {
				const number = /^F\d+(?=-.+$)/.exec(slug)?.[0];
				if (number === undefined) {
					continue;
				}
				const path = `${parent}/${slug}/ticket.md`;
				const text = await readFile(join(root, path), "utf8").catch((error: NodeJS.ErrnoException) => {
					if (error.code === "ENOENT") {
						return null;
					}
					throw error;
				});
				if (text === null) {
					continue;
				}
				const ticket = parseTicket(text, path, lane, number, slug.slice(number.length + 1), diagnostics);
				// One feature number is one work item; a second folder with the same number stays out of the picture and warns.
				const first = tickets.find((other) => other.id === ticket.id);
				if (first) {
					diagnostics.push({
						level: "warn",
						code: "ticket.duplicate-id",
						message: `${ticket.code} is also used by ${first.path}, so this ticket is left out; fix: give this folder and its heading an unused F number (limen ticket new picks one)`,
						source: path,
						id: ticket.id,
						line: 1,
					});
					continue;
				}
				tickets.push(ticket);
			}
		}
	}
	return { tickets, diagnostics };
}

/** Unknown map place ids are errors at the YAML list item, never silent links. */
export function checkTickets(tickets: readonly TicketRecord[], placeIds: ReadonlySet<string>): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	for (const ticket of tickets) {
		for (const place of ticket.touches) {
			if (!placeIds.has(place)) {
				diagnostics.push(
					diagnostic(
						"error",
						"ticket.unknown-touch",
						`unknown place id "${place}"; fix: replace it with the id: of a module or plant file in the map's nodes/ folder`,
						ticket,
						ticket.touchLines[place] ?? 1,
					),
				);
			}
		}
	}
	return diagnostics;
}

async function directories(path: string): Promise<string[]> {
	const entries = await readdir(path, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
		if (error.code === "ENOENT") {
			return [];
		}
		throw error;
	});
	return entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
}

function parseTicket(
	text: string,
	path: string,
	lane: TicketRecord["lane"],
	code: string,
	slug: string,
	diagnostics: Diagnostic[],
): TicketRecord {
	const id = code.toLowerCase();
	const report = (level: Diagnostic["level"], code: string, problem: string, fix: string, line: number): void => {
		diagnostics.push({ level, code, message: `${problem}; fix: ${fix}`, source: path, id, line });
	};
	const hasFrontmatter = text.replace(/^\uFEFF/, "").startsWith("---");
	const fm = hasFrontmatter ? parseFrontmatter(text) : null;
	if (fm) {
		for (const error of fm.errors) {
			report(
				"error",
				"ticket.bad-field",
				error.message,
				error.message.includes("fence is not closed")
					? 'add a closing "---" fence'
					: "write this line as `key: value`, or as a list with one `  - item` per line",
				error.line,
			);
		}
	}
	const body = fm?.ok ? fm.body : text;
	const heading = /^#\s+F\d+\s*(?:[·:—-]\s*)?(.+)\s*$/m.exec(body);
	const title = heading?.[1]?.trim() ?? slug.replaceAll("-", " ");
	const section = /^## Outcome\s*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/m.exec(body)?.[1] ?? "";
	const outcome = inlineText(proseBlocks(section)[0]?.text ?? "")
		.replace(/\s+/g, " ")
		.trim();
	const purpose = /^(.+?[.!?])(?:\s|$)/.exec(outcome)?.[1] ?? outcome;
	const ticket: TicketRecord = {
		id,
		code,
		slug,
		title,
		lane,
		path,
		outcome,
		purpose,
		touches: [],
		touchLines: {},
		opened: null,
		landed: null,
		needsAdam: null,
		wrong: null,
	};
	if (!fm?.ok) {
		if (lane === "active" && !fm) {
			report(
				"error",
				"ticket.no-front-matter",
				"active ticket has no front matter",
				'add a fenced block with "opened: YYYY-MM-DD" before the heading',
				1,
			);
		}
		return ticket;
	}
	for (const key of Object.keys(fm.data)) {
		if (!Object.hasOwn(FIELDS, key)) {
			report("error", "ticket.bad-field", `unknown ticket field "${key}"`, `remove "${key}"`, fm.lines[key] ?? 1);
		}
	}
	const field = (key: string): unknown => fm.data[key];
	const date = (key: string): string | null => {
		const value = field(key);
		if (value === undefined) {
			return null;
		}
		if (typeof value !== "string" || !validDate(value)) {
			report(
				"error",
				"ticket.bad-field",
				`${key} must be a real YYYY-MM-DD date`,
				`set "${key}" to a real YYYY-MM-DD date`,
				fm.lines[key] ?? 1,
			);
			return null;
		}
		return value;
	};
	ticket.opened = date("opened");
	ticket.landed = date("landed");
	if (ticket.landed && lane !== "done") {
		report(
			"error",
			"ticket.bad-field",
			"landed is only for done tickets",
			'remove "landed" until the ticket moves to done/',
			fm.lines.landed ?? 1,
		);
	}
	const touches = field("touches");
	if (touches !== undefined) {
		const firstLine = fm.lines.touches ?? 1;
		if (/^touches:\s*\[/.test(text.split(/\r\n?|\n/)[firstLine - 1] ?? "")) {
			report(
				"error",
				"ticket.bad-field",
				"touches must use a block list",
				'put each place id on its own indented "- id" line',
				firstLine,
			);
		}
		if (!Array.isArray(touches)) {
			report(
				"error",
				"ticket.bad-field",
				"touches must be a block list of place ids",
				'put each place id on its own indented "- id" line',
				firstLine,
			);
		} else {
			for (const [index, value] of touches.entries()) {
				const line = fm.lines[`touches.${index}`] ?? firstLine;
				if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
					report(
						"error",
						"ticket.bad-field",
						"touches entries must be place ids",
						"replace this entry with one place id, with no spaces around it",
						line,
					);
				} else if (Object.hasOwn(ticket.touchLines, value)) {
					report("error", "ticket.bad-field", `duplicate place id "${value}"`, "remove this repeated list item", line);
				} else {
					ticket.touches.push(value);
					ticket.touchLines[value] = line;
				}
			}
		}
	}
	for (const [key, dateKey] of [
		["needs-adam", "needs-adam-on"],
		["wrong", "wrong-on"],
	] as const) {
		const value = field(key);
		const on = date(dateKey);
		if (value === undefined) {
			if (field(dateKey) !== undefined) {
				report(
					"error",
					"ticket.bad-field",
					`${dateKey} needs ${key}`,
					`add "${key}" as one nonempty line`,
					fm.lines[dateKey] ?? 1,
				);
			}
			continue;
		}
		if (typeof value !== "string" || !value.trim() || value !== value.trim() || /[\r\n]/.test(value)) {
			report(
				"error",
				"ticket.bad-field",
				`${key} must be one nonempty line`,
				`write "${key}" as one nonempty line`,
				fm.lines[key] ?? 1,
			);
			continue;
		}
		if (!on) {
			if (field(dateKey) === undefined) {
				report(
					"error",
					"ticket.bad-field",
					`${key} needs ${dateKey}`,
					`add "${dateKey}: YYYY-MM-DD" with a real date`,
					fm.lines[key] ?? 1,
				);
			}
			continue;
		}
		if (key === "needs-adam") {
			ticket.needsAdam = { ask: value, on };
		} else {
			ticket.wrong = { problem: value, on };
		}
	}
	if (lane === "active" && ticket.touches.length === 0) {
		report(
			"warn",
			"ticket.no-touches",
			"active ticket has no touches",
			'add a "touches:" block with verified map place ids when known',
			fm.lines.touches ?? 1,
		);
	}
	return ticket;
}

function validDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return false;
	}
	const timestamp = Date.parse(`${value}T00:00:00Z`);
	return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function diagnostic(
	level: Diagnostic["level"],
	code: string,
	message: string,
	ticket: TicketRecord,
	line: number,
): Diagnostic {
	return { level, code, message, source: ticket.path, id: ticket.id, line };
}
