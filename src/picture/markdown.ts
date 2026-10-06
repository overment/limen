type ListItem = { text: string; line: number; children: ListBlock | null };
type ListBlock = { type: "list"; ordered: boolean; start: number; items: ListItem[]; line: number };
type Block =
	| ListBlock
	| { type: "heading"; level: number; text: string; line: number }
	| { type: "code"; lang: string; text: string; line: number }
	| { type: "para"; text: string; line: number };
// Safe markdown → HTML for node, edge and plant bodies (architecture-map/1).
// Model bodies and summaries share this safe renderer.
//
// Supported: headings (# and ## → h2, ### → h3, #### and deeper → h4),
// paragraphs, unordered/ordered lists with one nesting level, fenced code,
// inline code, **bold**, *italic*, links with http(s) or relative targets.
// Everything else, raw HTML included, is escaped text. Output never contains
// markup that did not come from this renderer.

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;

/** @param {string} md */
export function renderMarkdown(md: string): string {
	return renderBlocks(parseBlocks(md));
}

export function proseBlocks(md: string, firstLine = 1): { text: string; line: number }[] {
	const out: { text: string; line: number }[] = [];
	const visitList = (list: ListBlock): void => {
		for (const it of list.items) {
			if (it.text.trim()) {
				out.push({ text: it.text, line: it.line + firstLine - 1 });
			}
			if (it.children) {
				visitList(it.children);
			}
		}
	};
	for (const b of parseBlocks(md)) {
		if (b.type === "para") {
			out.push({ text: b.text, line: b.line + firstLine - 1 });
		} else if (b.type === "list") {
			visitList(b);
		}
	}
	return out;
}

function parseBlocks(md: string): Block[] {
	const lines = String(md).replace(/\r\n?/g, "\n").split("\n");
	const blocks: Block[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i]!;
		if (line.trim() === "") {
			i++;
			continue;
		}
		const fence = FENCE_OPEN.exec(line);
		if (fence) {
			i = readFence(lines, i, fence, blocks);
			continue;
		}
		const h = HEADING.exec(line);
		if (h) {
			blocks.push({ type: "heading", level: h[1]!.length, text: h[2] ?? "", line: i + 1 });
			i++;
			continue;
		}
		const li = LIST_ITEM.exec(line);
		if (li && li[1]!.length <= 3) {
			i = readList(lines, i, blocks);
			continue;
		}
		const start = i;
		const text: string[] = [];
		while (i < lines.length) {
			const l = lines[i]!;
			if (l.trim() === "" || FENCE_OPEN.test(l) || HEADING.test(l)) {
				break;
			}
			const m = LIST_ITEM.exec(l);
			if (m && m[1]!.length <= 3 && i > start) {
				break;
			}
			text.push(l.trim());
			i++;
		}
		blocks.push({ type: "para", text: text.join("\n"), line: start + 1 });
	}
	return blocks;
}

