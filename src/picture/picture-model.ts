export interface PictureFile {
	source: string;
	text: string;
}
export interface Diagnostic {
	level: "error" | "warn" | "info";
	code: string;
	message: string;
	source: string | null;
	id: string | null;
	line: number | null;
}
type Report = (
	level: Diagnostic["level"],
	code: string,
	message: string,
	source?: string | null,
	id?: string | null,
	line?: number | null,
) => void;
interface RecordNode {
	id: string;
	kind: string;
	project: string;
	title: string;
	status: string;
	sources: string[];
	source: string;
	lines: Record<string, number>;
	meta: Record<string, unknown>;
	bodyHtml: string;
	summary: string;
	parent: string | null;
	revision: string | null;
	from: string;
	to: string;
	relation: string;
	touches: string[];
	steps: string[];
	complete: boolean;
	children: string[];
	depth: number;
}
interface PictureNode {
	id: string;
	title: string;
	kind: string;
	parent: string | null;
	status: string;
	summary: string;
	sources: string[];
	bodyHtml: string;
	source: string;
	children: string[];
	depth: number;
	meta: Record<string, unknown>;
}
interface PictureEdge {
	id: string;
	from: string;
	to: string;
	kind: string;
	title: string;
	status: string;
	summary: string;
	bodyHtml: string;
	sources: string[];
	source: string;
	meta: Record<string, unknown>;
}
interface PictureFeature {
	id: string;
	title: string;
	kind: "feature";
	status: string;
	summary: string;
	sources: string[];
	bodyHtml: string;
	source: string;
	meta: Record<string, unknown>;
	touches: string[];
}
interface PictureJourney {
	id: string;
	title: string;
	kind: "journey";
	status: string;
	summary: string;
	sources: string[];
	bodyHtml: string;
	source: string;
	meta: Record<string, unknown>;
	steps: string[];
}

export interface PictureWork {
	id: string;
	code: string;
	slug: string;
	title: string;
	lane: string;
	board: BoardEntry | null;
	purpose: string;
	outcome: string;
	touches: string[];
	touchSource: "ticket" | "map" | "none";
	opened: string | null;
	landed: string | null;
	needsAdam: { ask: string; on: string } | null;
	wrong: { problem: string; on: string } | null;
	path: string;
	mapFeature: string | null;
}

export interface PicturePin {
	work: string;
	date: string;
	text: string;
	scope: string;
}

export interface PictureDay {
	date: string;
	items: { work: string; kind: "opened" | "landed" | "needs-adam" | "wrong"; text: string }[];
}
export interface PictureModel {
	schema: string;
	generatedAt: string;
	project: {
		id: string;
		rootId: string | null;
		revision: string | null;
		title: string;
		status: string;
		sources: string[];
		summary: string;
		descriptionHtml: string;
		meta: Record<string, unknown>;
	};
	nodes: PictureNode[];
	edges: PictureEdge[];
	features: PictureFeature[];
	journeys: PictureJourney[];
	work: PictureWork[];
	pins: { changed: PicturePin[]; wrong: PicturePin[]; needs: PicturePin[] };
	days: PictureDay[];
	diagnostics: Diagnostic[];
}

// Pure model builder for architecture-map/1 datasets and the offline viewer.
// Pure and total: takes file texts, returns the model, never throws on bad data.
// Every defect becomes a diagnostic and the model stays usable: unknown parents
// become top-level, parent cycles break at the smallest id, bad edges drop.
// A missing child file is a gap; nothing is invented.

import { basename } from "node:path";
import type { BoardEntry } from "./board.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import { inlineText, proseBlocks, renderMarkdown } from "./markdown.ts";
import { checkTickets, type TicketRecord } from "./tickets.ts";

export const INPUT_SCHEMA = "architecture-map/1";
export const MODEL_SCHEMA = "architecture-map-model/3";
export const KINDS = ["plant", "module", "edge", "feature", "journey"];
export const RELATIONS = ["depends-on", "hosts", "calls", "implements", "generates", "reads", "writes", "composes"];
export const STATUSES = ["ready", "partial", "stub"];
export const ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/;

