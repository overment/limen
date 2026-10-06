// Frontmatter parser for the strict YAML subset of the dataset schema (architecture-map/1).
// Caller: picture-model.ts. Never throws on bad input: every problem becomes
// { line, message } in `errors`, and parsing resumes at the next line.
//
// Supported: `key: value` scalars (plain, "double", 'single', numbers, booleans,
// null), `#` comments, block lists (`- item`), block lists of maps, and inline
// lists (`[a, "b"]`). Not supported (reported as errors): nested maps, nested
// blocks inside list items, block scalars (`|`, `>`), anchors, tags, inline maps.

const KEY = /^([A-Za-z0-9_][A-Za-z0-9_.-]*):(?:[ \t]+(.*))?$/;
const ITEM = /^( *)-(?: +(.*))?$/;
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const ESCAPES: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", n: "\n", t: "\t", r: "\r", 0: "\0" };
type ScalarResult = { ok: true; value: unknown } | { ok: false; message: string };
type QuotedResult = { ok: true; value: string; end: number } | { ok: false; message: string };
type ParseError = { line: number; message: string };
type LineMap = Record<string, number>;
type ReportError = (index: number, message: string) => void;
type OpenItem = { map: Map<string, unknown>; col: number; idx: number };
export interface Frontmatter {
	ok: boolean;
	data: Record<string, unknown>;
	lines: LineMap;
	body: string;
	bodyLine: number;
	errors: ParseError[];
}

/**
 * @param {string} text whole file
 * @returns {{ ok: boolean, data: Record<string, unknown>, lines: Record<string, number>,
 *   body: string, bodyLine: number, errors: { line: number, message: string }[] }}
 *   `ok` is false when no frontmatter block exists; `data` is then empty.
 *   `lines` maps `key`, `key.<index>` and `key.<index>.<subkey>` to 1-based file lines.
 */
export function parseFrontmatter(text: string): Frontmatter {
	const src = String(text)
		.replace(/^\uFEFF/, "")
		.replace(/\r\n?/g, "\n");
	const all = src.split("\n");
	if (all[0]?.trimEnd() !== "---") {
		return fail(src, 'file does not start with a "---" frontmatter fence');
	}
	const close = all.findIndex((line, i) => i > 0 && line.trimEnd() === "---");
	if (close < 0) {
		return fail(src, 'the "---" frontmatter fence is not closed');
	}

	const fm = all.slice(1, close);
	const lineOf = (k: number) => k + 2;
	const errors: ParseError[] = [];
	const error: ReportError = (k, message) => {
		errors.push({ line: lineOf(k), message });
	};
	const data = new Map<string, unknown>();
	const lines: LineMap = Object.create(null) as LineMap;

	let i = 0;
	for (let raw = fm[i]; raw !== undefined; raw = fm[i]) {
		if (isCommentOrEmpty(raw)) {
			i++;
			continue;
		}
		const ind = leading(raw);
		if (ind.includes("\t")) {
			error(i, "use spaces, not tabs, for indentation");
			i++;
			continue;
		}
		if (ind.length > 0) {
			error(i, "unexpected indentation");
			i++;
			continue;
		}
		const [, key, rest = ""] = KEY.exec(raw.trimEnd()) ?? [];
		if (key === undefined) {
			error(i, 'expected "key: value"');
			i++;
			continue;
		}
		const duplicate = data.has(key);
		if (duplicate) {
			error(i, `duplicate key "${key}"; the first value is kept`);
		}

		if (isCommentOrEmpty(rest)) {
			let j = i + 1;
			const block: [number, string][] = [];
			for (let r = fm[j]; r !== undefined; r = fm[j]) {
				if (!isCommentOrEmpty(r)) {
					if (leading(r).length === 0 && !/^-(?: |$)/.test(r.trimEnd())) {
						break;
					}
					block.push([j, r]);
				}
				j++;
			}
			const value = parseBlock(block, key, duplicate ? {} : lines, error, lineOf);
			if (!duplicate) {
				data.set(key, value);
				lines[key] = lineOf(i);
			}
			i = j;
			continue;
		}

		const r = parseScalar(rest);
		if (!r.ok) {
			error(i, r.message);
		} else if (!duplicate) {
			data.set(key, r.value);
			lines[key] = lineOf(i);
		}
		i++;
	}

	return {
		ok: true,
		data: Object.fromEntries(data),
		lines,
		body: all.slice(close + 1).join("\n"),
		bodyLine: close + 2,
		errors,
	};
}

