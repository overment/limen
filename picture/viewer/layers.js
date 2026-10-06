/* Stacked layers over the picture page.
   The URL holds the whole stack: base ('~' kind '/' id)*. The base belongs to viewer.js.
   One open is one history entry, so browser Back and Esc both close the top layer.
   A context switch (previous or next item) replaces the top entry and adds none.
   Layer bodies render from the embedded model (architecture-map-model/3).
   viewer.js calls PictureLayers.init({ model, onChange }) once after its first render. */
(() => {
	"use strict";

	const KINDS = ["work", "place", "module", "day", "journey"];
	const NOUNS = {
		work: ["feature", "features"],
		feature: ["map feature", "map features"],
		place: ["place", "places"],
		module: ["module", "modules"],
		day: ["day", "days"],
		journey: ["journey", "journeys"],
	};
	const LANES = { planned: "Planned", active: "Active", done: "Done", dropped: "Dropped" };
	const DAY_KINDS = { opened: "Opened", landed: "Landed", "needs-adam": "Needs Adam", wrong: "Wrong" };
	const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	const esc = (s) =>
		String(s ?? "").replace(
			/[&<>"']/g,
			(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
		);
	const enc = (id) => encodeURIComponent(id).replace(/~/g, "%7E");
	const same = (a, b) => a.kind === b.kind && a.id === b.id;
	const keyOf = (layer) => `${layer.kind}/${layer.id}`;
	const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
	const word = (s) => String(s ?? "").toLowerCase();
	const capital = (s) => word(s).replace(/^./, (c) => c.toUpperCase());
	// "6 Oct", like the pins and the column; the year only when it differs from the build year (from the model, not the clock).
	const date = (iso) => {
		const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
		if (!m) {
			return String(iso ?? "");
		}
		return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}${index?.year === m[1] ? "" : ` ${m[1]}`}`;
	};

	/* URL: split a hash into the page route and the layer stack, and join it back. */
	function split(hash) {
		const parts = String(hash ?? "")
			.replace(/^#/, "")
			.split("~");
		const layers = [];
		for (const part of parts.slice(1)) {
			const at = part.indexOf("/");
			const kind = part.slice(0, at);
			if (at < 1 || !KINDS.includes(kind)) {
				continue;
			}
			let id = "";
			try {
				id = decodeURIComponent(part.slice(at + 1));
			} catch {
				continue;
			}
			if (id) {
				layers.push({ kind, id });
			}
		}
		return { base: `#${parts[0] || "plant"}`, layers };
	}
	const join = (base, layers) => base + layers.map((layer) => `~${layer.kind}/${enc(layer.id)}`).join("");

	/* Model lookups. A place is a child node or a top module with no children; a module is a top node. */
	const ticketNumber = (w) => Number(String(w.code ?? "").replace(/\D/g, "")) || 0;
	function lanesOf(work) {
		const lanes = new Map();
		for (const w of [...work].sort((a, b) => ticketNumber(b) - ticketNumber(a))) {
			if (!lanes.has(w.lane)) {
				lanes.set(w.lane, []);
			}
			lanes.get(w.lane).push(w);
		}
		return lanes;
	}
	let index = null;
	function build(model) {
		const nodes = new Map((model.nodes ?? []).map((n) => [n.id, n]));
		const isPlace = (n) => Boolean(n.parent) || !(n.children ?? []).length;
		return {
			model,
			nodes,
			isPlace,
			work: new Map((model.work ?? []).map((w) => [w.id, w])),
			lanes: lanesOf(model.work ?? []),
			year: String(model.generatedAt ?? "").slice(0, 4),
			features: new Map((model.features ?? []).map((f) => [f.id, f])),
			days: new Map((model.days ?? []).map((d) => [d.date, d])),
			journeys: new Map((model.journeys ?? []).map((j) => [j.id, j])),
			places: [...nodes.values()].filter(isPlace).map((n) => n.id),
			modules: [...nodes.values()].filter((n) => !n.parent).map((n) => n.id),
		};
	}
	function find(kind, id) {
		if (!index) {
			return null;
		}
		if (kind === "work") {
			return index.work.get(id) ?? index.features.get(id) ?? null;
		}
		if (kind === "place") {
			const n = index.nodes.get(id);
			return n && index.isPlace(n) ? n : null;
		}
		if (kind === "module") {
			const n = index.nodes.get(id);
			return n && !n.parent ? n : null;
		}
		if (kind === "day") {
			return index.days.get(id) ?? null;
		}
		if (kind === "journey") {
			return index.journeys.get(id) ?? null;
		}
		return null;
	}
	// Context switch siblings. Work: the same lane, newest ticket first, like the decide column. Map features, places,
	// modules and journeys: model order, as the atlas lists them. Days: newest first, as the model lists them.
	function siblings(layer) {
		if (layer.kind === "work") {
			const w = index.work.get(layer.id);
			return w ? (index.lanes.get(w.lane) ?? [w]).map((other) => other.id) : [...index.features.keys()];
		}
		if (layer.kind === "place") {
			return index.places;
		}
		if (layer.kind === "module") {
			return index.modules;
		}
		if (layer.kind === "day") {
			return [...index.days.keys()];
		}
		return [...index.journeys.keys()];
	}
	const noun = (layer) => NOUNS[layer.kind === "work" && !index.work.has(layer.id) ? "feature" : layer.kind];
	// "3 of 22 active features", "5 of 18 places".
	function count(layer) {
		const all = siblings(layer);
		const [one, many] = noun(layer);
		const lane = layer.kind === "work" ? word(index.work.get(layer.id)?.lane) : "";
		return `${all.indexOf(layer.id) + 1} of ${all.length} ${lane ? `${lane} ` : ""}${all.length === 1 ? one : many}`;
	}
	// A link inside a layer names a base route; turn it into a layer when it names an item.
	function target(href) {
		const s = split(href).base.slice(1).split("/");
		let id = "";
		try {
			id = decodeURIComponent(s[1] ?? "");
		} catch {
			return null;
		}
		return KINDS.includes(s[0]) && find(s[0], id) ? { kind: s[0], id } : null;
	}

	/* Layer bodies. Every link is a base route; a click inside a layer opens it as the next layer. */
	const link = (kind, id, text) => `<a href="#${kind}/${enc(id)}">${esc(text)}</a>`;
	const nodeLink = (id) => {
		const n = index.nodes.get(id);
		if (!n) {
			return `<span>${esc(id)}</span>`;
		}
		return link(index.isPlace(n) ? "place" : "module", id, n.title || id);
	};
	const workName = (w) => (w.code ? `${w.code} · ${w.title || ""}` : w.title || w.id);
	const workLink = (id) => {
		const w = index.work.get(id) ?? index.features.get(id);
		return w ? link("work", id, workName(w)) : `<span>${esc(id)}</span>`;
	};
	const section = (title, body) => (body ? `<section class="layer-part"><h3>${esc(title)}</h3>${body}</section>` : "");
	const list = (items) =>
		items.length ? `<ul class="layer-list">${items.map((item) => `<li>${item}</li>`).join("")}</ul>` : "";
	const meta = (text) => (text ? ` <small>${esc(text)}</small>` : "");
	const facts = (rows) => {
		const kept = rows.filter(([, value]) => value);
		return kept.length
			? `<dl class="layer-facts">${kept.map(([name, value]) => `<dt>${esc(name)}</dt><dd>${value}</dd>`).join("")}</dl>`
			: "";
	};
	const flag = (kind, label, on, text) =>
		`<div class="layer-flag ${kind}"><p class="layer-flag-label">${esc(label)}${on ? ` · ${esc(date(on))}` : ""}</p><p>${esc(text)}</p></div>`;
	const moduleTitle = (n) => (n.parent ? (index.nodes.get(n.parent)?.title ?? "") : "");
	const touching = (ids) => [...index.work.values()].filter((w) => (w.touches ?? []).some((t) => ids.includes(t)));
	const featuresTouching = (ids) =>
		[...index.features.values()].filter((f) => (f.touches ?? []).some((t) => ids.includes(t)));
	// "PARKED · PLANNED" reads "Parked · planned"; "PROVEN · PROVEN" reads "Proven".
	const boardText = (b) =>
		word(b.section) === word(b.state) || !b.state ? capital(b.section) : `${capital(b.section)} · ${word(b.state)}`;
	// Journey bodies list one sentence per step; show it under the step when the counts agree.
	function stepNotes(j) {
		if (!j.bodyHtml || typeof document === "undefined") {
			return [];
		}
		const t = document.createElement("template");
		t.innerHTML = j.bodyHtml;
		const notes = [...(t.content?.querySelectorAll("ol > li") ?? [])].map((li) => li.textContent.trim());
		return notes.length === (j.steps ?? []).length ? notes : [];
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: split pending: work layer renderer
	function renderWork(w) {
		const touchNote =
			w.touchSource === "map"
				? "The ticket names no places; these come from the map."
				: w.touchSource === "none"
					? "The ticket names no places yet."
					: "";
		const days = (index.model.days ?? []).flatMap((d) =>
			(d.items ?? [])
				.filter((item) => item.work === w.id)
				.map((item) => `${esc(DAY_KINDS[item.kind] ?? capital(item.kind))} ${link("day", d.date, date(d.date))}`),
		);
		const places = (w.touches ?? []).map(
			(id) => `${nodeLink(id)}${meta(index.nodes.get(id) ? moduleTitle(index.nodes.get(id)) : "")}`,
		);
		const flags = [w.needsAdam ? "Needs Adam" : "", w.wrong ? "Wrong" : ""].filter(Boolean).join(" · ");
		return {
			eyebrow: [w.code ? `Feature ${w.code}` : "Feature", LANES[w.lane] ?? capital(w.lane), flags]
				.filter(Boolean)
				.join(" · "),
			title: w.title || w.code || w.id,
			html:
				(w.needsAdam ? flag("needs", "Needs Adam", w.needsAdam.on, w.needsAdam.ask) : "") +
				(w.wrong ? flag("wrong", "Wrong", w.wrong.on, w.wrong.problem) : "") +
				(w.outcome ? `<p class="layer-lead">${esc(w.outcome)}</p>` : "") +
				facts([
					["On the board", w.board?.section ? esc(boardText(w.board)) : ""],
					["Opened", w.opened ? esc(date(w.opened)) : ""],
					["Landed", w.landed ? esc(date(w.landed)) : ""],
					["Ticket", w.path ? `<code>${esc(w.path)}</code>` : ""],
				]) +
				section(
					"Places it touches",
					places.length
						? (touchNote ? `<p class="layer-note">${esc(touchNote)}</p>` : "") + list(places)
						: `<p class="layer-note">${esc(touchNote || "The ticket names no places yet.")}</p>`,
				) +
				section("Map feature", w.mapFeature && index.features.has(w.mapFeature) ? list([workLink(w.mapFeature)]) : "") +
				section("Days", list(days)),
		};
	}
	function renderFeature(f) {
		const work = [...index.work.values()].filter((w) => w.mapFeature === f.id).map((w) => workLink(w.id));
		return {
			eyebrow: "Map feature",
			title: f.title || f.id,
			html:
				(f.summary ? `<p class="layer-lead">${esc(f.summary)}</p>` : "") +
				section("Places it touches", list((f.touches ?? []).map((id) => nodeLink(id)))) +
				section("Tickets", list(work)),
		};
	}
	function renderPlace(n) {
		const edges = (index.model.edges ?? []).filter((e) => e.from === n.id || e.to === n.id);
		// "<a>X</a> generates this place" or "This place depends on <a>X</a>", with the edge title as small text.
		const verb = (e) => String(e.kind || "connects to").replace(/-/g, " ");
		const lines = edges.map(
			(e) =>
				(e.from === n.id
					? `This place ${esc(verb(e))} ${nodeLink(e.to)}`
					: `${nodeLink(e.from)} ${esc(verb(e))} this place`) + meta(e.title ? `· ${e.title}` : ""),
		);
		const journeys = (index.model.journeys ?? [])
			.filter((j) => (j.steps ?? []).includes(n.id))
			.map((j) => `${link("journey", j.id, j.title || j.id)}${meta(`step ${j.steps.indexOf(n.id) + 1}`)}`);
		return {
			eyebrow: ["Place", moduleTitle(n)].filter(Boolean).join(" · "),
			title: n.title || n.id,
			html:
				(n.summary ? `<p class="layer-lead">${esc(n.summary)}</p>` : "") +
				(n.parent ? facts([["Module", nodeLink(n.parent)]]) : "") +
				section("Work that touches this place", list(touching([n.id]).map((w) => workLink(w.id)))) +
				section("Map features", list(featuresTouching([n.id]).map((f) => workLink(f.id)))) +
				section("Connections", list(lines)) +
				section("Journeys", list(journeys)),
		};
	}
	function renderModule(n) {
		const ids = [n.id, ...(n.children ?? [])];
		return {
			eyebrow: "Module",
			title: n.title || n.id,
			html:
				(n.summary ? `<p class="layer-lead">${esc(n.summary)}</p>` : "") +
				section(
					"Places",
					list((n.children ?? []).map((id) => `${nodeLink(id)}${meta(index.nodes.get(id)?.summary ?? "")}`)),
				) +
				section("Work that touches this module", list(touching(ids).map((w) => workLink(w.id)))),
		};
	}
	function renderDay(d) {
		// Opened and Landed items carry the ticket title, which the link already shows; Needs Adam and Wrong carry the ask or problem.
		const line = (item) =>
			`<span class="layer-kind ${esc(item.kind)}">${esc(DAY_KINDS[item.kind] ?? item.kind)}</span> ${workLink(item.work)}${item.kind === "needs-adam" || item.kind === "wrong" ? meta(item.text) : ""}`;
		return {
			eyebrow: "Day",
			title: date(d.date),
			html: section("What changed", list((d.items ?? []).map(line))),
		};
	}
	function renderJourney(j) {
		const steps = j.steps ?? [];
		const notes = stepNotes(j);
		return {
			eyebrow: "Journey",
			title: j.title || j.id,
			html:
				(j.summary ? `<p class="layer-lead">${esc(j.summary)}</p>` : "") +
				section(
					"Steps",
					steps.length
						? `<ol class="layer-list">${steps.map((id, i) => `<li>${nodeLink(id)}${notes[i] ? `<br><small>${esc(notes[i])}</small>` : ""}</li>`).join("")}</ol>`
						: "",
				),
		};
	}
	function render(layer) {
		const item = find(layer.kind, layer.id);
		if (layer.kind === "work") {
			return index.work.has(layer.id) ? renderWork(item) : renderFeature(item);
		}
		if (layer.kind === "place") {
			return renderPlace(item);
		}
		if (layer.kind === "module") {
			return renderModule(item);
		}
		if (layer.kind === "day") {
			return renderDay(item);
		}
		return renderJourney(item);
	}
	// Trail names. The top layer gets a longer name; lower layers get a short one so three or four fit beside it.
	function label(layer, short = false) {
		const item = find(layer.kind, layer.id);
		if (layer.kind === "day") {
			return date(layer.id);
		}
		if (layer.kind === "work" && item.code) {
			return short ? item.code : `${item.code} · ${cut(item.title || "", 24)}`;
		}
		return cut(item.title || layer.id, short ? 18 : 30);
	}

	/* DOM: one root after the page; the page and the lower layers are inert. */
	let root = null;
	let stack = [];
	let base = "#plant";
	let onChange = null;
	const openers = [];
	const inerted = [];
	function mount() {
		root = document.createElement("div");
		root.className = "layers-root";
		root.hidden = true;
		root.innerHTML = `<div class="layers-scrim" data-layer-close></div><nav class="layers-trail" aria-label="Open items"></nav><div class="layers-stack"></div><p class="layers-live" aria-live="polite"></p>`;
		document.body.append(root);
	}
	function layerElement(layer, depth) {
		const view = render(layer);
		const all = siblings(layer);
		const at = all.indexOf(layer.id);
		const [one] = noun(layer);
		const steps =
			all.length > 1
				? `<button type="button" data-layer-step="-1"${at <= 0 ? " disabled" : ""} title="Previous ${one} (←)">← Previous</button><span class="layer-count">${esc(count(layer))}</span><button type="button" data-layer-step="1"${at >= all.length - 1 ? " disabled" : ""} title="Next ${one} (→)">Next →</button>`
				: "";
		const el = document.createElement("section");
		el.className = "layer";
		el.dataset.key = keyOf(layer);
		el.setAttribute("role", "dialog");
		el.setAttribute("aria-modal", "true");
		el.setAttribute("aria-labelledby", `layer-title-${depth}`);
		el.innerHTML = `<header class="layer-head"><div class="layer-titles"><p class="layer-eyebrow">${esc(view.eyebrow)}</p><h2 id="layer-title-${depth}" tabindex="-1">${esc(view.title)}</h2></div><div class="layer-tools">${steps}<button type="button" class="layer-close" data-layer-close title="Close this layer (Esc)">Close</button></div></header><div class="layer-body">${view.html}</div>`;
		return el;
	}
	function paint(why) {
		const holder = root.querySelector(".layers-stack");
		const shown = [...holder.children];
		let keep = 0;
		while (keep < shown.length && keep < stack.length && shown[keep].dataset.key === keyOf(stack[keep])) {
			keep++;
		}
		for (const el of shown.slice(keep)) {
			el.remove();
		}
		for (let depth = keep; depth < stack.length; depth++) {
			const el = layerElement(stack[depth], depth);
			if (why !== "switch") {
				el.classList.add("entering");
				el.addEventListener("animationend", () => el.classList.remove("entering"), { once: true });
			}
			holder.append(el);
		}
		[...holder.children].forEach((el, depth) => {
			el.inert = depth < stack.length - 1;
			el.style.setProperty("--below", String(stack.length - 1 - depth));
		});
		const crumbs = [`<button type="button" data-layer-jump="0">Page</button>`].concat(
			stack.map((layer, depth) =>
				depth === stack.length - 1
					? `<span aria-current="location">${esc(label(layer))}</span>`
					: `<button type="button" data-layer-jump="${depth + 1}" title="${esc(find(layer.kind, layer.id).title || label(layer))}">${esc(label(layer, true))}</button>`,
			),
		);
		const trail = root.querySelector(".layers-trail");
		// The hint shows on the first layer only; deeper, the trail needs the room.
		const hint = stack.length === 1 ? '<span class="layers-trail-hint">Esc closes the top one</span>' : "";
		trail.innerHTML = crumbs.join('<span class="layers-sep" aria-hidden="true">/</span>') + hint;
		// A deep stack scrolls the trail; keep the newest crumb in view.
		trail.scrollLeft = trail.scrollWidth;
	}
	// Lock the page without a width jump: the lost scrollbar width becomes body padding.
	function hold(on) {
		const html = document.documentElement;
		if (on === html.classList.contains("layers-open")) {
			return;
		}
		if (on) {
			html.style.setProperty("--layers-bar", `${Math.max(0, window.innerWidth - html.clientWidth)}px`);
			for (const el of document.body.children) {
				if (el === root || el.inert) {
					continue;
				}
				el.inert = true;
				inerted.push(el);
			}
		} else {
			for (const el of inerted.splice(0)) {
				el.inert = false;
			}
			// Back on the page: later page routes get the browser's own scroll restoration again.
			history.scrollRestoration = "auto";
		}
		html.classList.toggle("layers-open", on);
		root.hidden = !on;
	}
	// After a close, focus goes back to what opened the layer. If the page redrew that control, or after a reload,
	// focus goes to the page control with the same data-layer value, else the one for the closed item, else the
	// page link to the closed item, else the first link of the reading column, so focus never drops to the body.
	function refocus(closed, top) {
		const back = openers[stack.length];
		openers.length = stack.length;
		const usable = (el) => el?.isConnected && !el.closest("[inert]");
		const byKey = (key) => (key ? document.querySelector(`[data-layer="${CSS.escape(key)}"]`) : null);
		const page = () =>
			byKey(back?.dataset?.layer) ??
			byKey(keyOf(closed)) ??
			[...document.querySelectorAll(`a[href="#${CSS.escape(`${closed.kind}/${closed.id}`)}"]`)].find(
				(a) => !root.contains(a),
			) ??
			document.querySelector("#read a[href]");
		const to = usable(back) ? back : top ? top.querySelector("h2") : page();
		to?.focus({ preventScroll: true });
	}
	function show(next, why) {
		const before = stack;
		if (next.length === before.length && next.every((layer, i) => same(layer, before[i]))) {
			return;
		}
		const stepping = document.activeElement?.closest?.("[data-layer-step]")?.dataset.layerStep;
		stack = next;
		paint(why);
		hold(stack.length > 0);
		const top = root.querySelector(".layers-stack").lastElementChild;
		if (stack.length < before.length) {
			refocus(before[stack.length], top);
		} else if (why === "switch" && stepping) {
			const button =
				top.querySelector(`[data-layer-step="${stepping}"]:not([disabled])`) ??
				top.querySelector("[data-layer-step]:not([disabled])");
			(button ?? top.querySelector("h2")).focus({ preventScroll: true });
		} else {
			top?.querySelector("h2")?.focus({ preventScroll: true });
		}
		if (why === "switch") {
			root.querySelector(".layers-live").textContent =
				`${label(stack[stack.length - 1])}, ${count(stack[stack.length - 1])}`;
		}
		onChange?.(stack.slice());
	}

	/* Stack moves. The history entry of depth n carries state { pictureLayers: n, pageY }.
	   Layer entries use manual scroll restoration, so Back and Forward leave the locked page where it is.
	   pageY is the page scroll under the lock; only a page load (reload or shared link) scrolls back to it. */
	let pageY = 0;
	const entry = (depth) => ({ pictureLayers: depth, pageY });
	function open(kind, id) {
		if (!find(kind, id)) {
			return false;
		}
		const at = stack.findIndex((layer) => same(layer, { kind, id }));
		if (at >= 0) {
			jump(at + 1);
			return true;
		}
		// The base is the page route now in the URL; viewer.js may have moved it since the last restore.
		if (!stack.length) {
			base = split(location.hash).base;
			history.scrollRestoration = "manual";
		}
		pageY = window.scrollY;
		const next = [...stack, { kind, id }];
		openers[stack.length] = document.activeElement;
		history.pushState(entry(next.length), "", join(base, next));
		show(next, "open");
		return true;
	}
	function jump(depth) {
		const keep = Math.max(0, Math.min(stack.length, Math.trunc(Number(depth) || 0)));
		if (keep === stack.length) {
			return;
		}
		if (history.state?.pictureLayers === stack.length) {
			history.go(keep - stack.length);
			return;
		}
		const next = stack.slice(0, keep);
		history.replaceState(entry(keep), "", join(base, next));
		show(next, "close");
	}
	function close() {
		if (stack.length) {
			jump(stack.length - 1);
		}
	}
	function step(delta) {
		if (!stack.length) {
			return;
		}
		const top = stack[stack.length - 1];
		const below = stack.slice(0, -1);
		const all = siblings(top);
		let at = all.indexOf(top.id) + delta;
		while (at >= 0 && at < all.length && below.some((layer) => same(layer, { kind: top.kind, id: all[at] }))) {
			at += delta;
		}
		if (at < 0 || at >= all.length) {
			return;
		}
		const next = [...below, { kind: top.kind, id: all[at] }];
		history.replaceState(entry(next.length), "", join(base, next));
		show(next, "switch");
	}
	// A link or reload gives a hash with no layer history: rebuild one entry per layer so Back closes them one by one.
	// Unknown kinds, dead ids and repeats are dropped, and the URL is corrected.
	function restore(hash, load = false) {
		if (!index) {
			return;
		}
		const parsed = split(hash);
		base = parsed.base;
		const next = parsed.layers.filter(
			(layer, i, all) => find(layer.kind, layer.id) && all.findIndex((other) => same(other, layer)) === i,
		);
		const saved = history.state?.pageY;
		pageY = load && typeof saved === "number" ? saved : window.scrollY;
		if (next.length && history.state?.pictureLayers !== next.length) {
			history.scrollRestoration = "manual";
			history.replaceState(entry(0), "", base);
			next.forEach((_, i) => history.pushState(entry(i + 1), "", join(base, next.slice(0, i + 1))));
		} else if (next.length || String(hash).includes("~")) {
			history.replaceState(entry(next.length), "", join(base, next));
		}
		show(next, "restore");
		if (load && next.length && Math.round(window.scrollY) !== Math.round(pageY)) {
			window.scrollTo(0, pageY);
		}
	}
	function init(options) {
		index = build(options.model);
		onChange = options.onChange ?? null;
		if (!root) {
			mount();
		}
		restore(location.hash, true);
	}

	/* Events. Capture phase, so viewer.js handlers never see a layer click or key. */
	document.addEventListener(
		"click",
		(e) => {
			if (
				!index ||
				!(e.target instanceof Element) ||
				e.button !== 0 ||
				e.metaKey ||
				e.ctrlKey ||
				e.shiftKey ||
				e.altKey
			) {
				return;
			}
			const inside = root?.contains(e.target);
			const hit = (selector) => e.target.closest(selector);
			let done = true;
			if (inside && hit("[data-layer-jump]")) {
				jump(hit("[data-layer-jump]").dataset.layerJump);
			} else if (inside && hit("[data-layer-close]")) {
				close();
			} else if (inside && hit("[data-layer-step]")) {
				step(Number(hit("[data-layer-step]").dataset.layerStep));
			} else if (inside && hit('a[href^="#"]')) {
				const t = target(hit('a[href^="#"]').getAttribute("href"));
				if (t) {
					open(t.kind, t.id);
				} else {
					done = false;
				}
			} else if (!inside && hit("[data-layer]")) {
				const value = hit("[data-layer]").dataset.layer;
				const at = value.indexOf("/");
				done = open(value.slice(0, at), value.slice(at + 1));
			} else {
				done = false;
			}
			if (!done) {
				return;
			}
			e.preventDefault();
			e.stopImmediatePropagation();
		},
		true,
	);
	window.addEventListener(
		"keydown",
		(e) => {
			if (!stack.length) {
				return;
			}
			e.stopPropagation();
			const plain = !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
			if (e.key === "Escape") {
				e.preventDefault();
				close();
			} else if (plain && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
				e.preventDefault();
				step(e.key === "ArrowLeft" ? -1 : 1);
			} else if (e.key === "Tab") {
				trap(e);
			}
		},
		true,
	);
	// Tab cycles through the trail and the top layer only, in that order.
	function trap(e) {
		const top = root.querySelector(".layers-stack").lastElementChild;
		const items = [
			...root.querySelectorAll(".layers-trail button"),
			...top.querySelectorAll("h2, a[href], button:not([disabled])"),
		];
		if (!items.length) {
			return;
		}
		const at = items.indexOf(document.activeElement);
		e.preventDefault();
		if (at === -1) {
			(e.shiftKey ? items[items.length - 1] : items[0]).focus();
		} else {
			items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
		}
	}
	window.addEventListener("popstate", () => restore(location.hash));
	window.addEventListener("hashchange", () => restore(location.hash));

	window.PictureLayers = { init, open, close, jump, restore, split, depth: () => stack.length };
})();