const COMMON_KEYS: Record<string, true> = {
	schema: true,
	kind: true,
	id: true,
	project: true,
	title: true,
	status: true,
	sources: true,
};
const NODE_KEYS: Record<string, true> = { ...COMMON_KEYS, parent: true, revision: true };
const EDGE_KEYS: Record<string, true> = { ...COMMON_KEYS, from: true, to: true, relation: true };
const FEATURE_KEYS: Record<string, true> = { ...COMMON_KEYS, touches: true };
const JOURNEY_KEYS: Record<string, true> = { ...COMMON_KEYS, steps: true };
/** Record kinds with their own directory and field set; every other kind is a node in nodes/. */
const KIND_DIRECTORIES = [
	{ kind: "edge", directory: "edges", keys: EDGE_KEYS },
	{ kind: "feature", directory: "features", keys: FEATURE_KEYS },
	{ kind: "journey", directory: "journeys", keys: JOURNEY_KEYS },
] as const;
const OWNER_LINE = /^owner:[ \t]*(\S.*?)[ \t]*$/;
const SUMMARY_MAX = 200;
const LEVEL_RANK = { error: 0, warn: 1, info: 2 };
const KIND_RANK: Record<string, number> = { module: 0 };

export function buildModel({
	files,
	diagnostics = [],
	now,
	exists,
	tickets = [],
	board,
}: {
	files: readonly PictureFile[];
	diagnostics?: readonly Diagnostic[];
	now?: Date;
	tickets?: readonly TicketRecord[];
	board?: ReadonlyMap<string, BoardEntry>;
	/** Answers whether a cited path exists under the project root; when omitted, sources are not checked. */
	exists?: ((path: string) => boolean) | undefined;
}): PictureModel {
	const diags = [...diagnostics];
	const diag: Report = (level, code, message, source = null, id = null, line = null) => {
		diags.push({ level, code, message, source, id, line });
	};

	const byId = new Map<string, RecordNode>();
	for (const file of [...files].sort((a, b) => cmp(a.source, b.source))) {
		const rec = readRecord(file, diag, byId);
		if (rec) {
			byId.set(rec.id, rec);
		}
	}
	const records = [...byId.values()];
	if (exists) {
		for (const r of records) {
			for (const path of r.sources) {
				if (!exists(path)) {
					diag(
						"warn",
						"source.missing",
						`source "${path}" does not exist in the project root`,
						r.source,
						r.id,
						r.lines.sources ?? null,
					);
				}
			}
		}
	}

	const plants = records.filter((r) => r.kind === "plant");
	const plantIds = new Set(plants.map((p) => p.id));
	const plant = plants[0] ?? null;
	if (!plant) {
		diag("error", "plant.missing", 'no file has "kind: plant"; the project has no root node');
	} else {
		for (const extra of plants.slice(1)) {
			diag(
				"error",
				"plant.multiple",
				`a second plant; "${plant.id}" (${plant.source}) is the project root; this file is ignored`,
				extra.source,
				extra.id,
				extra.lines.kind ?? null,
			);
		}
	}

	const projectId = plant ? plant.project : (records.find((r) => r.project)?.project ?? "");
	if (projectId) {
		for (const r of records) {
			if (r.project && r.project !== projectId) {
				diag(
					"error",
					"node.project-mismatch",
					`project "${r.project}" is not "${projectId}"`,
					r.source,
					r.id,
					r.lines.project ?? null,
				);
			}
		}
	}

	const features = records.filter((r) => r.kind === "feature");
	const journeys = records.filter((r) => r.kind === "journey");
	const nodes = new Map(
		records.filter((r) => !["plant", "edge", "feature", "journey"].includes(r.kind)).map((r) => [r.id, r]),
	);
	resolveParents(nodes, plantIds, diag);
	const ordered = orderNodes(nodes);
	const edges = buildEdges(
		records.filter((r) => r.kind === "edge"),
		nodes,
		plantIds,
		new Set(features.map((r) => r.id)),
		new Set(journeys.map((r) => r.id)),
		diag,
	);
	const modules = new Set(records.filter((r) => r.kind === "module").map((r) => r.id));
	const places = new Set([...modules, ...plantIds]);
	if (tickets.length) {
		diags.push(...checkTickets(tickets, places));
	}
	const featureModels: PictureFeature[] = features.map((r) => ({
		id: r.id,
		title: r.title,
		kind: "feature",
		status: r.status,
		summary: r.summary,
		sources: r.sources,
		bodyHtml: r.bodyHtml,
		source: r.source,
		meta: r.meta,
		touches: resolveOverlayList(r, "touches", modules, diag),
	}));
	const journeyModels: PictureJourney[] = journeys.map((r) => ({
		id: r.id,
		title: r.title,
		kind: "journey",
		status: r.status,
		summary: r.summary,
		sources: r.sources,
		bodyHtml: r.bodyHtml,
		source: r.source,
		meta: r.meta,
		steps: resolveOverlayList(r, "steps", places, diag),
	}));
	const featureById = new Map(featureModels.map((feature) => [feature.id, feature]));
	const nodeTitles = new Map(ordered.map((node) => [node.id, node.title]));
	const topModule = new Map<string, string>();
	for (const node of ordered) {
		topModule.set(node.id, node.parent ? (topModule.get(node.parent) ?? node.parent) : node.id);
	}
	const work: PictureWork[] = [...tickets]
		.sort((a, b) => cmp(a.id, b.id) || cmp(a.path, b.path))
		.map((ticket) => {
			const feature = featureById.get(`limen.feature.${ticket.id}`);
			const touches = ticket.touches.length ? ticket.touches.filter((id) => places.has(id)) : (feature?.touches ?? []);
			return {
				id: ticket.id,
				code: ticket.code,
				slug: ticket.slug,
				title: ticket.title,
				lane: ticket.lane,
				board: board?.get(ticket.id) ?? null,
				purpose: ticket.purpose,
				outcome: ticket.outcome,
				touches,
				touchSource: ticket.touches.length ? "ticket" : feature?.touches.length ? "map" : "none",
				opened: ticket.opened,
				landed: ticket.landed,
				needsAdam: ticket.needsAdam,
				wrong: ticket.wrong,
				path: ticket.path,
				mapFeature: feature?.id ?? null,
			};
		});
	const pins: PictureModel["pins"] = { changed: [], wrong: [], needs: [] };
	const dayItems = new Map<string, PictureDay["items"]>();
	const addDay = (date: string, item: PictureDay["items"][number]): void => {
		const items = dayItems.get(date) ?? [];
		items.push(item);
		dayItems.set(date, items);
	};
	for (const item of work) {
		let scope = "";
		const [first] = item.touches;
		if (first !== undefined && item.touches.length === 1) {
			scope = nodeTitles.get(first) ?? plant?.title ?? "";
		} else if (item.touches.length > 1) {
			const modules = new Set(item.touches.map((id) => topModule.get(id) ?? id));
			const [module] = modules;
			scope =
				module !== undefined && modules.size === 1
					? (nodeTitles.get(module) ?? "")
					: `${item.touches.length} places in ${modules.size} modules`;
		}
		if (item.opened) {
			addDay(item.opened, { work: item.id, kind: "opened", text: item.title });
		}
		if (item.landed) {
			pins.changed.push({ work: item.id, date: item.landed, text: item.title, scope });
			addDay(item.landed, { work: item.id, kind: "landed", text: item.title });
		}
		if (item.wrong) {
			pins.wrong.push({ work: item.id, date: item.wrong.on, text: item.wrong.problem, scope });
			addDay(item.wrong.on, { work: item.id, kind: "wrong", text: item.wrong.problem });
		}
		if (item.needsAdam) {
			pins.needs.push({ work: item.id, date: item.needsAdam.on, text: item.needsAdam.ask, scope });
			addDay(item.needsAdam.on, { work: item.id, kind: "needs-adam", text: item.needsAdam.ask });
		}
	}
	const newest = (a: PicturePin, b: PicturePin): number => cmp(b.date, a.date) || cmp(a.work, b.work);
	pins.changed.sort(newest);
	pins.wrong.sort(newest);
	pins.needs.sort(newest);
	const days: PictureDay[] = [...dayItems]
		.sort(([a], [b]) => cmp(b, a))
		.map(([date, items]) => ({
			date,
			items: items.sort((a, b) => cmp(a.work, b.work) || cmp(a.kind, b.kind)),
		}));
	const newestDate = days[0]?.date;

	diags.sort(diagCmp);
	return {
		schema: MODEL_SCHEMA,
		generatedAt: now ? now.toISOString().replace(/\.\d{3}Z$/, "Z") : `${newestDate ?? "1970-01-01"}T00:00:00Z`,
		project: plant
			? {
					id: projectId,
					rootId: plant.id,
					revision: plant.revision,
					title: plant.title,
					status: plant.status,
					sources: plant.sources,
					summary: plant.summary,
					descriptionHtml: plant.bodyHtml,
					meta: plant.meta,
				}
			: {
					id: projectId,
					rootId: null,
					revision: null,
					title: projectId,
					status: "stub",
					sources: [],
					summary: "",
					descriptionHtml: "",
					meta: {},
				},
		nodes: ordered.map((n) => ({
			id: n.id,
			title: n.title,
			kind: n.kind,
			parent: n.parent,
			status: n.status,
			summary: n.summary,
			sources: n.sources,
			bodyHtml: n.bodyHtml,
			source: n.source,
			children: n.children,
			depth: n.depth,
			meta: n.meta,
		})),
		edges,
		features: featureModels,
		journeys: journeyModels,
		work,
		pins,
		days,
		diagnostics: diags,
	};
}