function readFence(lines: string[], i: number, fence: RegExpExecArray, blocks: Block[]): number {
	const marker = fence[1]!;
	const close = new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}[ \\t]*$`);
	const body: string[] = [];
	let j = i + 1;
	while (j < lines.length && !close.test(lines[j]!)) {
		body.push(lines[j++]!);
	}
	blocks.push({ type: "code", lang: fence[2]!.replace(/[^A-Za-z0-9_+-]/g, ""), text: body.join("\n"), line: i + 1 });
	return j + 1;
}

function readList(lines: string[], i: number, blocks: Block[]): number {
	const first = LIST_ITEM.exec(lines[i]!)!;
	const base = first[1]!.length;
	const ordered = /\d/.test(first[2]!);
	const list: ListBlock = {
		type: "list",
		ordered,
		start: ordered ? Number.parseInt(first[2]!, 10) : 1,
		items: [],
		line: i + 1,
	};
	let target: ListItem | null = null; // item that receives continuation lines
	let blank = false;
	while (i < lines.length) {
		const line = lines[i]!;
		if (line.trim() === "") {
			blank = true;
			i++;
			continue;
		}
		const ind = /^ */.exec(line)![0].length;
		if (FENCE_OPEN.test(line) || (ind <= base + 1 && HEADING.test(line))) {
			break;
		}
		const m = LIST_ITEM.exec(line);
		if (m && m[1]!.length <= base + 1) {
			if (/\d/.test(m[2]!) !== ordered) {
				break;
			}
			target = { text: m[3] ?? "", line: i + 1, children: null };
			list.items.push(target);
		} else if (m && list.items.length > 0) {
			const parent = list.items[list.items.length - 1]!;
			if (!parent.children) {
				const nestedOrdered = /\d/.test(m[2]!);
				parent.children = {
					type: "list",
					ordered: nestedOrdered,
					start: nestedOrdered ? Number.parseInt(m[2]!, 10) : 1,
					items: [],
					line: i + 1,
				};
			}
			target = { text: m[3] ?? "", line: i + 1, children: null };
			parent.children.items.push(target);
		} else if (target && (ind > base || !blank)) {
			target.text += `\n${line.trim()}`;
		} else {
			break;
		}
		blank = false;
		i++;
	}
	blocks.push(list);
	return i;
}

function renderBlocks(blocks: Block[]): string {
	let html = "";
	for (const b of blocks) {
		if (b.type === "heading") {
			const n = Math.min(4, Math.max(2, b.level));
			html += `<h${n}>${renderInline(b.text)}</h${n}>`;
		} else if (b.type === "code") {
			html += `<pre><code${b.lang ? ` class="language-${b.lang}"` : ""}>${escapeHtml(b.text)}</code></pre>`;
		} else if (b.type === "para") {
			html += `<p>${renderInline(b.text)}</p>`;
		} else {
			html += renderList(b);
		}
	}
	return html;
}

function renderList(list: ListBlock): string {
	const tag = list.ordered ? "ol" : "ul";
	const start = list.ordered && list.start !== 1 ? ` start="${list.start}"` : "";
	let html = `<${tag}${start}>`;
	for (const it of list.items) {
		html += `<li>${renderInline(it.text)}${it.children ? renderList(it.children) : ""}</li>`;
	}
	return `${html}</${tag}>`;
}

/** Inline markdown → HTML. Text is escaped; only generated tags survive. */
export function renderInline(text: string): string {
	const src = String(text).replace(/[\uE000\uE001]/g, "");
	const slots: string[] = [];
	const put = (html: string) => `\uE000${slots.push(html) - 1}\uE001`;
	let out = "";
	let i = 0;
	while (i < src.length) {
		const c = src[i];
		if (c === "\\" && i + 1 < src.length && /[!-/:-@[-`{-~]/.test(src[i + 1]!)) {
			out += put(escapeHtml(src[i + 1]!));
			i += 2;
			continue;
		}
		if (c === "`") {
			let n = 1;
			while (src[i + n] === "`") {
				n++;
			}
			const close = findCodeClose(src, i + n, n);
			if (close < 0) {
				out += put(escapeHtml(src.slice(i, i + n)));
				i += n;
				continue;
			}
			let code = src.slice(i + n, close).replace(/\n/g, " ");
			if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim()) {
				code = code.slice(1, -1);
			}
			out += put(`<code>${escapeHtml(code)}</code>`);
			i = close + n;
			continue;
		}
		if (c === "[") {
			const link = matchLink(src, i);
			if (link) {
				if (isSafeHref(link.url)) {
					const rel = /^https?:/i.test(link.url) ? ' rel="noopener noreferrer"' : "";
					const title = link.title ? ` title="${escapeHtml(link.title)}"` : "";
					out += put(`<a href="${escapeHtml(link.url)}"${title}${rel}>${renderInline(link.text)}</a>`);
				} else {
					out += put(escapeHtml(src.slice(i, link.end)));
				}
				i = link.end;
				continue;
			}
		}
		out += c;
		i++;
	}
	out = escapeHtml(out)
		.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
		.replace(/(^|[^A-Za-z0-9_])__(?=\S)([\s\S]*?\S)__(?![A-Za-z0-9_])/g, "$1<strong>$2</strong>")
		.replace(/\*(?=[^\s*])([\s\S]*?[^\s*])\*/g, "<em>$1</em>")
		.replace(/(^|[^A-Za-z0-9_])_(?=[^\s_])([\s\S]*?[^\s_])_(?![A-Za-z0-9_])/g, "$1<em>$2</em>")
		.replace(/\n/g, " ");
	return out.replace(/\uE000(\d+)\uE001/g, (_, k) => slots[Number(k)]!);
}

function findCodeClose(src: string, from: number, n: number): number {
	let i = from;
	while (i < src.length) {
		if (src[i] !== "`") {
			i++;
			continue;
		}
		let m = 0;
		while (src[i + m] === "`") {
			m++;
		}
		if (m === n) {
			return i;
		}
		i += m;
	}
	return -1;
}

/** Inline markdown → plain text (markup removed, entities decoded). */
export function inlineText(text: string): string {
	return renderInline(text)
		.replace(/<[^>]*>/g, "")
		.replace(
			/&(lt|gt|quot|#39|amp);/g,
			(_, e) => (({ lt: "<", gt: ">", quot: '"', "#39": "'", amp: "&" }) as Record<string, string>)[e]!,
		);
}

function matchLink(src: string, i: number): { text: string; url: string; title: string; end: number } | null {
	let depth = 0;
	let j = i;
	for (; j < src.length; j++) {
		if (src[j] === "\\") {
			j++;
			continue;
		}
		if (src[j] === "[") {
			depth++;
		} else if (src[j] === "]" && --depth === 0) {
			break;
		}
	}
	if (j >= src.length || src[j + 1] !== "(") {
		return null;
	}
	const m = /^\(([^\s()]+(?:\([^\s()]*\)[^\s()]*)*)(?:[ \t]+"([^"]*)")?\)/.exec(src.slice(j + 1));
	if (!m) {
		return null;
	}
	return { text: src.slice(i + 1, j), url: m[1]!, title: m[2] ?? "", end: j + 1 + m[0].length };
}

/** http(s) URLs and relative references only; no other scheme, no `//host`, no controls. */
export function isSafeHref(url: string): boolean {
	if (!url || /[\x00-\x20\x7f\\]/.test(url)) {
		return false;
	}
	if (/^https?:\/\/./i.test(url)) {
		return true;
	}
	if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(url)) {
		return false;
	}
	return !url.startsWith("//");
}

export function escapeHtml(s: string): string {
	return String(s).replace(
		/[&<>"']/g,
		(c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }) as Record<string, string>)[c]!,
	);
}
