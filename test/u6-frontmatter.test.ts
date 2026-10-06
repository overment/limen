// U6: the hand-written front matter parser and the Markdown renderer read untrusted ticket and map files.
// Malformed lines are reported at their line without overwriting good values; prototype keys stay plain data;
// raw HTML and executable links never reach the page.
import assert from "node:assert/strict";
import test from "node:test";
import { parseFrontmatter } from "../src/picture/frontmatter.ts";
import { renderMarkdown } from "../src/picture/markdown.ts";

test("malformed lines are reported at their own line and never overwrite the first good value", () => {
	const parsed = parseFrontmatter(
		'\uFEFF---\r\nid: first\r\ntitle: "open\r\nlist: [a, [b]]\r\nid: second\r\nsources:\r\n  - good\r\n   - misplaced\r\nlast: kept\r\n---\r\nBody\r\n',
	);
	assert.equal(parsed.ok, true);
	assert.deepEqual(parsed.data, { id: "first", sources: ["good"], last: "kept" });
	assert.deepEqual(
		parsed.errors.map((error) => error.line),
		[3, 4, 5, 8],
	);
	assert.deepEqual([parsed.body, parsed.bodyLine], ["Body\n", 11]);
});

test("a file without a closed front matter block fails at line 1", () => {
	for (const text of ["no fence", "---\nid: unclosed", ""]) {
		const parsed = parseFrontmatter(text);
		assert.deepEqual([parsed.ok, parsed.errors[0]?.line], [false, 1], JSON.stringify(text));
	}
});

test("quoted lists keep their commas and quotes; prototype keys are ordinary data", () => {
	const parsed = parseFrontmatter(
		"---\n__proto__: literal\nsources: [\"a, b\", 'it''s a path']\nitems:\n  - __proto__: item\n    title: \"A: B\"\n---\n",
	);
	assert.deepEqual(parsed.errors, []);
	assert.deepEqual(parsed.data.sources, ["a, b", "it's a path"]);
	assert.equal(Object.getPrototypeOf(parsed.data), Object.prototype);
	assert.equal(Object.hasOwn(parsed.data, "__proto__"), true);
	assert.deepEqual(parsed.data.items, [JSON.parse('{"__proto__":"item","title":"A: B"}')]);
});

test("Markdown escapes raw HTML and drops executable links but keeps safe links and formatting", () => {
	const html = renderMarkdown(
		'<img src=x onerror="alert(1)">\n\n[a](javascript:alert) [b](JaVaScRiPt:alert) [c](data:text/html,evil) [d](vbscript:x) [safe](https://example.com)\n\n**Strong** and `code`.\n\n```html\n<script>alert(1)</script>\n```',
	);
	assert.doesNotMatch(html, /<img|<script|href=["']?\s*(?:javascript|data|vbscript):/i);
	assert.match(html, /&lt;img/);
	assert.match(html, /&lt;script&gt;/);
	assert.match(html, /href="https:\/\/example\.com"/);
	assert.match(html, /<strong>Strong<\/strong> and <code>code<\/code>/);
});
