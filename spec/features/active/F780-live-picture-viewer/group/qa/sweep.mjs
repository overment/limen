#!/usr/bin/env node
// Run after: npm install --prefix /tmp/f780-team-5 --no-save playwright
// Usage: node spec/features/active/F780-live-picture-viewer/group/qa/sweep.mjs page.html model.json
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "/tmp/f780-team-5/node_modules/playwright/index.mjs";

const [htmlPath, modelPath] = process.argv.slice(2);
if (!htmlPath || !modelPath) {
	console.error("Usage: node group/qa/sweep.mjs page.html model.json");
	process.exit(2);
}
const model = JSON.parse(await readFile(resolve(modelPath), "utf8"));
if (model.schema !== "architecture-map-model/3") {
	console.error(`Expected architecture-map-model/3, got ${model.schema}`);
	process.exit(2);
}
const base = pathToFileURL(resolve(htmlPath)).href;
const nodes = new Map(model.nodes.map((node) => [node.id, node]));
const work = new Map((model.work || []).map((item) => [item.id, item]));
const features = new Map(model.features.map((item) => [item.id, item]));
const linkedFeatures = new Set(model.work.map((item) => item.mapFeature).filter(Boolean));
const standaloneFeatures = new Map([...features].filter(([id]) => !linkedFeatures.has(id)));
const journeys = new Map(model.journeys.map((item) => [item.id, item]));
const days = new Map(model.days.map((day) => [day.date, day]));
const isPlace = (node) => Boolean(node && (node.parent || !node.children.length));
const isModule = (node) => Boolean(node && !node.parent);
const encode = encodeURIComponent;
const route = (hash, title, level = "mid") => ({ hash, title, level });
const routes = [route("#plant", model.project.title, "plant")];
for (const tab of ["work", "journeys", "days", "places"])
	routes.push(route(`#plant/${tab}`, model.project.title, "plant"));