/** One file → record, or null when the file cannot be used (unparseable, no id, duplicate id). */
function readRecord(file: PictureFile, diag: Report, byId: Map<string, RecordNode>): RecordNode | null {
	const { source } = file;
	if (!/^(nodes|edges|features|journeys)\/[^/]+\.md$/.test(source)) {
		return null;
	}
	const fm = parseFrontmatter(file.text);
	const data = fm.data;
	const guessId = typeof data.id === "string" ? data.id : null;
	for (const error of fm.errors) {
		diag("error", "parse.frontmatter", error.message + (fm.ok ? "" : "; file skipped"), source, guessId, error.line);
	}
	if (!fm.ok) {
		return null;
	}

	const at = (key: string) => fm.lines[key] ?? null;
	const text = (key: string) => {
		const v = data[key];
		if (v !== null && typeof v === "object") {
			diag("error", "node.bad-field", `"${key}" must be a single value`, source, guessId, at(key));
			return "";
		}
		return scalar(v);
	};

	const kind = text("kind");
	const isEdge = kind === "edge";
	const isOverlay = kind === "feature" || kind === "journey";
	const kindDirectory = KIND_DIRECTORIES.find((entry) => entry.kind === kind);
	const directory = kindDirectory?.directory ?? "nodes";
	if (!source.startsWith(`${directory}/`)) {
		const graph = source.slice(0, source.indexOf("/"));
		const prefix = KIND_DIRECTORIES.find((entry) => entry.directory === graph)?.kind ?? "node";
		diag(
			"error",
			kind ? "node.kind-directory" : `${prefix}.missing-field`,
			kind ? `kind "${kind}" does not belong in ${graph}; file skipped` : 'missing required field "kind"; file skipped',
			source,
			guessId,
			at("kind"),
		);
		return null;
	}
	const prefix = isEdge || isOverlay ? kind : "node";
	const missing = (key: string, tail = "") =>
		diag("error", `${prefix}.missing-field`, `missing required field "${key}"${tail}`, source, guessId, at(key));

	const id = text("id");
	if (!id) {
		missing("id", "; file skipped");
		return null;
	}
	const first = byId.get(id);
	if (first) {
		diag(
			"error",
			"node.duplicate-id",
			`id "${id}" is already defined in ${first.source}; file skipped`,
			source,
			id,
			at("id"),
		);
		return null;
	}
	if (!ID_PATTERN.test(id)) {
		diag(
			"error",
			"node.bad-id",
			`id "${id}" must start with a lowercase letter and use dot-separated letters, digits or hyphens without a leading hyphen`,
			source,
			id,
			at("id"),
		);
	}
	if (basename(source) !== `${id}.md`) {
		diag("error", "node.file-name", `file name must be "${id}.md"`, source, id, at("id"));
	}

	const schema = text("schema");
	if (schema !== INPUT_SCHEMA) {
		diag(
			"warn",
			"schema.version",
			schema
				? `schema "${schema}" is not "${INPUT_SCHEMA}"; read as ${INPUT_SCHEMA}`
				: `missing "schema: ${INPUT_SCHEMA}"`,
			source,
			id,
			at("schema"),
		);
	}

	const rec: RecordNode = {
		id,
		kind,
		project: text("project"),
		title: text("title"),
		status: text("status"),
		sources: readSources(data.sources, (msg) => diag("warn", "node.bad-field", msg, source, id, at("sources"))),
		source,
		lines: fm.lines,
		meta: Object.create(null) as Record<string, unknown>,
		bodyHtml: "",
		summary: "",
		parent: null,
		revision: null,
		from: "",
		to: "",
		relation: "",
		touches: [],
		steps: [],
		complete: false,
		children: [],
		depth: 0,
	};
	for (const key of ["kind", "project", "title", "status"] as const) {
		if (!rec[key]) {
			missing(key);
		}
	}
	if (!rec.title) {
		rec.title = id;
	}
	if (!rec.status) {
		rec.status = "stub";
	} else if (!STATUSES.includes(rec.status)) {
		diag(
			"warn",
			"node.bad-status",
			`status "${rec.status}" is not one of ${STATUSES.join(", ")}; kept`,
			source,
			id,
			at("status"),
		);
	}
	if (rec.kind && !KINDS.includes(rec.kind)) {
		diag(
			"warn",
			"node.unknown-kind",
			`kind "${rec.kind}" is not one of ${KINDS.join(", ")}; kept as a node`,
			source,
			id,
			at("kind"),
		);
	}

	const known = kindDirectory?.keys ?? NODE_KEYS;
	for (const [k, v] of Object.entries(data)) {
		if (!Object.hasOwn(known, k)) {
			rec.meta[k] = v;
		}
	}
	const body = splitOwner(fm.body);
	if (body.owner !== null) {
		rec.meta.owner = body.owner;
	}
	rec.bodyHtml = renderMarkdown(body.markdown);
	rec.summary = firstSentence(body.markdown);

	if (isEdge) {
		for (const key of ["from", "to", "relation"] as const) {
			rec[key] = text(key);
		}
		const absent = (["from", "to", "relation"] as const).filter((k) => !rec[k]);
		for (const key of absent) {
			missing(key, "; edge dropped");
		}
		rec.complete = absent.length === 0;
	} else if (isOverlay) {
		const key = kind === "feature" ? "touches" : "steps";
		if (!Object.hasOwn(data, key)) {
			missing(key);
		} else {
			rec[key] = readOverlayList(data[key], kind === "feature" ? 1 : 2, (message) =>
				diag("error", `${kind}.bad-field`, `"${key}" ${message}`, source, id, at(key)),
			);
		}
	} else if (rec.kind === "plant") {
		rec.parent = null;
		if (!Object.hasOwn(data, "parent")) {
			missing("parent");
		} else if (data.parent !== null) {
			diag("error", "node.bad-field", '"parent" of a plant must be null', source, id, at("parent"));
		}
		if (Object.hasOwn(data, "revision")) {
			if (typeof data.revision === "string" && /^[0-9a-fA-F]{40}$/.test(data.revision)) {
				rec.revision = data.revision.toLowerCase();
			} else {
				diag(
					"error",
					"plant.bad-revision",
					'"revision" must be a full 40-character hexadecimal commit SHA; ignored',
					source,
					id,
					at("revision"),
				);
			}
		}
	} else {
		rec.parent = text("parent") || null;
		if (!Object.hasOwn(data, "parent")) {
			missing("parent");
		}
	}

	return rec;
}

