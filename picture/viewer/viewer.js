(() => {
	"use strict";

	/* Data: the embedded model becomes one view object, as in the reference design. */
	let RAW = null;
	let D, P, M, W, J, Y, TABS, workAt, jAt, lastYear;
	const GROUPS = [
		["needs", "Needs Adam", "Decide here first"],
		["wrong", "Wrong", "Problems to fix"],
		["active", "In progress", "Active tickets, newest first"],
		["planned", "Planned", "Written, not started"],
		["done", "Landed", "Newest first"],
		["dropped", "Dropped", "Stopped on purpose"],
		["map", "Map features", "Features the plant map describes without a ticket"],
	];
	/* Without filter text, the work list hides these lanes and shows only the newest landed work. */
	const QUIET_HIDDEN = new Set(["planned", "dropped", "map"]);
	const RECENT = 10;
	const MONTHS = [
		"January",
		"February",
		"March",
		"April",
		"May",
		"June",
		"July",
		"August",
		"September",
		"October",
		"November",
		"December",
	];
	const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
	const KIND_LABEL = { opened: "Opened", landed: "Landed", "needs-adam": "Needs Adam", wrong: "Wrong" };
	const esc = (s) =>
		String(s ?? "").replace(
			/[&<>"']/g,
			(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
		);
	const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;

	function ymd(iso) {
		const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
		return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
	}
	/* "5 Oct", with the year only when it is not the newest year in the data. */
	function shortDate(iso) {
		const t = ymd(iso);
		if (!t) {
			return "no date";
		}
		return `${t.d} ${MONTHS[t.m - 1].slice(0, 3)}${t.y === lastYear ? "" : ` ${t.y}`}`;
	}
	function dayTitle(iso) {
		const t = ymd(iso);
		if (!t) {
			return String(iso);
		}
		return `${WEEKDAYS[new Date(Date.UTC(t.y, t.m - 1, t.d)).getUTCDay()]} · ${t.d} ${MONTHS[t.m - 1]}${t.y === lastYear ? "" : ` ${t.y}`}`;
	}
	const decode = (s) =>
		s
			.replace(/<[^>]*>/g, "")
			.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
			.replace(/&quot;/g, '"')
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&amp;/g, "&")
			.trim();

	/* Module rows. The entry is the module with the most outgoing cross-module links, the floor the one with the most incoming.
	   The middle row keeps strongly linked modules side by side: the order with the shortest total link span wins. */
	function arrange(modules, edges, modOfId) {
		const net = new Map(modules.map((m) => [m.id, 0]));
		const weight = new Map();
		for (const e of edges) {
			const a = modOfId(e.from);
			const b = modOfId(e.to);
			if (a === b) {
				continue;
			}
			net.set(a, net.get(a) + 1);
			net.set(b, net.get(b) - 1);
			const k = [a, b].sort().join("|");
			weight.set(k, (weight.get(k) || 0) + 1);
		}
		const byNet = [...modules].sort((x, y) => net.get(y.id) - net.get(x.id));
		const entry = byNet[0] || null;
		const floor = modules.length > 1 ? byNet[byNet.length - 1] : null;
		const mids = modules.filter((m) => m !== entry && m !== floor);
		const w = (a, b) => weight.get([a, b].sort().join("|")) || 0;
		/* Order score, compared in turn: total link span; linked pairs that skip a neighbour (their wire dips under
		   the row and crosses the wires to the floor); then modules more linked from the entry sit further left. */
		const score = (row) => {
			let span = 0;
			let dips = 0;
			for (let i = 0; i < row.length; i++) {
				for (let j = i + 1; j < row.length; j++) {
					const n = w(row[i].id, row[j].id);
					span += n * (j - i);
					if (n && j - i > 1) {
						dips++;
					}
				}
			}
			return [span, dips, ...row.map((m) => (entry ? -w(m.id, entry.id) : 0))];
		};
		const before = (a, b) => {
			for (let i = 0; i < a.length; i++) {
				if (a[i] !== b[i]) {
					return a[i] < b[i];
				}
			}
			return false;
		};
		let best = mids;
		if (mids.length > 2 && mids.length <= 7) {
			let bestScore = null;
			const permute = (done, rest) => {
				if (!rest.length) {
					const s = score(done);
					if (!bestScore || before(s, bestScore)) {
						bestScore = s;
						best = done;
					}
					return;
				}
				for (const [i, m] of rest.entries()) {
					permute([...done, m], [...rest.slice(0, i), ...rest.slice(i + 1)]);
				}
			};
			permute([], mids);
		}
		if (entry) {
			entry.layer = "entry";
		}
		for (const m of best) {
			m.layer = "mid";
		}
		if (floor) {
			floor.layer = "floor";
		}
		return [entry, ...best, floor].filter(Boolean);
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: split pending: picture model adapter
	// biome-ignore lint/complexity/noExcessiveLinesPerFunction: same split as the line above
	function adapt(model) {
		const nodes = model.nodes || [];
		const byId = new Map(nodes.map((n) => [n.id, n]));
		const chainOf = (id) => {
			const c = [];
			for (let n = byId.get(id); n; n = n.parent ? byId.get(n.parent) : null) {
				c.unshift(n.id);
			}
			return c;
		};
		const tops = nodes.filter((n) => !n.parent || !byId.has(n.parent));
		const hasKids = (id) => nodes.some((n) => n.parent === id);
		/* A place is a top module's child (deeper nodes fold into it), or a top module with no children. */
		const placeOf = (id) => {
			const c = chainOf(id);
			if (c.length >= 2) {
				return c[1];
			}
			return c.length && !hasKids(c[0]) ? c[0] : null;
		};
		const modOfId = (id) => chainOf(id)[0] || null;
		const endOf = (id) => placeOf(id) || modOfId(id);
		const dates = [];
		for (const w of model.work || []) {
			for (const d of [w.opened, w.landed, w.needsAdam?.on, w.wrong?.on]) {
				if (ymd(d)) {
					dates.push(d);
				}
			}
		}
		lastYear = dates.length ? ymd(dates.sort().at(-1)).y : ymd(model.generatedAt)?.y;

		const modules = tops.map((t) => ({
			id: t.id,
			title: t.title,
			gloss: t.summary,
			bodyHtml: t.bodyHtml || "",
			status: t.status,
			sources: t.sources || [],
			path: t.source,
			places: hasKids(t.id) ? nodes.filter((n) => n.parent === t.id).map((n) => n.id) : [t.id],
		}));
		const places = {};
		for (const m of modules) {
			for (const id of m.places) {
				const n = byId.get(id);
				places[id] = {
					id,
					title: n.title,
					module: m.id,
					gloss: n.summary,
					bodyHtml: n.bodyHtml || "",
					status: n.status,
					sources: n.sources || [],
					path: n.source,
				};
			}
		}
		const edges = (model.edges || [])
			.map((e) => ({
				id: e.id,
				from: endOf(e.from),
				to: endOf(e.to),
				relation: e.kind,
				title: e.title,
				body: e.summary,
			}))
			.filter((e) => e.from && e.to && e.from !== e.to);
		const ordered = arrange(modules, edges, (id) => (places[id] ? places[id].module : id));

		const pins3 = model.pins || {};
		const newestChange = (pins3.changed || [])[0]?.date || null;
		const features = new Map((model.features || []).map((f) => [f.id, f]));
		const touchesOf = (ids) => [...new Set((ids || []).filter((t) => byId.has(t)).map(endOf))];
		const TOUCH_NOTE = {
			ticket: "Places named in the ticket.",
			map: "Places named in the map feature record. The ticket names none.",
			none: "Neither the ticket nor the map names a place yet.",
		};
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: split pending: work item adapter
		const work = (model.work || []).map((w) => {
			const f = w.mapFeature ? features.get(w.mapFeature) : null;
			const group = w.needsAdam ? "needs" : w.wrong ? "wrong" : w.lane;
			const date = w.needsAdam?.on || w.wrong?.on || w.landed || w.opened || null;
			const evidence = [
				{
					title: "Ticket",
					purpose: "The outcome, as the ticket states it.",
					path: w.path,
					excerpt: w.outcome || w.purpose || "The ticket has no Outcome section.",
				},
			];
			if (w.board) {
				evidence.push({
					title: "Board line",
					purpose: "Where the board files this feature.",
					path: `spec/build.md, line ${w.board.line}`,
					excerpt: boardText(w.board),
				});
			}
			if (f) {
				evidence.push({
					title: f.title,
					purpose: "The feature record in the plant map.",
					path: f.source,
					excerpt: f.summary,
				});
			}
			return {
				id: w.id,
				code: w.code,
				title: w.title,
				group,
				lane: w.lane,
				signal: w.needsAdam ? "needs" : w.wrong ? "wrong" : w.landed && w.landed === newestChange ? "changed" : null,
				iso: date,
				date: shortDate(date),
				board: w.board,
				purpose: w.purpose || "",
				outcome: w.outcome || "",
				opened: w.opened,
				landed: w.landed,
				ask: w.needsAdam ? w.needsAdam.ask : null,
				askOn: w.needsAdam ? w.needsAdam.on : null,
				wrong: w.wrong ? w.wrong.problem : null,
				wrongOn: w.wrong ? w.wrong.on : null,
				touches: touchesOf(w.touches),
				touchSource: w.touchSource,
				touchNote: TOUCH_NOTE[w.touchSource] || TOUCH_NOTE.none,
				partial: f ? f.status !== "ready" : false,
				path: w.path,
				evidence,
			};
		});
		const linked = new Set((model.work || []).map((w) => w.mapFeature).filter(Boolean));
		for (const f of model.features || []) {
			if (linked.has(f.id)) {
				continue;
			}
			work.push({
				id: f.id,
				code: (/\((F\d+)\)\s*$/.exec(f.title) || [])[1] || "Map",
				title: f.title.replace(/\s*\(F\d+\)\s*$/, ""),
				group: "map",
				lane: "map",
				signal: null,
				iso: null,
				date: "map only",
				board: null,
				purpose: f.summary,
				outcome: f.summary,
				opened: null,
				landed: null,
				ask: null,
				askOn: null,
				wrong: null,
				wrongOn: null,
				touches: touchesOf(f.touches),
				touchSource: "map",
				touchNote: "Places named in the map feature record. No ticket links to it.",
				partial: f.status !== "ready",
				path: f.source,
				evidence: [
					{ title: f.title, purpose: "The feature record in the plant map.", path: f.source, excerpt: f.summary },
				],
			});
		}
		const rank = {
			needs: (w) => w.askOn,
			wrong: (w) => w.wrongOn,
			done: (w) => w.landed,
			active: (w) => w.opened,
			planned: (w) => w.opened,
		};
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: split pending: work sort comparator
		work.sort((a, b) => {
			const ga = GROUPS.findIndex((g) => g[0] === a.group);
			const gb = GROUPS.findIndex((g) => g[0] === b.group);
			if (ga !== gb) {
				return ga - gb;
			}
			const key = rank[a.group];
			const ka = key ? key(a) || "" : "";
			const kb = key ? key(b) || "" : "";
			return ka < kb ? 1 : ka > kb ? -1 : a.code < b.code ? 1 : a.code > b.code ? -1 : 0;
		});

		const journeys = (model.journeys || []).map((j) => {
			const html = j.bodyHtml || "";
			const list = /<ol>([\s\S]*?)<\/ol>/.exec(html);
			const texts = list ? [...list[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => decode(x[1])) : [];
			const notes = [...html.replace(/<ol>[\s\S]*?<\/ol>/, "").matchAll(/<p>([\s\S]*?)<\/p>/g)]
				.map((x) => decode(x[1]))
				.filter(Boolean);
			return {
				id: j.id,
				title: j.title,
				purpose: j.summary,
				partial: j.status !== "ready",
				steps: (j.steps || []).map((s, i) => ({
					place: endOf(s),
					text: texts[i] || (byId.get(s) ? byId.get(s).title : s),
				})),
				notes,
				sources: j.sources || [],
				path: j.source,
			};
		});
		const workIds = new Set(work.map((w) => w.id));
		const days = (model.days || []).map((d) => {
			const items = (d.items || []).filter((i) => workIds.has(i.work));
			const count = {};
			for (const i of items) {
				count[i.kind] = (count[i.kind] || 0) + 1;
			}
			return {
				id: d.date,
				title: dayTitle(d.date),
				purpose: Object.keys(KIND_LABEL)
					.filter((k) => count[k])
					.map((k) => `${count[k]} ${k === "needs-adam" ? KIND_LABEL[k] : KIND_LABEL[k].toLowerCase()}`)
					.join(" · "),
				items,
			};
		});
		/* Three pins always; an empty one says so in words. */
		const pins = [
			["changed", "Changed", "Nothing landed yet."],
			["wrong", "Wrong", "No open problem."],
			["needs", "Needs Adam", "Nothing waits for you."],
		].map(([kind, label, none]) => {
			const list = (pins3[kind] || []).filter((p) => workIds.has(p.work));
			const p = list[0];
			return p
				? { kind, label, date: shortDate(p.date), scope: p.scope, text: p.text, work: p.work, more: list.length - 1 }
				: { kind, label, text: none, empty: true };
		});
		const project = model.project || {};
		return {
			plant: {
				id: project.rootId,
				title: project.title || project.id || "Plant",
				gloss: project.summary || "",
				revision: (project.revision || "").slice(0, 7),
				date: shortDate(model.generatedAt),
				name: project.id || "",
			},
			modules: ordered,
			places,
			edges,
			work,
			journeys,
			days,
			pins,
			diagnostics: model.diagnostics || [],
		};
	}

	function use(view) {
		D = view;
		P = D.places;
		M = Object.fromEntries(D.modules.map((m) => [m.id, m]));
		W = Object.fromEntries(D.work.map((w) => [w.id, w]));
		J = Object.fromEntries(D.journeys.map((j) => [j.id, j]));
		Y = Object.fromEntries(D.days.map((d) => [d.id, d]));
		TABS = [
			["work", "Work", D.work.length],
			["journeys", "Journeys", D.journeys.length],
			["days", "Days", D.days.length],
			["places", "Places", Object.keys(P).length],
		];
		workAt = {};
		jAt = {};
		for (const w of D.work) {
			w.lit = [...new Set(w.touches.flatMap(spread))];
			for (const t of w.lit) {
				workAt[t] ??= [];
				workAt[t].push(w.id);
			}
		}
		for (const j of D.journeys) {
			j.steps.forEach((s, i) => {
				if (!s.place) {
					return;
				}
				jAt[s.place] ??= [];
				const a = jAt[s.place];
				if (!a.some((x) => x.j === j.id)) {
					a.push({ j: j.id, i });
				}
			});
		}
	}
	const spread = (id) => (P[id] ? [id] : M[id] ? M[id].places : []);
	const modOf = (id) => (P[id] ? P[id].module : id);
	const nodeTitle = (id) => (P[id] ? P[id].title : M[id] ? M[id].title : D.plant.title);
	const edgesAt = (id) => D.edges.filter((e) => e.from === id || e.to === id);

	/* Routes: every state has one reloadable hash. Everything after the first '~' belongs to the layers script. */
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: split pending: route hash parser
	function parse(h) {
		let text = String(h).replace(/^#/, "").split("~")[0];
		try {
			text = decodeURIComponent(text);
		} catch {
			text = "";
		}
		const s = text.split("/");
		if (s[0] === "work" && W[s[1]]) {
			const w = W[s[1]];
			return {
				view: "work",
				id: s[1],
				ev: s[2] === "evidence" && /^\d+$/.test(s[3] || "") && w.evidence[+s[3]] ? +s[3] : null,
			};
		}
		if (s[0] === "place" && P[s[1]]) {
			const r = { view: "place", id: s[1] };
			if (s[2] === "via" && s[3] === "work" && W[s[4]] && W[s[4]].lit.includes(s[1])) {
				r.via = s[4];
			}
			return r;
		}
		if (s[0] === "module" && M[s[1]]) {
			return { view: "module", id: s[1] };
		}
		if (s[0] === "journey" && J[s[1]]) {
			const j = J[s[1]];
			return {
				view: "journey",
				id: s[1],
				step: s[2] === "step" && /^\d+$/.test(s[3] || "") && j.steps[+s[3] - 1] ? +s[3] : null,
			};
		}
		if (s[0] === "day" && Y[s[1]]) {
			return { view: "day", id: s[1] };
		}
		return { view: "plant", tab: s[0] === "plant" && TABS.some((t) => t[0] === s[1]) ? s[1] : "work" };
	}
	function tabOf(r) {
		return r.view === "plant"
			? r.tab
			: r.view === "work" || (r.view === "place" && r.via)
				? "work"
				: r.view === "journey"
					? "journeys"
					: r.view === "day"
						? "days"
						: "places";
	}
	const workOf = (r) => (r.view === "work" ? r.id : r.view === "place" && r.via ? r.via : null);
	function placeHref(id, r) {
		const w = workOf(r);
		if (w && P[id] && W[w].lit.includes(id)) {
			return `#place/${id}/via/work/${w}`;
		}
		if (r.view === "journey") {
			const i = J[r.id].steps.findIndex((s) => s.place === id);
			if (i >= 0) {
				return `#journey/${r.id}/step/${i + 1}`;
			}
		}
		return P[id] ? `#place/${id}` : M[id] ? `#module/${id}` : "#plant/places";
	}
	function parentHref(r) {
		if (r.view === "work") {
			return r.ev !== null ? `#work/${r.id}` : "#plant/work";
		}
		if (r.view === "place") {
			return r.via ? `#work/${r.via}` : "#plant/places";
		}
		if (r.view === "module") {
			return "#plant/places";
		}
		if (r.view === "journey") {
			return r.step ? `#journey/${r.id}` : "#plant/journeys";
		}
		if (r.view === "day") {
			return "#plant/days";
		}
		return `#plant/${r.tab}`;
	}

	/* Masthead */
	function renderMastHtml(r) {
		const cur = workOf(r);
		return (
			`<a class="brand" href="#plant"><b>${esc(D.plant.name || D.plant.title)} · Picture</b><span>Plant, work, and decisions</span></a>` +
			D.pins
				.map((p) =>
					p.empty
						? `<a class="pin ${p.kind} empty" href="#plant/work"><span class="lab">${esc(p.label)}</span><span class="txt">${esc(p.text)}</span></a>`
						: `<a class="pin ${p.kind}" href="#work/${esc(p.work)}" data-layer="work/${esc(p.work)}" aria-current="${cur === p.work}" title="${esc(p.text)}"><span class="lab">${esc(p.label)} <small>· ${esc(p.date)}${p.more ? ` · ${p.more} more` : ""}${p.scope ? ` · ${esc(p.scope)}` : ""}</small></span><span class="txt">${esc(p.text)}</span></a>`,
				)
				.join("")
		);
	}

	/* Atlas: built once, then lit per route. */
	let stage = null;
	function chip(id, band) {
		const p = P[id];
		const n = (workAt[id] || []).length;
		const label = p.gloss ? `${p.title}\n${p.gloss}` : p.title;
		const inner = band
			? `<span class="nm"><b>${esc(p.title)}</b><span>${esc(M[id].gloss)}</span></span>`
			: `<span class="nm">${esc(p.title)}</span>`;
		return `<a class="place" data-place="${esc(id)}" href="#place/${esc(id)}" title="${esc(label)}">${p.status === "partial" ? '<i class="pd" aria-label="only partly described"></i>' : ""}${inner}<span class="ct" aria-label="${plural(n, "work item")}">${n || ""}</span></a>`;
	}
	function modCard(m, cls) {
		return `<div class="mod ${cls}" data-mod="${esc(m.id)}"><div class="fhead"><div class="mod-head"><a href="#module/${esc(m.id)}" title="Open module">${esc(m.title)}</a></div><p>${esc(m.gloss)}</p></div><div class="places">${m.places.map((id) => chip(id)).join("")}</div></div>`;
	}
	function atlasHtml() {
		const entry = D.modules.find((m) => m.layer === "entry");
		const floor = D.modules.find((m) => m.layer === "floor");
		const mids = D.modules.filter((m) => m.layer === "mid");
		const wide = (m, row) =>
			m.places.length === 1 && m.places[0] === m.id
				? `<div class="band" data-row="${row}" data-mod="${esc(m.id)}">${chip(m.id, true)}</div>`
				: `<div data-row="${row}">${modCard(m, "floor")}</div>`;
		return (
			(entry ? wide(entry, 0) : "") +
			(mids.length ? `<div class="midrow" data-row="1">${mids.map((m) => modCard(m, "")).join("")}</div>` : "") +
			(floor ? wide(floor, 2) : "")
		);
	}
	function buildAtlas() {
		const link = document.getElementById("plantLink");
		link.textContent = D.plant.title;
		document.getElementById("plantGloss").textContent = D.plant.gloss;
		const notes = noteCount();
		document.getElementById("facts").innerHTML =
			`${plural(D.modules.length, "module")} · ${plural(Object.keys(P).length, "place")} · ${plural(D.edges.length, "connection")}<br>` +
			`<span title="Map revision ${esc(D.plant.revision)}">Built from the plant map of ${esc(D.plant.date)}</span>${notes ? ` · <a href="#plant/work" data-notes>${notes}</a>` : ""}`;
		document.title = `${D.plant.title} · Picture`;
		stage.insertAdjacentHTML("beforeend", atlasHtml());
		stage.querySelectorAll(".place").forEach((a) => {
			a.addEventListener("mouseenter", () => hintRows(a.dataset.place, true));
			a.addEventListener("mouseleave", () => hintRows(a.dataset.place, false));
		});
	}
	function hintRows(id, on) {
		document.querySelectorAll("#read .row[data-places]").forEach((r) => {
			if (r.dataset.places.split(" ").includes(id)) {
				r.classList.toggle("hint-on", on);
			}
		});
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: split pending: picture lighting for one route
	// biome-ignore lint/complexity/noExcessiveLinesPerFunction: same split as the line above
	function lighting(r) {
		const L = { lit: new Set(), focus: null, near: new Set(), mfocus: null, wires: [], badges: {}, text: "", mode: "" };
		const sub = (set) => D.edges.filter((e) => set.has(e.from) && set.has(e.to)).map((e) => ({ e, cls: "sel" }));
		const w = workOf(r);
		if (w) {
			const x = W[w];
			for (const t of x.lit) {
				L.lit.add(t);
			}
			L.wires = sub(L.lit);
			const mods = new Set(x.lit.map(modOf));
			const by =
				x.touchSource === "ticket"
					? " (places named in its ticket)"
					: x.touchSource === "map"
						? " (places named in the map)"
						: "";
			L.text = x.lit.length
				? `<b>${esc(x.code)} · ${esc(x.title)}</b> lights ${plural(x.lit.length, "place")} in ${plural(mods.size, "module")}${by}.`
				: `<b>${esc(x.code)} · ${esc(x.title)}</b> names no place yet.`;
			L.mode = "on";
		}
		if (r.view === "place") {
			L.focus = r.id;
			for (const e of edgesAt(r.id)) {
				const o = e.from === r.id ? e.to : e.from;
				if (P[o]) {
					L.near.add(o);
				}
				L.wires.push({ e, cls: "ink" });
			}
			if (!r.via) {
				L.text = `<b>${esc(P[r.id].title)}</b> · ${plural(edgesAt(r.id).length, "connection")} · touched by ${plural((workAt[r.id] || []).length, "work item")}.`;
				L.mode = "focus";
			} else {
				L.text += ` Open place: <b>${esc(P[r.id].title)}</b>.`;
			}
		}
		if (r.view === "module") {
			L.mfocus = r.id;
			const inside = (id) => modOf(id) === r.id;
			for (const e of D.edges) {
				if (inside(e.from) !== inside(e.to)) {
					L.wires.push({ e, cls: "ink" });
					const o = inside(e.from) ? e.to : e.from;
					if (P[o]) {
						L.near.add(o);
					}
				}
			}
			for (const p of M[r.id].places) {
				L.lit.add(p);
			}
			L.text = `<b>${esc(M[r.id].title)}</b> · ${plural(L.wires.length, "connection")} cross its border to ${plural(new Set([...L.near].map(modOf)).size, "module")}.`;
			L.mode = "focus";
		}
		if (r.view === "journey") {
			const j = J[r.id];
			j.steps.forEach((s, i) => {
				if (!s.place) {
					return;
				}
				for (const p of spread(s.place)) {
					L.lit.add(p);
				}
				L.badges[s.place] ??= [];
				L.badges[s.place].push(i + 1);
			});
			/* Journey hops show ordered steps, not graph connections. */
			for (let i = 1; i < j.steps.length; i++) {
				const a = j.steps[i - 1].place;
				const b = j.steps[i].place;
				if (a && b && a !== b) {
					L.wires.push({ e: { from: a, to: b, k: i + 1 }, cls: "journey" });
				}
			}
			if (r.step) {
				L.focus = j.steps[r.step - 1].place;
			}
			L.text = `<b>${esc(j.title)}</b> · ${plural(j.steps.length, "ordered step")} through ${plural(L.lit.size, "place")}.${r.step ? ` Step ${r.step}: <b>${esc(nodeTitle(L.focus))}</b>.` : ""}`;
			L.mode = "on";
		}
		if (r.view === "day") {
			const d = Y[r.id];
			for (const it of d.items) {
				for (const t of W[it.work].lit) {
					L.lit.add(t);
				}
			}
			L.wires = sub(L.lit);
			L.text = `<b>${esc(d.title)}</b> · ${plural(d.items.length, "entry", "entries")} light ${plural(L.lit.size, "place")}.`;
			L.mode = "on";
		}
		if (r.view === "plant") {
			L.text = `${plural(D.edges.length, "connection")} link these ${plural(D.modules.length, "module")}. Select a place or module to trace them, or show all module connections.`;
		}
		return L;
	}
	function applyAtlas(r) {
		const L = lighting(r);
		const atlas = document.getElementById("atlas");
		stage.classList.toggle("lens", !!(L.lit.size || L.focus || L.mfocus));
		stage.querySelectorAll(".place").forEach((a) => {
			const id = a.dataset.place;
			a.classList.toggle("lit", L.lit.has(id));
			a.classList.toggle("focus", L.focus === id);
			a.classList.toggle("near", L.near.has(id) && !L.lit.has(id));
			a.setAttribute("href", placeHref(id, r));
			a.querySelector(".badge")?.remove();
			if (L.badges[id]) {
				const cur = r.step && J[r.id].steps[r.step - 1].place === id;
				a.insertAdjacentHTML("beforeend", `<span class="badge${cur ? " cur" : ""}">${L.badges[id].join("·")}</span>`);
			}
		});
		for (const m of stage.querySelectorAll("[data-mod]")) {
			m.classList.toggle("mfocus", m.dataset.mod === L.mfocus);
		}
		const ll = document.getElementById("lightline");
		ll.className = `lightline ${L.mode}`;
		ll.innerHTML = `<i class="sw"></i><span>${L.text}</span>${r.view !== "plant" ? `<a href="#plant/${tabOf(r)}">Clear selection</a>` : ""}`;
		const uniq = new Map();
		for (const x of L.wires) {
			const key = `${x.cls === "journey" ? "journey|" : ""}${x.e.from}|${x.e.to}`;
			const prior = uniq.get(key);
			if (prior && x.cls === "journey") {
				prior[3].push(x.e.k);
			} else {
				/* One code wire per direction; journey repeats retain their step numbers. */
				uniq.set(key, [x.e.from, x.e.to, x.cls, x.cls === "journey" ? [x.e.k] : []]);
			}
		}
		atlas.dataset.wires = JSON.stringify([...uniq.values()]);
		drawWires();
		revealAtlas(L.focus || L.mfocus);
	}

	function revealAtlas(focus) {
		const viewport = document.getElementById("atlasMap");
		if (viewport.scrollHeight <= viewport.clientHeight) {
			return;
		}
		const target =
			(focus && stage.querySelector(`[data-place="${CSS.escape(focus)}"],[data-mod="${CSS.escape(focus)}"]`)) ||
			stage.querySelector(".place.lit");
		if (!target) {
			return;
		}
		/* Scroll only the map. The reading column keeps its navigation anchor. */
		const view = viewport.getBoundingClientRect();
		const box = target.getBoundingClientRect();
		const pad = parseFloat(getComputedStyle(viewport).scrollPaddingTop);
		if (box.top < view.top + pad || box.height > view.height - 2 * pad) {
			viewport.scrollTop += box.top - view.top - pad;
		} else if (box.bottom > view.bottom - pad) {
			viewport.scrollTop += box.bottom - view.bottom + pad;
		}
	}

	/* Wires: measured from the live layout, so they follow resizes. */
	function box(el) {
		const s = stage.getBoundingClientRect();
		const b = el.getBoundingClientRect();
		const l = b.left - s.left + stage.scrollLeft;
		const t = b.top - s.top + stage.scrollTop;
		return { l, t, r: l + b.width, b: t + b.height, w: b.width, h: b.height, x: l + b.width / 2, y: t + b.height / 2 };
	}
	function path(pts) {
		/* Rounded orthogonal paths stay in the measured gutters. */
		const clean = pts.filter((p, i) => !i || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
		let d = `M${clean[0][0]} ${clean[0][1]}`;
		for (let i = 1; i < clean.length - 1; i++) {
			const [px, py] = clean[i - 1];
			const [x, y] = clean[i];
			const [nx, ny] = clean[i + 1];
			const r = Math.min(3, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
			d += `L${x - Math.sign(x - px) * r} ${y - Math.sign(y - py) * r}Q${x} ${y} ${x + Math.sign(nx - x) * r} ${y + Math.sign(ny - y) * r}`;
		}
		const [x, y] = clean[clean.length - 1];
		return `${d}L${x} ${y}`;
	}
	function anchorEl(id, module = false) {
		const card = stage.querySelector(`[data-mod="${CSS.escape(id)}"]`);
		return module ? card : stage.querySelector(`.place[data-place="${CSS.escape(id)}"]`) || card;
	}
	function wirePort(el, toward, jit) {
		const a = box(el);
		const card = el.closest(".mod,.band") || el;
		const m = box(card);
		if (!el.matches(".place") && (a.b < toward.t || toward.b < a.t)) {
			const down = a.y < toward.y;
			const x = Math.max(a.l + 8, Math.min(a.r - 8, toward.x));
			return {
				card,
				tip: [x, down ? a.b + 2 : a.t - 2],
				exit: [x, down ? a.b + 5 : a.t - 5],
				top: m.t - 5,
				bottom: m.b + 5,
			};
		}
		const places = box(el.closest(".places") || card);
		const left = el.matches(".place") ? a.x < places.x : toward.x < a.x;
		const y = Math.max(a.t + 4, Math.min(a.b - 4, a.y + jit));
		return {
			card,
			tip: [left ? a.l - 2 : a.r + 2, y],
			exit: [left ? a.l - 5 : a.r + 5, y],
			top: m.t - 5,
			bottom: m.b + 5,
		};
	}
	function clearWire(pts, cards) {
		for (let i = 1; i < pts.length; i++) {
			const [x, y] = pts[i - 1];
			const [u, v] = pts[i];
			if (
				cards.some((c) =>
					x === u
						? x > c.l && x < c.r && Math.max(y, v) > c.t && Math.min(y, v) < c.b
						: y > c.t && y < c.b && Math.max(x, u) > c.l && Math.min(x, u) < c.r,
				)
			) {
				return false;
			}
		}
		return true;
	}
	function wireRoute(A, B, cards, jit = 0) {
		const a = wirePort(A, box(B), jit);
		const b = wirePort(B, box(A), jit);
		const own = new Set([a.card, b.card]);
		const blockers = [
			...cards.filter((c) => !own.has(c.el)),
			...[...own].flatMap((el) => [...el.querySelectorAll(".fhead,.place")].map(box)),
		];
		const [sx, sy] = a.exit;
		const [tx, ty] = b.exit;
		let best = null;
		let cost = Infinity;
		const consider = (pts) => {
			const length = pts.slice(1).reduce((n, p, i) => n + Math.abs(p[0] - pts[i][0]) + Math.abs(p[1] - pts[i][1]), 0);
			if (length < cost && clearWire(pts, blockers)) {
				best = pts;
				cost = length;
			}
		};
		consider([a.exit, [tx, sy], b.exit]);
		consider([a.exit, [sx, ty], b.exit]);
		for (const y of [a.top, a.bottom, b.top, b.bottom]) {
			consider([a.exit, [sx, y], [tx, y], b.exit]);
		}
		if (best && cost === Math.abs(tx - sx) + Math.abs(ty - sy)) {
			return path([a.tip, ...best, b.tip]);
		}
		/* A shared outside rail connects packed rows without crossing a card. */
		const rails = new Set([sx, tx, ...cards.flatMap((c) => [c.l - 5, c.r + 5])]);
		for (const x of rails) {
			for (const ay of [a.top, a.bottom]) {
				for (const by of [b.top, b.bottom]) {
					consider([a.exit, [sx, ay], [x, ay], [x, by], [tx, by], b.exit]);
				}
			}
		}
		return best ? path([a.tip, ...best, b.tip]) : null;
	}
	const DEFS = `<defs>${[
		["g", "#868b92"],
		["t", "#0d6b62"],
		["k", "#1c1e22"],
	]
		.map(
			([n, c]) =>
				`<marker id="m${n}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1L9 5L0 9z" fill="${c}"/></marker>`,
		)
		.join("")}</defs>`;
	function modulePairs() {
		const pairs = new Map();
		for (const e of D.edges) {
			const a = modOf(e.from);
			const b = modOf(e.to);
			if (a === b) {
				continue;
			}
			const [lo, hi] = [a, b].sort();
			const key = `${lo}|${hi}`;
			const p = pairs.get(key) || { a: lo, b: hi, fw: 0, bw: 0 };
			if (a === lo) {
				p.fw++;
			} else {
				p.bw++;
			}
			pairs.set(key, p);
		}
		return [...pairs.values()];
	}
	function wireCount(svg, d, count, cards, labels) {
		const tmp = document.createElementNS("http://www.w3.org/2000/svg", "path");
		tmp.setAttribute("d", d);
		svg.appendChild(tmp);
		const length = tmp.getTotalLength();
		let at = null;
		const samples = Array.from({ length: Math.ceil(length / 12) }, (_, i) => i * 12);
		samples.sort((a, b) => Math.abs(a - length / 2) - Math.abs(b - length / 2));
		for (const distance of samples) {
			const p = tmp.getPointAtLength(distance);
			const clear = cards.every((c) => p.x + 10 < c.l || p.x - 10 > c.r || p.y + 10 < c.t || p.y - 10 > c.b);
			if (clear && labels.every((q) => Math.hypot(p.x - q.x, p.y - q.y) > 22)) {
				at = p;
				break;
			}
		}
		tmp.remove();
		if (!at) {
			return "";
		}
		labels.push(at);
		return `<circle class="wcount" cx="${at.x}" cy="${at.y}" r="9"/><text class="wnum" x="${at.x}" y="${at.y}">${count}</text>`;
	}
	function baseWires(svg, cards) {
		let html = DEFS;
		const labels = [];
		for (const p of modulePairs()) {
			const A = anchorEl(p.a, true);
			const B = anchorEl(p.b, true);
			if (!A || !B) {
				continue;
			}
			const d = wireRoute(A, B, cards);
			if (!d) {
				continue;
			}
			html += `<path class="wire" data-from="${esc(p.a)}" data-to="${esc(p.b)}" d="${d}" ${p.fw ? 'marker-end="url(#mg)"' : ""} ${p.bw ? 'marker-start="url(#mg)"' : ""}><title>${esc(M[p.a].title)} ↔ ${esc(M[p.b].title)}: ${plural(p.fw + p.bw, "connection")}</title></path>`;
			html += wireCount(svg, d, p.fw + p.bw, cards, labels);
		}
		return html;
	}
	function selectedWires(wires, cards) {
		let html = DEFS;
		const seen = new Map();
		for (const [f, t, cls, steps] of wires) {
			const A = anchorEl(f);
			const B = anchorEl(t);
			if (!A || !B) {
				continue;
			}
			const key = [f, t].sort().join("|");
			const n = seen.get(key) || 0;
			seen.set(key, n + 1);
			const d = wireRoute(A, B, cards, n % 2 ? 3 : 0);
			if (d) {
				const step = cls === "journey" ? ` data-steps="${steps.join(",")}"` : "";
				html += `<path class="wire ${cls}" data-from="${esc(f)}" data-to="${esc(t)}"${step} d="${d}" marker-end="url(#m${cls === "sel" ? "t" : "k"})"/>`;
			}
		}
		return html;
	}
	function drawWires() {
		const cards = [...stage.querySelectorAll(".mod,.band")].map((el) => ({ el, ...box(el) }));
		const baseSvg = document.getElementById("base");
		const overSvg = document.getElementById("over");
		const width = Math.max(stage.clientWidth, ...cards.map((c) => c.r + 5));
		const height = Math.max(stage.clientHeight, ...cards.map((c) => c.b + 5));
		for (const svg of [baseSvg, overSvg]) {
			svg.style.width = `${width}px`;
			svg.style.height = `${height}px`;
		}
		const overview = document.getElementById("wireOverview").getAttribute("aria-pressed") === "true";
		baseSvg.innerHTML = overview ? baseWires(baseSvg, cards) : DEFS;
		const wires = JSON.parse(document.getElementById("atlas").dataset.wires || "[]");
		baseSvg.classList.toggle("dim", Boolean(wires.length || stage.classList.contains("lens")));
		overSvg.innerHTML = selectedWires(wires, cards);
		overSvg.classList.remove("highlight");
	}

	/* Reading column */
	function tag(x) {
		if (x.signal === "needs") {
			return '<span class="tag needs">Needs Adam</span>';
		}
		if (x.signal === "wrong") {
			return '<span class="tag wrong">Wrong</span>';
		}
		if (x.signal === "changed") {
			return '<span class="tag changed">Changed</span>';
		}
		if (x.partial) {
			return '<span class="tag partial">Partial</span>';
		}
		return "";
	}
	function row(key, href, open, kind, title, pp, meta, places, sub) {
		return `<a class="row${sub ? " sub" : ""}" data-key="${esc(key)}" href="${href}" aria-expanded="${open}" ${places ? `data-places="${esc(places.join(" "))}"` : ""}><span class="kind">${kind}</span><span><span class="t">${title}</span><span class="pp">${pp}</span><span class="meta">${meta}</span></span><span class="ch" aria-hidden="true">${open ? "−" : "↗"}</span></a>`;
	}
	const asLayer = (kind, id, href) =>
		`<p class="as-layer"><a data-layer="${kind}/${esc(id)}" href="${href}">Open as a layer ↗</a></p>`;
	const relation = (e) => esc(String(e.relation || "").replace(/-/g, " "));
	function placeList(ids, r, opts = {}) {
		return `<div class="plist">${ids
			.map(
				(id) =>
					`<a class="pl${opts.cur === id ? " cur" : ""}" data-key="pl:${esc(id)}" data-hover="${esc(id)}" href="${opts.href ? opts.href(id) : placeHref(id, r)}"><b>${esc(nodeTitle(id))}</b><em>${esc(M[modOf(id)].title)}</em><span>${esc(P[id] ? P[id].gloss : M[id].gloss)}</span></a>`,
			)
			.join("")}</div>`;
	}
	function edgeRows(es, r) {
		return `<div class="elist">${es
			.map(
				(e) =>
					`<div class="erow" data-wire="${esc(e.from)}|${esc(e.to)}"><a href="${placeHref(e.from, r)}">${esc(nodeTitle(e.from))}</a><span class="rel">${relation(e)} →</span><a href="${placeHref(e.to, r)}">${esc(nodeTitle(e.to))}</a><small>${esc(e.title)}</small></div>`,
			)
			.join("")}</div>`;
	}
	function journeysThrough(ids) {
		return D.journeys
			.map((j) => ({ j, n: new Set(j.steps.map((s) => s.place).filter((p) => ids.includes(p))).size }))
			.filter((x) => x.n)
			.sort((a, b) => b.n - a.n);
	}
	function placeBody(id, r, lead = true) {
		const p = P[id];
		const out = edgesAt(id).filter((e) => e.from === id);
		const inn = edgesAt(id).filter((e) => e.to === id);
		const ws = workAt[id] || [];
		const js = jAt[id] || [];
		return `${lead ? `<p class="lead"><b>What this place is for</b>${esc(p.gloss)}</p>` : ""}
    ${p.status === "partial" ? '<div class="box partial"><b class="k">Only partly described in the map</b>The map marks this place partial. Its record below names what is missing.</div>' : ""}
    ${p.bodyHtml ? `<div class="blk md"><h4>How it works</h4>${p.bodyHtml}</div>` : ""}
    <div class="blk"><h4>In module</h4><div class="inl"><a href="#module/${esc(p.module)}">${esc(M[p.module].title)}</a></div></div>
    <div class="blk"><h4>Connections<small>${out.length} outgoing · ${inn.length} incoming</small></h4>${out.length + inn.length ? edgeRows([...out, ...inn], r) : '<p class="note">No connection in the map.</p>'}</div>
    <div class="blk"><h4>Work that touches this place<small>${ws.length}</small></h4>${ws.length ? `<div class="inl">${ws.map((w) => `<a href="#work/${esc(w)}" data-key="go:${esc(w)}">${esc(W[w].code)} · ${esc(W[w].title)}</a>`).join("")}</div>` : '<p class="note">No work item names this place.</p>'}</div>
    <div class="blk"><h4>Journeys through this place<small>${js.length}</small></h4>${js.length ? `<div class="inl">${js.map((x) => `<a href="#journey/${esc(x.j)}/step/${x.i + 1}">${esc(J[x.j].title)} · step ${x.i + 1}</a>`).join("")}</div>` : '<p class="note">No journey passes here.</p>'}</div>
    <div class="blk"><h4>Cited files</h4><p class="note path">${p.sources.map(esc).join(" · ") || "None cited."}</p><p class="note">Map record: <span class="path">${esc(p.path)}</span></p></div>`;
	}
	/* "Now", or "Parked · planned" when the state adds something to the section. */
	function boardText(b) {
		const section = String(b.section || "").toLowerCase();
		const state = String(b.state || "").toLowerCase();
		const head = section.charAt(0).toUpperCase() + section.slice(1);
		return state && state !== section ? `${head} · ${state}` : head;
	}
	function stateLine(w) {
		const parts = [];
		if (w.board) {
			parts.push(`On the board: ${esc(boardText(w.board))}`);
		} else if (w.group !== "map") {
			parts.push("Not on the board");
		}
		if (w.opened) {
			parts.push(`opened ${esc(shortDate(w.opened))}`);
		}
		if (w.landed) {
			parts.push(`landed ${esc(shortDate(w.landed))}`);
		}
		return parts.join(" · ");
	}
	function workMid(w, r) {
		const evs = w.evidence
			.map((e, i) => {
				const open = r.view === "work" && r.ev === i;
				return (
					`<a class="evl" data-key="ev:${esc(w.id)}:${i}" href="${open ? `#work/${esc(w.id)}` : `#work/${esc(w.id)}/evidence/${i}`}" aria-expanded="${open}"><span><b>${esc(e.title)}</b><span>${esc(e.purpose)}</span></span><i>${open ? "Close" : "Open source ↘"}</i></a>` +
					(open
						? `<article class="deep" id="deep"><a class="back" href="#work/${esc(w.id)}">← Back to ${esc(w.code)} detail</a><div class="eyebrow">Source</div><h3>${esc(e.title)}</h3><p class="note path">${esc(e.path)}</p><div class="excerpt">${esc(e.excerpt)}</div><p class="stop">Stop here. This is the cited fact. Read the outcome above for what it means.</p></article>`
						: "")
				);
			})
			.join("");
		const viaPlace = r.view === "place" && r.via === w.id ? r.id : null;
		const sub = D.edges.filter((e) => w.lit.includes(e.from) && w.lit.includes(e.to));
		const js = journeysThrough(w.lit);
		const days = D.days.filter((d) => d.items.some((i) => i.work === w.id));
		return `<div class="mid">${asLayer("work", w.id, `#work/${esc(w.id)}`)}
    ${w.wrong ? `<div class="box wrong"><b class="k">Wrong · ${esc(shortDate(w.wrongOn))}</b>${esc(w.wrong)}</div>` : ""}
    ${w.ask ? `<div class="box needs"><b class="k">Needs Adam · ${esc(shortDate(w.askOn))}</b><p class="ask">${esc(w.ask)}</p></div>` : ""}
    <div class="blk"><h4>Outcome</h4><p>${esc(w.outcome || w.purpose)}</p></div>
    <div class="blk"><h4>State</h4><p>${stateLine(w)}</p></div>
    <div class="blk"><h4>Places touched<small>${w.lit.length ? `${plural(w.lit.length, "place")} · lit in the plant` : "none yet"}</small></h4><p class="note">${esc(w.touchNote)}</p>
      ${w.touches.length ? placeList(w.touches, r, { cur: viaPlace }) : ""}
      ${viaPlace ? `<article class="deep" id="deep"><a class="back" href="#work/${esc(w.id)}">← Back to ${esc(w.code)} detail</a><div class="eyebrow">Place · ${esc(M[P[viaPlace].module].title)}</div><h3>${esc(P[viaPlace].title)}</h3>${placeBody(viaPlace, r)}</article>` : ""}</div>
    ${sub.length ? `<div class="blk"><h4>How these places connect<small>${sub.length}</small></h4>${edgeRows(sub, r)}</div>` : ""}
    ${js.length ? `<div class="blk"><h4>Journeys through these places</h4><div class="inl">${js.map((x) => `<a href="#journey/${esc(x.j.id)}">${esc(x.j.title)} · ${x.n} shared</a>`).join("")}</div></div>` : ""}
    ${days.length ? `<div class="blk"><h4>On these days</h4><div class="inl">${days.map((d) => `<a href="#day/${esc(d.id)}">${esc(d.title)}</a>`).join("")}</div></div>` : ""}
    <div class="blk"><h4>Sources<small>${w.evidence.length}</small></h4>${evs}</div>
  </div>`;
	}
	function stepDeep(j, r) {
		const s = j.steps[r.step - 1];
		const where = P[s.place] ? M[P[s.place].module].title : M[s.place] ? "Module" : "Plant";
		const body = P[s.place] ? placeBody(s.place, r) : `<p class="lead"><b>Step</b>${esc(s.text)}</p>`;
		return `<article class="deep" id="deep"><a class="back" href="#journey/${esc(j.id)}">← Back to all steps</a><div class="eyebrow">Step ${r.step} · ${esc(where)}</div><h3>${esc(nodeTitle(s.place))}</h3>${body}</article>`;
	}
	function journeyMid(j, r) {
		const ws = [...new Set(j.steps.flatMap((s) => (s.place ? spread(s.place).flatMap((p) => workAt[p] || []) : [])))];
		return `<div class="mid">${asLayer("journey", j.id, `#journey/${esc(j.id)}`)}
    ${j.partial ? `<div class="box partial"><b class="k">Only partly described in the map</b>${esc(j.notes.join(" ") || "The map marks this journey partial.")}</div>` : ""}
    <div class="blk"><h4>Ordered steps<small>select a step to mark it in the plant</small></h4><ol class="steps">${j.steps
			.map(
				(s, i) =>
					`<li><a data-key="st:${esc(j.id)}:${i}" href="${r.step === i + 1 ? `#journey/${esc(j.id)}` : `#journey/${esc(j.id)}/step/${i + 1}`}" aria-current="${r.step === i + 1 ? "step" : "false"}" data-hover="${esc(s.place || "")}"><span class="n">${i + 1}</span><span><b>${esc(nodeTitle(s.place))}</b><span>${esc(s.text)}</span></span></a></li>`,
			)
			.join("")}</ol>
    ${r.step ? stepDeep(j, r) : ""}</div>
    ${j.notes.length && !j.partial ? `<div class="blk"><h4>Limits</h4>${j.notes.map((n) => `<p>${esc(n)}</p>`).join("")}</div>` : ""}
    <div class="blk"><h4>Work on these places<small>${ws.length}</small></h4>${ws.length ? `<div class="inl">${ws.map((w) => `<a href="#work/${esc(w)}" data-key="go:${esc(w)}">${esc(W[w].code)}</a>`).join("")}</div>` : '<p class="note">No work item names these places.</p>'}</div>
    <div class="blk"><h4>Sources</h4><p class="note">Map record: <span class="path">${esc(j.path)}</span></p><p class="note path">${j.sources.map(esc).join(" · ")}</p></div></div>`;
	}
	function dayMid(d) {
		return `<div class="mid">${asLayer("day", d.id, `#day/${esc(d.id)}`)}${d.items
			.map((it) => {
				const w = W[it.work];
				/* Opened and landed items carry the title as text; show the purpose line instead of the title twice. */
				const text = it.text && it.text !== w.title ? it.text : w.purpose;
				return `<a class="ditem" data-key="go:${esc(w.id)}" href="#work/${esc(w.id)}"><b>${esc(w.code)} · ${esc(w.title)}</b>${tag(w)}<span><span class="kd">${esc(KIND_LABEL[it.kind] || it.kind)}</span>${text ? ` ${esc(text)}` : ""}</span></a>`;
			})
			.join("")}
    <p class="note">Dates come from ticket front matter. A day lists what was opened, landed, asked, or found wrong on it.</p></div>`;
	}
	function moduleMid(m, r) {
		const inside = (id) => modOf(id) === m.id;
		const cross = D.edges.filter((e) => inside(e.from) !== inside(e.to));
		const by = {};
		for (const e of cross) {
			const o = modOf(inside(e.from) ? e.to : e.from);
			by[o] ??= [];
			by[o].push(e);
		}
		const ws = [...new Set(m.places.flatMap((p) => workAt[p] || []))];
		return `<div class="mid">${asLayer("module", m.id, `#module/${esc(m.id)}`)}
    ${m.bodyHtml ? `<div class="blk md"><h4>How it works</h4>${m.bodyHtml}</div>` : ""}
    <div class="blk"><h4>Places<small>${m.places.length}</small></h4>${placeList(m.places, r)}</div>
    <div class="blk"><h4>Connections with other modules<small>${cross.length}</small></h4>${
			Object.entries(by)
				.map(
					([o, es]) =>
						`<p class="note sub-h"><b><a href="#module/${esc(o)}">${esc(M[o].title)}</a></b> · ${es.length}</p>${edgeRows(es, r)}`,
				)
				.join("") || '<p class="note">No connection crosses this module.</p>'
		}</div>
    <div class="blk"><h4>Work that touches this module<small>${ws.length}</small></h4>${ws.length ? `<div class="inl">${ws.map((w) => `<a href="#work/${esc(w)}" data-key="go:${esc(w)}">${esc(W[w].code)} · ${esc(W[w].title)}</a>`).join("")}</div>` : '<p class="note">No work item names this module.</p>'}</div></div>`;
	}
	let query = "";
	const match = (...s) => !query || s.join(" ").toLowerCase().includes(query);
	function sections(r) {
		const t = tabOf(r);
		/* The work list stays quiet: asks, problems, open work, and the newest landed work.
		   Typing in the filter searches every lane. An opened item always shows in its group. */
		if (t === "work") {
			return GROUPS.map(([g, name, hint]) => {
				let ws = D.work.filter(
					(w) =>
						w.group === g && (match(w.code, w.title, w.purpose, ...w.touches.map(nodeTitle)) || workOf(r) === w.id),
				);
				let label = name;
				let note = hint;
				if (!query && QUIET_HIDDEN.has(g)) {
					ws = ws.filter((w) => workOf(r) === w.id);
				}
				if (!query && g === "done") {
					ws = ws.filter((w, i) => i < RECENT || workOf(r) === w.id);
					label = "Landed recently";
					note = `The ${RECENT} newest. Type in the filter to search all.`;
				}
				/* Needs Adam stays visible when empty, so "nothing to decide" is said, not implied. */
				if (!ws.length && (g !== "needs" || query)) {
					return "";
				}
				return `<section class="sec"><div class="sec-h"><h2>${label}<small>${ws.length}</small></h2><span>${ws.length ? note : "Nothing waits for you."}</span></div>${ws
					.map((w) => {
						const open = workOf(r) === w.id;
						const meta = [
							w.date,
							w.code,
							w.board ? `${boardText(w.board)} on the board` : null,
							w.lit.length ? plural(w.lit.length, "place") : null,
						]
							.filter(Boolean)
							.map(esc)
							.join(" · ");
						return `<div class="entry${open ? " open" : ""}">${row(`work:${w.id}`, open ? "#plant/work" : `#work/${esc(w.id)}`, open, "Feature", esc(w.title) + tag(w), esc(w.purpose), meta, w.lit)}${open ? workMid(w, r) : ""}</div>`;
					})
					.join("")}</section>`;
			}).join("");
		}
		if (t === "journeys") {
			const js = D.journeys.filter((j) => match(j.title, j.purpose) || r.id === j.id);
			return `<section class="sec"><div class="sec-h"><h2>Journeys<small>${js.length}</small></h2><span>Ordered steps through the plant</span></div>${js
				.map((j) => {
					const open = r.view === "journey" && r.id === j.id;
					const ps = [...new Set(j.steps.flatMap((s) => (s.place ? spread(s.place) : [])))];
					return `<div class="entry${open ? " open" : ""}">${row(`journey:${j.id}`, open ? "#plant/journeys" : `#journey/${esc(j.id)}`, open, "Journey", esc(j.title) + tag(j), esc(j.purpose), `${plural(j.steps.length, "step")} · ${plural(ps.length, "place")}`, ps)}${open ? journeyMid(j, r) : ""}</div>`;
				})
				.join("")}</section>`;
		}
		if (t === "days") {
			const ds = D.days.filter(
				(d) => match(d.title, d.purpose, ...d.items.map((i) => W[i.work].code)) || r.id === d.id,
			);
			return `<section class="sec"><div class="sec-h"><h2>Days<small>${ds.length}</small></h2><span>What changed, by date</span></div>${ds
				.map((d) => {
					const open = r.view === "day" && r.id === d.id;
					const ps = [...new Set(d.items.flatMap((i) => W[i.work].lit))];
					const tags = [...new Set(d.items.map((i) => W[i.work]).filter((w) => w.signal && w.signal !== "changed"))]
						.map(tag)
						.join("");
					const codes = [...new Set(d.items.map((i) => W[i.work].code))];
					return `<div class="entry${open ? " open" : ""}">${row(`day:${d.id}`, open ? "#plant/days" : `#day/${esc(d.id)}`, open, "Day", esc(d.title) + tags, esc(d.purpose), `${plural(d.items.length, "entry", "entries")} · ${esc(codes.join(" · "))}`, ps)}${open ? dayMid(d) : ""}</div>`;
				})
				.join("")}</section>`;
		}
		return D.modules
			.map((m) => {
				const ps = m.places.filter((p) => match(P[p].title, P[p].gloss) || r.id === p);
				if (!ps.length && !match(m.title)) {
					return "";
				}
				const mopen = r.view === "module" && r.id === m.id;
				const single = m.places.length === 1 && m.places[0] === m.id;
				const crossing = D.edges.filter((e) => (modOf(e.from) === m.id) !== (modOf(e.to) === m.id)).length;
				return `<section class="sec"><div class="sec-h"><h2>${esc(m.title)}<small>${m.places.length}</small></h2><span><a href="${mopen ? "#plant/places" : `#module/${esc(m.id)}`}">${mopen ? "Close module" : "Open module"}</a></span></div>
      ${mopen ? `<div class="entry open">${row(`module:${m.id}`, "#plant/places", true, "Module", esc(m.title), esc(m.gloss), `${plural(m.places.length, "place")} · ${plural(crossing, "connection")} to other modules`, m.places)}${moduleMid(m, r)}</div>` : ""}
      ${ps
				.filter(() => !mopen || !single)
				.map((p) => {
					const open = r.view === "place" && !r.via && r.id === p;
					const x = P[p];
					return `<div class="entry${open ? " open" : ""}">${row(`place:${p}`, open ? "#plant/places" : `#place/${esc(p)}`, open, "Place", esc(x.title) + (x.status === "partial" ? '<span class="tag partial">Partial</span>' : ""), esc(x.gloss), `${plural((workAt[p] || []).length, "work item")} · ${plural((jAt[p] || []).length, "journey")} · ${plural(edgesAt(p).length, "connection")}`, [p], true)}${open ? `<div class="mid">${asLayer("place", p, `#place/${esc(p)}`)}${placeBody(p, r, false)}</div>` : ""}</div>`;
				})
				.join("")}</section>`;
			})
			.join("");
	}
	/* Cut at a word boundary, so a title never ends mid-word. */
	function cut(s, n) {
		if (s.length <= n) {
			return s;
		}
		const head = s.slice(0, n - 1);
		const space = head.lastIndexOf(" ");
		return `${(space > n / 2 ? head.slice(0, space) : head).replace(/[\s,;:·-]+$/, "")}…`;
	}
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: split pending: breadcrumb builder
	function crumbs(r) {
		const t = tabOf(r);
		const tabName = TABS.find((x) => x[0] === t)[1];
		const c = [`<a href="#plant/${t}">Plant</a>`];
		if (r.view !== "plant") {
			c.push(`<a href="#plant/${t}">${tabName}</a>`);
		} else {
			c.push(`<b>${tabName}</b>`);
		}
		const w = workOf(r);
		if (w) {
			const x = W[w];
			const deeper = (r.ev !== null && r.ev !== undefined) || r.view === "place";
			c.push(
				deeper
					? `<a href="#work/${esc(w)}">${esc(x.code)} · ${esc(cut(x.title, 24))}</a>`
					: `<b>${esc(x.code)} · ${esc(cut(x.title, 48))}</b>`,
			);
			if (r.view === "work" && r.ev !== null) {
				c.push(`<b>Source: ${esc(x.evidence[r.ev].title)}</b>`);
			}
			if (r.view === "place") {
				c.push(`<b>Place: ${esc(P[r.id].title)}</b>`);
			}
		}
		if (r.view === "place" && !r.via) {
			c.push(`<a href="#module/${esc(P[r.id].module)}">${esc(M[P[r.id].module].title)}</a>`);
			c.push(`<b>${esc(P[r.id].title)}</b>`);
		}
		if (r.view === "module") {
			c.push(`<b>Module: ${esc(M[r.id].title)}</b>`);
		}
		if (r.view === "journey") {
			const j = J[r.id];
			c.push(r.step ? `<a href="#journey/${esc(j.id)}">${esc(cut(j.title, 30))}</a>` : `<b>${esc(j.title)}</b>`);
			if (r.step) {
				c.push(`<b>Step ${r.step}: ${esc(nodeTitle(j.steps[r.step - 1].place))}</b>`);
			}
		}
		if (r.view === "day") {
			c.push(`<b>${esc(Y[r.id].title)}</b>`);
		}
		const up = parentHref(r);
		let upName = null;
		if (r.view !== "plant") {
			const q = parse(up);
			upName =
				q.view === "plant"
					? TABS.find((x) => x[0] === q.tab)[1]
					: q.view === "work"
						? `${W[q.id].code} detail`
						: q.view === "journey"
							? "all steps"
							: "list";
		}
		return `<nav class="crumbs" aria-label="Where you are"><div class="trail"><span class="lbl">Where you are</span>${c.join('<span class="sep">/</span>')}</div>${upName ? `<a class="up" href="${up}" title="Esc">← Back to ${esc(upName)}</a>` : ""}</nav>`;
	}
	/* Build diagnostics, named as what they are: errors and warnings. */
	function noteCount() {
		const notes = D.diagnostics.filter((d) => d.level !== "info");
		const errors = notes.filter((d) => d.level === "error").length;
		return [
			errors ? plural(errors, "error") : "",
			notes.length - errors ? plural(notes.length - errors, "warning") : "",
		]
			.filter(Boolean)
			.join(" and ");
	}
	function notesHtml() {
		const notes = D.diagnostics.filter((d) => d.level !== "info");
		if (!notes.length) {
			return "";
		}
		return `<details class="notes" id="notes"><summary>${noteCount()} from the build</summary><ul>${notes
			.map(
				(d) =>
					`<li><b>${esc(d.level === "error" ? "Error" : "Warning")}</b> ${esc(d.message)}${d.source ? ` <span class="path">${esc(d.source)}${d.line ? `:${d.line}` : ""}</span>` : ""}</li>`,
			)
			.join("")}</ul></details>`;
	}
	function readHtml(r) {
		const t = tabOf(r);
		const hint =
			t === "places"
				? "Every place in the plant, by module. Open one to see its connections and the work that touches it."
				: t === "journeys"
					? "Open a journey to number its steps in the plant."
					: t === "days"
						? "Open a day to light what changed in the plant."
						: "Open work for its reason. The plant lights the places it touches. Esc goes back one step.";
		return (
			crumbs(r) +
			`<div class="tools"><nav class="tabs" aria-label="Lists">${TABS.map(([k, n, c]) => `<a href="#plant/${k}" aria-current="${k === t ? "page" : "false"}">${n}<small>${c}</small></a>`).join("")}</nav><input class="filter" id="filter" type="search" placeholder="Filter (press /)" value="${esc(query)}" aria-label="Filter this list"></div>` +
			(r.view === "plant" ? `<p class="hint">${hint}</p>` : "") +
			(sections(r) || '<p class="empty">Nothing matches this filter.</p>') +
			`<p class="foot">Built by limen picture build from the plant map of ${esc(D.plant.date)}. Work, pins, and days come from the tickets and the board.</p>` +
			notesHtml()
		);
	}
	function renderRead(r) {
		document.getElementById("read").innerHTML = readHtml(r);
		const f = document.getElementById("filter");
		f.addEventListener("input", () => {
			query = f.value.trim().toLowerCase();
			const pos = f.selectionStart;
			renderRead(route);
			applyAtlas(route);
			const g = document.getElementById("filter");
			g.focus();
			g.setSelectionRange(pos, pos);
		});
	}

	/* Navigation: keep the clicked element still; going up keeps the deepest open item still, or reveals its row. */
	let route = null;
	let anchor = null;
	let lastBase = null;
	// An empty hash is the plant: a layer closed after a reload lands on the bare entry and must not redraw the page.
	const baseOf = (h) => String(h).split("~")[0] || "#plant";
	const headH = () => {
		const m = document.getElementById("mast");
		return (
			(getComputedStyle(m).position === "sticky" ? m.offsetHeight : 0) +
			document.querySelector("#read .crumbs").offsetHeight
		);
	};
	function reveal(el) {
		window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - headH() - 10) });
	}
	function upAnchor() {
		const open = document.querySelector("#read .entry.open>.row");
		const k = (
			document.querySelector('#read .evl[aria-expanded="true"],#read .pl.cur,#read .steps a[aria-current="step"]') ||
			open
		)?.closest("[data-key]");
		if (!k) {
			return null;
		}
		const t = k.getBoundingClientRect().top;
		return t > headH()
			? { key: k.dataset.key, top: t, row: open?.dataset.key }
			: { key: (open || k).dataset.key, reveal: true };
	}
	function go(force) {
		const base = baseOf(location.hash);
		/* A layer opened or closed: the page behind stays exactly where it is. */
		if (base === lastBase && !force) {
			return;
		}
		lastBase = base;
		route = parse(base);
		document.getElementById("mast").innerHTML = renderMastHtml(route);
		renderRead(route);
		applyAtlas(route);
		const find = (key) => key && document.querySelector(`#read [data-key="${CSS.escape(key)}"]`);
		const el = anchor && find(anchor.key);
		if (el && !anchor.reveal) {
			window.scrollBy(0, el.getBoundingClientRect().top - anchor.top);
		} else {
			const tgt =
				el ||
				(anchor && find(anchor.row)) ||
				document.getElementById("deep") ||
				document.querySelector("#read .entry.open");
			if (tgt) {
				reveal(tgt);
			} else if (route.view === "plant") {
				window.scrollTo({ top: 0 });
			}
		}
		anchor = null;
	}
	function layerRoute(stack) {
		const top = stack?.[stack.length - 1];
		return top ? parse(`#${top.kind}/${top.id}`) : route;
	}

	function initWireOverview() {
		const overview = document.getElementById("wireOverview");
		/* More than seven modules cannot share a scannable all-pairs overview. */
		overview.setAttribute("aria-pressed", String(D.modules.length <= 7));
		overview.addEventListener("click", () => {
			overview.setAttribute("aria-pressed", String(overview.getAttribute("aria-pressed") !== "true"));
			drawWires();
		});
	}
	function focusWire(target) {
		for (const x of document.querySelectorAll("#over .wire.hot")) {
			x.classList.remove("hot");
		}
		const er = target?.closest("#read [data-wire]");
		let hot = null;
		if (er) {
			const [f, t] = er.dataset.wire.split("|");
			hot = document.querySelector(`#over .wire[data-from="${CSS.escape(f)}"][data-to="${CSS.escape(t)}"]`);
			hot?.classList.add("hot");
		}
		document.getElementById("over").classList.toggle("highlight", !!hot);
	}
	function init() {
		RAW = JSON.parse(document.getElementById("archmap-data").textContent);
		use(adapt(RAW));
		stage = document.getElementById("stage");
		buildAtlas();
		initWireOverview();
		document.addEventListener("focusin", (e) => focusWire(e.target));
		document.addEventListener("focusout", (e) => focusWire(e.relatedTarget));
		document.addEventListener(
			"click",
			(e) => {
				const a = e.target.closest('a[href^="#"]');
				if (!a || a.closest("[data-layer],.layers-root")) {
					return;
				}
				if (a.hasAttribute("data-notes")) {
					e.preventDefault();
					const n = document.getElementById("notes");
					n.open = true;
					n.scrollIntoView();
					return;
				}
				const k = a.closest("[data-key]");
				anchor = a.closest(".crumbs,.deep .back")
					? upAnchor()
					: a.closest("#read") && k
						? { key: k.dataset.key, top: k.getBoundingClientRect().top }
						: null;
				if (a.getAttribute("href") === baseOf(location.hash)) {
					e.preventDefault();
					go(true);
				}
			},
			true,
		);
		window.addEventListener("hashchange", () => go());
		document.addEventListener("keydown", (e) => {
			if (e.target instanceof HTMLInputElement) {
				if (e.key === "Escape") {
					e.target.blur();
				}
				return;
			}
			if (e.key === "Escape" && route.view !== "plant") {
				anchor = upAnchor();
				location.hash = parentHref(route);
			}
			if (e.key === "/") {
				e.preventDefault();
				document.getElementById("filter").focus();
			}
		});
		/* Hover links: preview lighting from rows, mark one wire or place from detail links. */
		document.addEventListener("mouseover", (e) => {
			const atlas = document.getElementById("atlas");
			const rw = e.target.closest("#read .row[data-places]");
			const preview = !!rw && rw.getAttribute("aria-expanded") !== "true";
			atlas.classList.toggle("preview", preview);
			for (const x of stage.querySelectorAll(".place.pv")) {
				x.classList.remove("pv");
			}
			if (preview) {
				for (const id of rw.dataset.places.split(" ")) {
					stage.querySelector(`.place[data-place="${CSS.escape(id)}"]`)?.classList.add("pv");
				}
			}
			for (const x of stage.querySelectorAll(".place.hov")) {
				x.classList.remove("hov");
			}
			const h = e.target.closest("#read [data-hover]");
			if (h?.dataset.hover) {
				stage.querySelector(`.place[data-place="${CSS.escape(h.dataset.hover)}"]`)?.classList.add("hov");
			}
			focusWire(e.target);
		});
		go();
		new ResizeObserver(() => drawWires()).observe(stage);
		PictureLayers.init({ model: RAW, onChange: (stack) => applyAtlas(layerRoute(stack)) });
	}
	init();
})();