for (const item of model.work) {
	routes.push(route(`#work/${encode(item.id)}`, item.title));
	const evidenceCount = 1 + Number(Boolean(item.board)) + Number(Boolean(item.mapFeature));
	for (let n = 0; n < evidenceCount; n++)
		routes.push(route(`#work/${encode(item.id)}/evidence/${n}`, item.title, "deep"));
	for (const place of item.touches) {
		if (isPlace(nodes.get(place)))
			routes.push(route(`#place/${encode(place)}/via/work/${encode(item.id)}`, nodes.get(place).title));
	}
}
for (const item of standaloneFeatures.values()) routes.push(route(`#work/${encode(item.id)}`, item.title));
for (const node of model.nodes) {
	if (isModule(node)) routes.push(route(`#module/${encode(node.id)}`, node.title));
	if (isPlace(node)) routes.push(route(`#place/${encode(node.id)}`, node.title));
}
for (const item of model.journeys) {
	routes.push(route(`#journey/${encode(item.id)}`, item.title));
	for (let n = 1; n <= item.steps.length; n++)
		routes.push(
			route(`#journey/${encode(item.id)}/step/${n}`, nodes.get(item.steps[n - 1])?.title || item.title, "deep"),
		);
}
for (const day of model.days) routes.push(route(`#day/${encode(day.date)}`, day.date));
const uniqueRoutes = [...new Map(routes.map((item) => [item.hash, item])).values()];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const failures = [];
let checkedLinks = 0;
let pageScroll = 0;
const fail = (hash, test, got) => failures.push(`${hash} ${test}: ${String(got).slice(0, 280)}`);
let currentHash = "#plant";
page.on("pageerror", (error) => fail(currentHash, "browser script error", error.message));
page.on("request", (request) => {
	if (!request.url().startsWith("file:")) fail(currentHash, "external network request", request.url());
});
const relevant = (text, title) => text.includes(title) || text.includes(title.replace(/ \(F\d+\)$/, ""));
function validLink(hash) {
	if (!hash || hash === "#") return false;
	const [baseHash, ...parts] = hash.slice(1).split("~");
	let decoded;
	try {
		decoded = decodeURIComponent(baseHash);
	} catch {
		return false;
	}
	const s = decoded.split("/");
	if (s[0] === "plant") {
		if (s.length > 2 || (s[1] && !["work", "journeys", "days", "places"].includes(s[1]))) return false;
	} else if (s[0] === "work") {
		const item = work.get(s[1]);
		if (!item && !standaloneFeatures.has(s[1])) return false;
		if (
			s.length > 2 &&
			(s[2] !== "evidence" ||
				s.length !== 4 ||
				!item ||
				!Number.isInteger(Number(s[3])) ||
				Number(s[3]) < 0 ||
				Number(s[3]) >= 1 + Number(Boolean(item.board)) + Number(Boolean(item.mapFeature)))
		)
			return false;
	} else if (s[0] === "place") {
		if (!isPlace(nodes.get(s[1]))) return false;
		if (
			s.length > 2 &&
			(s.length !== 5 || s[2] !== "via" || s[3] !== "work" || !work.get(s[4])?.touches.includes(s[1]))
		)
			return false;
	} else if (s[0] === "module") {
		if (s.length !== 2 || !isModule(nodes.get(s[1]))) return false;
	} else if (s[0] === "journey") {
		const item = journeys.get(s[1]);
		if (
			!item ||
			(s.length > 2 &&
				(s.length !== 4 ||
					s[2] !== "step" ||
					!Number.isInteger(Number(s[3])) ||
					Number(s[3]) < 1 ||
					Number(s[3]) > item.steps.length))
		)
			return false;
	} else if (s[0] === "day") {
		if (s.length !== 2 || !days.has(s[1])) return false;
	} else return false;
	for (const segment of parts) {
		let kind, id;
		try {
			[kind, id] = decodeURIComponent(segment).split("/");
		} catch {
			return false;
		}
		if (
			!id ||
			!{
				work: work.has(id) || features.has(id),
				place: nodes.has(id),
				module: nodes.has(id),
				journey: journeys.has(id),
				day: days.has(id),
			}[kind]
		)
			return false;
	}
	return true;
}
try {
	currentHash = "#plant";
	for (const item of uniqueRoutes) {
		currentHash = item.hash;
		await page.goto(`${base}${item.hash}`, { waitUntil: "load" });
		const seen = await page.evaluate(() => ({
			hash: location.hash,
			read: document.querySelector("#read")?.innerText || "",
			page: document.body.innerText,
			mid: Boolean(document.querySelector("#read .entry.open .mid")),
			openKey: document.querySelector("#read .entry.open > .row")?.dataset.key,
			deep: Boolean(document.querySelector("#read #deep")),
			links: [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute("href")),
			scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
		}));
		if (decodeURI(seen.hash).split("~")[0] !== decodeURI(item.hash)) fail(item.hash, "reload route changed", seen.hash);
		if (item.hash.startsWith("#day/")) {
			if (seen.openKey !== `day:${item.hash.slice(5)}`) fail(item.hash, "wrong day opened", seen.openKey);
		} else if (item.level !== "plant" && !relevant(seen.read, item.title))
			fail(item.hash, "target absent from reading column", item.title);
		if (item.level === "mid" && !seen.mid) fail(item.hash, "target did not open", "missing #read .entry.open .mid");
		if (item.level === "deep" && !seen.deep) fail(item.hash, "deep target did not open", "missing #read #deep");
		const badText = seen.page.match(/\b(?:undefined|null|NaN)\b/);
		if (badText) fail(item.hash, "invalid visible text", badText[0]);
		if (seen.scroll > 1) fail(item.hash, "horizontal overflow at 1440px", seen.scroll);
		for (const href of seen.links) {
			checkedLinks++;
			if (!validLink(href)) fail(item.hash, "broken in-page link", href);
		}
	}
	// A shared deep link must rebuild history one layer at a time. Each depth survives reload.
	const firstWork = model.work.find((w) => w.touches.some((id) => isPlace(nodes.get(id))));
	const secondWork = model.work.find((w) => w.id !== firstWork?.id);
	if (!firstWork || !secondWork) fail("#plant", "layer fixtures absent", "need two work items and one touched place");
	else {
		const firstPlace = firstWork.touches.find((id) => isPlace(nodes.get(id)));
		const segments = [`work/${encode(firstWork.id)}`, `place/${encode(firstPlace)}`, `work/${encode(secondWork.id)}`];
		for (let n = 1; n <= 3; n++) {
			const hash = `#plant~${segments.slice(0, n).join("~")}`;
			await page.goto(`${base}${hash}`, { waitUntil: "load" });
			const state = await page.evaluate(() => ({
				hash: location.hash,
				layerCount: document.querySelectorAll('.layers-root [role="dialog"]').length,
				overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
				scroll: window.scrollY,
			}));
			if (decodeURI(state.hash) !== decodeURI(hash)) fail(hash, "layer reload changed route", state.hash);
			if (state.layerCount !== n) fail(hash, "layer depth", state.layerCount);
			if (state.overflow > 1) fail(hash, "horizontal overflow with layer", state.overflow);
			await page.keyboard.press("Escape");
			await page.waitForTimeout(180);
			const escaped = await page.evaluate(() => location.hash);
			const expected = `#plant${n > 1 ? `~${segments.slice(0, n - 1).join("~")}` : ""}`;
			if (decodeURI(escaped) !== decodeURI(expected)) fail(hash, "Esc should close only top layer", escaped);
			if (n === 1) {
				const focus = await page.evaluate(() => {
					const el = document.activeElement;
					const style = getComputedStyle(el);
					return {
						node: el?.outerHTML.slice(0, 110),
						visible: el?.matches(":focus-visible"),
						marked: style.outlineStyle !== "none" || style.boxShadow !== "none",
					};
				});
				if (!focus.visible || !focus.marked)
					fail(hash, "closing a restored layer lost visible focus", JSON.stringify(focus));
			}
			await page.goto(`${base}${hash}`, { waitUntil: "load" });
			await page.goBack();
			const backed = await page.evaluate(() => location.hash);
			if (decodeURI(backed) !== decodeURI(expected)) fail(hash, "Back should close only top layer", backed);
		}
		const fullHash = `#plant~${segments.join("~")}`;
		await page.goto(`${base}${fullHash}`, { waitUntil: "load" });
		const trail = page.locator('.layers-root [data-layer-jump="1"]');
		if (!(await trail.count())) fail(fullHash, "stack trail depth 1 missing", '.layers-root [data-layer-jump="1"]');
		else {
			await trail.first().click();
			const jumped = await page.evaluate(() => location.hash);
			if (decodeURI(jumped) !== decodeURI(`#plant~${segments[0]}`)) fail(fullHash, "trail depth 1 jump", jumped);
		}
		const pageTrail = page.locator('.layers-root [data-layer-jump="0"]');
		if (!(await pageTrail.count()))
			fail(fullHash, "stack trail Page link missing", '.layers-root [data-layer-jump="0"]');
		else {
			await pageTrail.first().click();
			const jumpedHome = await page.evaluate(() => location.hash);
			if (jumpedHome !== "#plant") fail(fullHash, "trail Page jump", jumpedHome);
		}
		await page.goto(`${base}#plant~${segments[0]}`, { waitUntil: "load" });
		const before = await page.evaluate(() => ({
			hash: location.hash,
			scroll: window.scrollY,
			active: document.activeElement?.tagName,
		}));
		await page.keyboard.press("ArrowRight");
		const after = await page.evaluate(() => ({ hash: location.hash, scroll: window.scrollY }));
		if (after.hash === before.hash) fail(before.hash, "ArrowRight did not change layer context", after.hash);
		if (after.hash.split("~").length !== 2 || after.scroll !== before.scroll)
			fail(before.hash, "context switch changed stack or page scroll", JSON.stringify(after));
	}
	// Click an actual entry instead of only constructing hashes: the page behind must not move.
	if (firstWork) {
		const hash = `#work/${encode(firstWork.id)}`;
		await page.goto(`${base}${hash}`, { waitUntil: "load" });
		const opener = page.locator(`[data-layer="work/${firstWork.id}"]`);
		if (!(await opener.count())) fail(hash, "open-as-layer control missing", `data-layer=work/${firstWork.id}`);
		else {
			await opener.first().scrollIntoViewIfNeeded();
			const before = await page.evaluate(() => ({
				scroll: window.scrollY,
				width: document.body.getBoundingClientRect().width,
			}));
			await opener.first().click();
			const opened = await page.evaluate(() => ({
				scroll: window.scrollY,
				width: document.body.getBoundingClientRect().width,
				locked: document.documentElement.classList.contains("layers-open"),
				inert: [...document.body.children]
					.filter((el) => !el.classList.contains("layers-root"))
					.every((el) => el.inert),
				focused: Boolean(document.activeElement?.closest(".layers-root")),
			}));
			if (
				!opened.locked ||
				!opened.inert ||
				!opened.focused ||
				opened.scroll !== before.scroll ||
				Math.abs(opened.width - before.width) > 1
			)
				fail(hash, "opening layer moved or left page active", JSON.stringify({ before, opened }));
			await page.keyboard.press("Escape");
			if ((await page.evaluate(() => window.scrollY)) !== before.scroll)
				fail(hash, "closing layer moved page", await page.evaluate(() => window.scrollY));
		}
	}
	// Open from a page with no hash, reload, then close the last layer: the bare entry is the plant, so the page must not redraw.
	{
		await page.goto(base, { waitUntil: "load" });
		await page.evaluate(() => window.scrollTo(0, 300));
		const before = await page.evaluate(() => window.scrollY);
		const pin = page.locator("#mast [data-layer]").last();
		if (!(await pin.count())) fail("(no hash)", "pin layer control missing", "#mast [data-layer]");
		else {
			await pin.click();
			await page.reload({ waitUntil: "load" });
			await page.keyboard.press("Escape");
			const closed = await page.evaluate(() => ({
				hash: location.hash,
				scroll: window.scrollY,
				focus: document.activeElement?.tagName,
			}));
			if (closed.scroll !== before || closed.focus === "BODY")
				fail("(no hash)", "closing the last layer after a reload redrew the page", JSON.stringify({ before, closed }));
		}
	}
	await page.goto(`${base}#plant`, { waitUntil: "load" });
	const order = [];
	for (let n = 0; n < 3; n++) {
		await page.keyboard.press("Tab");
		order.push(
			await page.evaluate(() => ({
				node: document.activeElement?.outerHTML.slice(0, 120),
				visible: document.activeElement?.matches(":focus-visible"),
				outline: getComputedStyle(document.activeElement).outlineStyle,
			})),
		);
	}
	if (new Set(order.map((x) => x.node)).size < 3 || order.some((x) => !x.visible || x.outline === "none"))
		fail("#plant", "Tab order or visible focus", JSON.stringify(order));
	await page.keyboard.press("/");
	if ((await page.evaluate(() => document.activeElement?.id)) !== "filter")
		fail(
			"#plant",
			"/ did not focus list filter",
			await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 150)),
		);
	await page.keyboard.press("Escape");
	if ((await page.evaluate(() => document.activeElement?.id)) === "filter")
		fail("#plant", "Esc did not release filter", "filter still focused");
	for (const width of [1440, 1240, 900]) {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(`${base}#plant`, { waitUntil: "load" });
		const x = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
		if (x > 1) fail("#plant", `horizontal overflow at ${width}px`, x);
		if (firstWork) {
			const layerHash = `#plant~work/${encode(firstWork.id)}`;
			currentHash = layerHash;
			await page.goto(`${base}${layerHash}`, { waitUntil: "load" });
			const layerOverflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			);
			if (layerOverflow > 1) fail(layerHash, `horizontal overflow with layer at ${width}px`, layerOverflow);
		}
	}
	if (firstWork) {
		currentHash = "#plant";
		await page.goto(`${base}#plant`, { waitUntil: "load" });
		const pageY = await page.evaluate(() => {
			window.scrollTo(0, 700);
			return window.scrollY;
		});
		pageScroll = pageY;
		if (pageY < 600) fail("#plant", "900px page cannot exercise scroll restoration", pageY);
		else {
			const layerHash = `#plant~work/${encode(firstWork.id)}`;
			currentHash = layerHash;
			await page.evaluate((id) => PictureLayers.open("work", id), firstWork.id);
			if ((await page.evaluate(() => window.scrollY)) !== pageY)
				fail(layerHash, "opening layer lost page position", await page.evaluate(() => window.scrollY));
			await page.reload({ waitUntil: "load" });
			if ((await page.evaluate(() => window.scrollY)) !== pageY)
				fail(layerHash, "reload lost page position", await page.evaluate(() => window.scrollY));
			await page.goBack();
			if ((await page.evaluate(() => window.scrollY)) !== pageY)
				fail(layerHash, "Back lost page position", await page.evaluate(() => window.scrollY));
		}
	}
} finally {
	await browser.close();
}
console.log(
	`routes=${uniqueRoutes.length} checked_links=${checkedLinks} layer_depths=3 scroll_y=${pageScroll} widths=1440,1240,900 failures=${failures.length}`,
);
for (const message of failures) console.error(`FAIL ${message}`);
process.exitCode = failures.length ? 1 : 0;