/** Strips a trailing `owner: <x>` line (alone on its line) from the body. */
function splitOwner(markdown: string): { markdown: string; owner: string | null } {
	const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
	const last = lines.findLastIndex((line) => line.trim() !== "");
	const line = lines[last];
	const owner = line === undefined ? undefined : OWNER_LINE.exec(line.trim())?.[1];
	if (owner === undefined) {
		return { markdown, owner: null };
	}
	return { markdown: lines.slice(0, last).join("\n"), owner };
}

/** First sentence of the first paragraph or list item, as plain text, at most SUMMARY_MAX chars. */
function firstSentence(markdown: string): string {
	const block = proseBlocks(markdown)[0];
	if (!block) {
		return "";
	}
	const plain = inlineText(block.text).replace(/\s+/g, " ").trim();
	const sentence = /^(.+?[.!?])(?:\s|$)/.exec(plain)?.[1] ?? plain;
	if (sentence.length <= SUMMARY_MAX) {
		return sentence;
	}
	const cut = sentence.slice(0, SUMMARY_MAX - 1);
	const space = cut.lastIndexOf(" ");
	return `${(space > SUMMARY_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function readSources(v: unknown, warn: (message: string) => void): string[] {
	if (v === undefined || v === null) {
		return [];
	}
	if (!Array.isArray(v)) {
		if (typeof v === "object") {
			warn('"sources" must be a list of paths; ignored');
			return [];
		}
		return [scalar(v)];
	}
	const out: string[] = [];
	for (const p of v) {
		if (p !== null && typeof p === "object") {
			warn('"sources" items must be single values; item ignored');
		} else if (scalar(p)) {
			out.push(scalar(p));
		}
	}
	return out;
}

function readOverlayList(value: unknown, minimum: number, error: (message: string) => void): string[] {
	if (!Array.isArray(value)) {
		error("must be a list of ids");
		return [];
	}
	const ids: string[] = [];
	for (const item of value) {
		if (typeof item !== "string" || !ID_PATTERN.test(item)) {
			error("items must be valid ids; item ignored");
		} else {
			ids.push(item);
		}
	}
	if (ids.length < minimum) {
		error(`must contain at least ${minimum} ${minimum === 1 ? "id" : "ids"}`);
	}
	return ids;
}

function resolveOverlayList(
	record: RecordNode,
	key: "touches" | "steps",
	allowed: Set<string>,
	diag: Report,
): string[] {
	return record[key].filter((id) => {
		if (allowed.has(id)) {
			return true;
		}
		const code = key === "touches" ? "feature.unknown-touch" : "journey.unknown-step";
		diag(
			"warn",
			code,
			`"${id}" is not a ${key === "touches" ? "module" : "place"}; entry ignored`,
			record.source,
			record.id,
			record.lines[key] ?? null,
		);
		return false;
	});
}

function resolveParents(nodes: Map<string, RecordNode>, plantIds: Set<string>, diag: Report): void {
	const sorted = [...nodes.values()].sort((a, b) => cmp(a.id, b.id));
	for (const n of sorted) {
		if (n.parent === null) {
			continue;
		}
		if (plantIds.has(n.parent)) {
			n.parent = null;
		} else if (!nodes.has(n.parent)) {
			diag(
				"error",
				"node.unknown-parent",
				`parent "${n.parent}" is not a node; shown as a top-level block`,
				n.source,
				n.id,
				n.lines.parent ?? null,
			);
			n.parent = null;
		}
	}
	// Break every parent cycle at its smallest id so the result does not depend on file order.
	const settled = new Set<string>();
	for (const start of sorted) {
		const path: RecordNode[] = [];
		const onPath = new Map<string, number>();
		let cur: RecordNode | undefined = start;
		while (cur && !settled.has(cur.id) && !onPath.has(cur.id)) {
			onPath.set(cur.id, path.length);
			path.push(cur);
			cur = cur.parent === null ? undefined : nodes.get(cur.parent);
		}
		const from = cur === undefined ? undefined : onPath.get(cur.id);
		if (from !== undefined) {
			const members = path.slice(from);
			const cut = members.reduce((min, n) => (cmp(n.id, min.id) < 0 ? n : min));
			const cycle = members.map((n) => n.id);
			const k = cycle.indexOf(cut.id);
			const loop = [...cycle.slice(k), ...cycle.slice(0, k), cut.id].join(" -> ");
			cut.parent = null;
			diag(
				"error",
				"node.parent-cycle",
				`parent chain forms a cycle (${loop}); "${cut.id}" is shown as a top-level block`,
				cut.source,
				cut.id,
				cut.lines.parent ?? null,
			);
		}
		for (const p of path) {
			settled.add(p.id);
		}
	}
}

function orderNodes(nodes: Map<string, RecordNode>): RecordNode[] {
	const roots: RecordNode[] = [];
	const kids = new Map<string, RecordNode[]>();
	for (const n of nodes.values()) {
		if (n.parent === null) {
			roots.push(n);
		} else {
			const siblings = kids.get(n.parent) ?? [];
			siblings.push(n);
			kids.set(n.parent, siblings);
		}
	}
	const ordered: RecordNode[] = [];
	const visit = (list: RecordNode[], depth: number): void => {
		list.sort(siblingCmp);
		for (const n of list) {
			const children = (kids.get(n.id) ?? []).sort(siblingCmp);
			n.depth = depth;
			n.children = children.map((c) => c.id);
			ordered.push(n);
			visit(children, depth + 1);
		}
	};
	visit(roots, 0);
	return ordered;
}

function buildEdges(
	records: RecordNode[],
	nodes: Map<string, RecordNode>,
	plantIds: Set<string>,
	featureIds: Set<string>,
	journeyIds: Set<string>,
	diag: Report,
): PictureEdge[] {
	const edges: PictureEdge[] = [];
	for (const edge of records) {
		if (!edge.complete) {
			continue;
		}
		const at = (key: string) => edge.lines[key] ?? null;
		const overlayEnd = (["from", "to"] as const).find((key) => featureIds.has(edge[key]) || journeyIds.has(edge[key]));
		if (overlayEnd) {
			const kind = featureIds.has(edge[overlayEnd]) ? "feature" : "journey";
			diag(
				"warn",
				`edge.${kind}`,
				`edge touches the ${kind} "${edge[overlayEnd]}"; edge dropped`,
				edge.source,
				edge.id,
				at(overlayEnd),
			);
			continue;
		}
		if (edge.relation === "contains") {
			diag(
				"warn",
				"edge.contains",
				'containment comes from "parent", not from edges; edge dropped',
				edge.source,
				edge.id,
				at("relation"),
			);
			continue;
		}
		const plantEnd = [edge.from, edge.to].find((x) => plantIds.has(x));
		if (plantEnd) {
			diag(
				"info",
				"edge.plant",
				`edge touches the plant "${plantEnd}"; edge dropped`,
				edge.source,
				edge.id,
				at(plantEnd === edge.from ? "from" : "to"),
			);
			continue;
		}
		const dangling = (["from", "to"] as const).filter((k) => !nodes.has(edge[k]));
		const [missing] = dangling;
		if (missing !== undefined) {
			const what = dangling.map((k) => `${k} "${edge[k]}"`).join(" and ");
			diag("error", "edge.dangling", `${what} is not a node; edge dropped`, edge.source, edge.id, at(missing));
			continue;
		}
		if (edge.from === edge.to) {
			diag("warn", "edge.self", "from and to are the same node; edge dropped", edge.source, edge.id, at("to"));
			continue;
		}
		if (!RELATIONS.includes(edge.relation)) {
			diag(
				"warn",
				"edge.unknown-relation",
				`relation "${edge.relation}" is not one of ${RELATIONS.join(", ")}; kept`,
				edge.source,
				edge.id,
				at("relation"),
			);
		}
		edges.push({
			id: edge.id,
			from: edge.from,
			to: edge.to,
			kind: edge.relation,
			title: edge.title,
			status: edge.status,
			summary: edge.summary,
			bodyHtml: edge.bodyHtml,
			sources: edge.sources,
			source: edge.source,
			meta: edge.meta,
		});
	}
	return edges;
}

function siblingCmp(a: RecordNode, b: RecordNode): number {
	return (
		(KIND_RANK[a.kind] ?? 2) - (KIND_RANK[b.kind] ?? 2) ||
		cmp(a.title.toLowerCase(), b.title.toLowerCase()) ||
		cmp(a.title, b.title) ||
		cmp(a.id, b.id)
	);
}

function diagCmp(a: Diagnostic, b: Diagnostic): number {
	return (
		cmp(a.source ?? "", b.source ?? "") ||
		(a.line ?? 0) - (b.line ?? 0) ||
		LEVEL_RANK[a.level] - LEVEL_RANK[b.level] ||
		cmp(a.code, b.code) ||
		cmp(a.message, b.message)
	);
}

function scalar(v: unknown): string {
	if (v === undefined || v === null) {
		return "";
	}
	return String(v).trim();
}

function cmp(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