function fail(src: string, message: string): Frontmatter {
	return { ok: false, data: {}, lines: {}, body: src, bodyLine: 1, errors: [{ line: 1, message }] };
}

function parseBlock(
	block: [number, string][],
	key: string,
	lines: LineMap,
	error: ReportError,
	lineOf: (index: number) => number,
): unknown {
	const [first] = block;
	if (first === undefined) {
		return null;
	}
	const itemIndent = leading(first[1]).length;
	const items: unknown[] = [];
	let cur: OpenItem | null = null;

	for (const [k, raw] of block) {
		const ind = leading(raw);
		if (ind.includes("\t")) {
			error(k, "use spaces, not tabs, for indentation");
			continue;
		}
		const line = raw.trimEnd();
		const im = ITEM.exec(line);
		if (im && ind.length === itemIndent) {
			cur = null;
			const content = im[2] ?? "";
			const idx = items.length;
			if (isCommentOrEmpty(content)) {
				error(k, "empty list item");
				continue;
			}
			const [, sub, rest = ""] = KEY.exec(content) ?? [];
			if (sub !== undefined) {
				const col = itemIndent + line.slice(itemIndent + 1).search(/\S/) + 1;
				const map = new Map<string, unknown>();
				items.push(map);
				lines[`${key}.${idx}`] = lineOf(k);
				cur = { map, col, idx };
				setEntry(cur, sub, rest, k, key, lines, error, lineOf);
				continue;
			}
			const r = parseScalar(content);
			if (!r.ok) {
				error(k, r.message);
				continue;
			}
			items.push(r.value);
			lines[`${key}.${idx}`] = lineOf(k);
			continue;
		}
		if (cur && !im && ind.length === cur.col) {
			const [, sub, rest = ""] = KEY.exec(line.slice(cur.col)) ?? [];
			if (sub === undefined) {
				error(k, 'expected "key: value" inside the list item');
			} else {
				setEntry(cur, sub, rest, k, key, lines, error, lineOf);
			}
			continue;
		}
		if (ind.length > itemIndent && cur) {
			error(k, "nested blocks inside list items are not supported");
		} else if (!im && ind.length === itemIndent) {
			error(k, 'expected a list item ("- ..."); nested maps are not supported');
		} else {
			error(k, "list items must use the same indentation");
		}
	}

	return items.map((it) => (it instanceof Map ? Object.fromEntries(it) : it));
}

function setEntry(
	cur: OpenItem,
	sub: string,
	rest: string,
	k: number,
	key: string,
	lines: LineMap,
	error: ReportError,
	lineOf: (index: number) => number,
): void {
	if (cur.map.has(sub)) {
		error(k, `duplicate key "${sub}" in list item; the first value is kept`);
		return;
	}
	const r = parseScalar(rest);
	if (!r.ok) {
		error(k, r.message);
		return;
	}
	cur.map.set(sub, r.value);
	lines[`${key}.${cur.idx}.${sub}`] = lineOf(k);
}

/** @returns {{ ok: true, value: unknown } | { ok: false, message: string }} */
export function parseScalar(src: string): ScalarResult {
	const s = src.trim();
	const c = s[0];
	if (c === undefined || c === "#") {
		return { ok: true, value: null };
	}
	if (c === '"' || c === "'") {
		const r = readQuoted(s, 0);
		if (!r.ok) {
			return r;
		}
		if (!isCommentOrEmpty(s.slice(r.end))) {
			return bad("unexpected text after the quoted string");
		}
		return { ok: true, value: r.value };
	}
	if (c === "[") {
		return parseInlineList(s);
	}
	if (c === "{") {
		return bad("inline maps are not supported; use a block list of maps");
	}
	if (c === "|" || c === ">") {
		return bad("block scalars are not supported; write the value on one line");
	}
	if ("&*!%@`".includes(c)) {
		return bad(`quote values that start with "${c}"`);
	}
	const plain = stripComment(s);
	if (/^-(?: |$)/.test(plain)) {
		return bad('quote values that start with "- "');
	}
	if (/:(?: |$)/.test(plain)) {
		return bad('quote values that contain ": "');
	}
	return { ok: true, value: typed(plain) };
}

function typed(plain: string): string | number | boolean | null {
	if (plain === "true") {
		return true;
	}
	if (plain === "false") {
		return false;
	}
	if (plain === "null" || plain === "~") {
		return null;
	}
	if (NUMBER.test(plain) && String(Number(plain)) === plain) {
		return Number(plain);
	}
	return plain;
}

function readQuoted(s: string, start: number): QuotedResult {
	const q = s[start];
	let out = "";
	let i = start + 1;
	for (let c = s[i]; c !== undefined; c = s[i]) {
		if (q === "'") {
			if (c === "'") {
				if (s[i + 1] === "'") {
					out += "'";
					i += 2;
					continue;
				}
				return { ok: true, value: out, end: i + 1 };
			}
			out += c;
			i++;
			continue;
		}
		if (c === '"') {
			return { ok: true, value: out, end: i + 1 };
		}
		if (c === "\\") {
			const e = s.slice(i + 1, i + 2);
			if (e === "u" && /^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6))) {
				out += String.fromCharCode(Number.parseInt(s.slice(i + 2, i + 6), 16));
				i += 6;
				continue;
			}
			// `e` is one character, so it never names an Object.prototype member.
			const escaped = ESCAPES[e];
			if (escaped !== undefined) {
				out += escaped;
				i += 2;
				continue;
			}
			return bad(`unknown escape "\\${e}" in a double-quoted string`);
		}
		out += c;
		i++;
	}
	return bad("unterminated quoted string");
}

function parseInlineList(s: string): ScalarResult {
	const items: unknown[] = [];
	let i = 1;
	const skip = () => {
		while (s[i] === " " || s[i] === "\t") {
			i++;
		}
	};
	skip();
	if (s[i] === "]") {
		i++;
	} else {
		for (;;) {
			skip();
			if (i >= s.length) {
				return bad('inline list is not closed with "]"');
			}
			if (s[i] === '"' || s[i] === "'") {
				const r = readQuoted(s, i);
				if (!r.ok) {
					return r;
				}
				items.push(r.value);
				i = r.end;
			} else {
				let j = i;
				while (j < s.length && s[j] !== "," && s[j] !== "]") {
					j++;
				}
				const plain = s.slice(i, j).trim();
				if (plain === "") {
					return bad("empty item in inline list");
				}
				if (/[[\]{}]/.test(plain)) {
					return bad("nested lists and maps are not supported in inline lists");
				}
				items.push(typed(plain));
				i = j;
			}
			skip();
			if (s[i] === ",") {
				i++;
				continue;
			}
			if (s[i] === "]") {
				i++;
				break;
			}
			return bad('expected "," or "]" in inline list');
		}
	}
	if (!isCommentOrEmpty(s.slice(i))) {
		return bad("unexpected text after the inline list");
	}
	return { ok: true, value: items };
}

function stripComment(s: string): string {
	const m = /(^|[ \t])#/.exec(s);
	return (m ? s.slice(0, m.index) : s).trim();
}

function isCommentOrEmpty(s: string): boolean {
	const t = s.trim();
	return t === "" || t[0] === "#";
}

function leading(line: string): string {
	return line.slice(0, line.search(/[^ \t]|$/));
}

function bad(message: string): { ok: false; message: string } {
	return { ok: false, message };
}
