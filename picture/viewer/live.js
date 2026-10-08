(() => {
	"use strict";

	/* Live layer: only a page that `limen picture serve` hands out names an event path. A built file stays offline. */
	const data = document.getElementById("archmap-data");
	if (!data?.dataset.live || (location.protocol !== "http:" && location.protocol !== "https:")) {
		return;
	}

	const STATE = {
		working: { word: "working", live: true, rank: 1 },
		waiting: { word: "waiting", live: true, rank: 2 },
		starting: { word: "starting", live: true, rank: 3 },
		dead: { word: "not responding", live: true, rank: 4 },
		quiet: { word: "quiet", live: true, rank: 5 },
		done: { word: "done", live: false, rank: 6 },
		failed: { word: "failed", live: false, rank: 7 },
		stopped: { word: "stopped", live: false, rank: 8 },
	};
	const esc = (s) =>
		String(s ?? "").replace(
			/[&<>"']/g,
			(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
		);
	const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

	/* Work as the reading column names it: tickets by id, and map features no ticket links, by their code. */
	const model = JSON.parse(data.textContent);
	const parentOf = new Map((model.nodes || []).map((n) => [n.id, n.parent || null]));
	const WORK = new Map();
	for (const w of model.work || []) {
		WORK.set(w.id, { id: w.id, code: w.code, title: w.title, touches: w.touches || [] });
	}
	const linked = new Set((model.work || []).map((w) => w.mapFeature).filter(Boolean));
	for (const f of model.features || []) {
		const code = /\((F\d+)\)\s*$/.exec(f.title || "")?.[1];
		if (code && !linked.has(f.id) && !WORK.has(code.toLowerCase())) {
			const title = f.title.replace(/\s*\(F\d+\)\s*$/, "");
			WORK.set(code.toLowerCase(), { id: f.id, code, title, touches: f.touches || [] });
		}
	}

	let jobs = [];
	/* `limen group` runs with a member on the page: lead, teams, and each team's job ids, coordinator first. */
	let groups = [];
	let byId = new Map();
	/* Jobs by the job they work under: a coordinator's workers, in page order. */
	let kids = new Map();
	let byWork = new Map();
	/* The job the side panel shows, and the panel route it belongs to: another route clears it. */
	let selected = null;
	let selAt = "";
	/* After the next panel render, scroll this record into view. */
	let reveal = "";
	/* Server clock minus page clock, measured when a snapshot arrives. */
	let offset = 0;
	let feed = "connecting";
	let stale = false;
	/* "feed lost at hh:mm:ss" or "feed silent since hh:mm:ss", set when the data goes stale. */
	let lostNote = "";
	/* Page time of the newest `activity` or `ping`; the server pings every 15 s. */
	let heardAt = 0;
	let source = null;

	/* "12 s", "4 min", "2 h 5 min". */
	function length(ms) {
		const s = Math.max(0, Math.round(ms / 1000));
		if (s < 60) {
			return `${s} s`;
		}
		const m = Math.floor(s / 60);
		return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
	}
	/* Time since an ISO moment on the server clock. */
	const since = (iso) => length(Date.now() + offset - Date.parse(iso));
	const age = (iso) => `<span data-live-since="${esc(iso)}">${since(iso)}</span>`;
	const clock = (ms) =>
		[new Date(ms).getHours(), new Date(ms).getMinutes(), new Date(ms).getSeconds()]
			.map((n) => String(n).padStart(2, "0"))
			.join(":");
	const baseOf = (h) => String(h).split("~")[0] || "#plant";
	const isLive = (j) => STATE[j.state]?.live;
	const worksOf = (job) => (job.work || []).map((id) => WORK.get(String(id).toLowerCase())).filter(Boolean);
	const best = (list) => list.reduce((a, j) => (STATE[j.state].rank < STATE[a.state].rank ? j : a)).state;

	/* Every job under this one, depth first. `seen` guards against a loop in the records. */
	function family(j, seen = new Set([j.id])) {
		const out = [];
		for (const k of kids.get(j.id) || []) {
			if (!seen.has(k.id)) {
				seen.add(k.id);
				out.push(k, ...family(k, seen));
			}
		}
		return out;
	}
	function countOf(list) {
		const n = {};
		for (const j of list) {
			n[j.state] = (n[j.state] || 0) + 1;
		}
		return n;
	}
	/* "2 working · 1 not responding", each in its state colour. */
	const countWords = (n) =>
		Object.keys(STATE)
			.filter((s) => n[s])
			.map((s) => `<span class="s-${s}">${n[s]} ${STATE[s].word}</span>`)
			.join(" · ");

	/* What the job does now, as one plain phrase. */
	function nowHtml(j) {
		const doing = esc(j.doing);
		const detail = j.detail ? ` · <span class="live-detail">${esc(j.detail)}</span>` : "";
		switch (j.state) {
			case "working":
				return `${doing || "working"}${detail}`;
			case "waiting":
				return `waiting${j.doing && j.doing !== "waiting" ? ` · ${doing}` : ""}${detail}`;
			case "starting":
				return `starting${detail}`;
			case "quiet":
				return `quiet for ${age(j.lastEventAt)} · last: ${doing || "no step named"}${detail}`;
			case "dead":
				return `<b class="live-word">not responding</b> · last event ${age(j.lastEventAt)} ago${j.doing ? ` · was ${doing}` : ""}`;
			case "done":
				return `done ${age(j.finishedAt || j.lastEventAt)} ago`;
			case "failed":
				return `<b class="live-word">failed:</b> ${doing.replace(/^failed:?\s*/i, "") || "no reason given"}`;
			case "stopped":
				return /^stopped\b/i.test(j.doing) ? doing : `stopped${j.doing ? `: ${doing}` : ""}`;
			default:
				return doing;
		}
	}
	const engineOf = (j) =>
		[j.engine, j.model ? String(j.model).split("/").pop() : ""].filter(Boolean).map(esc).join(" · ");
	function metaHtml(j) {
		const parts = [engineOf(j)].filter(Boolean);
		if (stale) {
			parts.push(lostNote);
		} else if (["working", "waiting", "starting"].includes(j.state)) {
			parts.push(`last event ${age(j.lastEventAt)} ago`);
		} else if (j.state === "failed" || j.state === "stopped") {
			parts.push(`${age(j.finishedAt || j.lastEventAt)} ago`);
		}
		return parts.join(" · ");
	}
	/* How long the job has run, or ran. */
	function runHtml(j) {
		if (isLive(j)) {
			return `running for ${age(j.startedAt)}`;
		}
		const end = j.finishedAt || j.lastEventAt;
		return `ran ${length(Date.parse(end) - Date.parse(j.startedAt))} · ended ${age(end)} ago`;
	}
	/* The feature code names the work; the job's own label, without its F numbers, tells two jobs on one feature apart. */
	function whatHtml(j, inWork) {
		const [w, ...more] = worksOf(j);
		if (!w || inWork) {
			return esc(j.label || j.id);
		}
		const extra = more.length ? ` <small>+ ${more.map((x) => esc(x.code)).join(", ")}</small>` : "";
		const own = String(j.label || "")
			.replace(/\bF\d+\b/gi, " ")
			.replace(/^[\s·:—-]+|[\s·:—-]+$/g, "")
			.replace(/\s+/g, " ");
		return `<b>${esc(w.code)}</b> ${esc(own || w.title)}${extra}`;
	}
	/* A coordinator's workers in a few words; a stuck worker is named, the rest are on the lines below. */
	function rollHtml(fam) {
		if (!fam.length) {
			return "";
		}
		const dead = fam.filter((k) => k.state === "dead").length;
		const live = fam.filter(isLive).length;
		const words = [plural(fam.length, "worker"), live && live < fam.length ? `${live} live` : ""];
		return `<small class="live-roll s-${best(fam)}">${words.filter(Boolean).join(" · ")}${dead ? ` · <b>${dead} not responding</b>` : ""}</small>`;
	}
	/* One job line. Depth indents a worker under the job that spawned it. */
	function lineHtml(j, depth, inWork) {
		const cls = `live-job s-${esc(j.state)}${stale ? " stale" : ""}${j.id === selected ? " sel" : ""}${depth ? " kid" : ""}`;
		const what = `<span class="live-what">${rollHtml(family(j))}${whatHtml(j, inWork)}</span>`;
		return `<li class="${cls}" data-job="${esc(j.id)}" tabindex="0" style="--d:${depth}"><i class="live-mark" aria-hidden="true"></i>${what}<span class="live-now">${nowHtml(j)}</span><span class="live-meta">${metaHtml(j)}</span></li>`;
	}
	function treeHtml(j, depth, inWork, shown) {
		shown.add(j.id);
		let html = lineHtml(j, depth, inWork);
		for (const k of kids.get(j.id) || []) {
			if (!shown.has(k.id)) {
				html += treeHtml(k, depth + 1, inWork, shown);
			}
		}
		return html;
	}
	const groupWork = (g) => g.work.map((id) => WORK.get(id)).find(Boolean);
	/* The lead line carries the whole group's count; each team line its own; then each team's coordinator and workers. */
	function groupHtml(g, inWork, shown) {
		const members = g.teams.flatMap((t) => t.jobs.map((id) => byId.get(id)).filter(Boolean));
		const w = groupWork(g);
		const title = w ? `<b>${esc(w.code)}</b> ${esc(w.title)}` : esc(g.feature);
		const lead = `<li class="live-grp s-${best(members)}${stale ? " stale" : ""}" data-group="${esc(g.id)}" tabindex="0" style="--d:0"><i class="live-mark" aria-hidden="true"></i><span class="live-what"><span class="live-kind">Lead</span>${title}</span><span class="live-now">${countWords(g.count)}</span><span class="live-meta">${esc(g.lead)} · ${plural(g.teams.length, "team")}</span></li>`;
		const teams = g.teams.map((t) => {
			const list = t.jobs.map((id) => byId.get(id)).filter(Boolean);
			const mark = list.length ? ` s-${best(list)}` : "";
			const line = `<li class="live-team kid${mark}${stale ? " stale" : ""}" data-team="${esc(`${g.id}/${t.name}`)}" tabindex="0" style="--d:1"><i class="live-mark" aria-hidden="true"></i><span class="live-what"><span class="live-kind">Team</span>${esc(t.name)}</span><span class="live-now">${countWords(t.count) || "no job on the page"}</span><span class="live-meta">${plural(list.length, "job")}</span></li>`;
			const tops = list.filter((j) => !(j.parent && t.jobs.includes(j.parent)));
			return line + tops.map((j) => treeHtml(j, 2, inWork, shown)).join("");
		});
		return lead + teams.join("");
	}
	/* Groups first, then each job whose parent is not in the list, each with everything under it. */
	function units(list, inWork) {
		const ids = new Set(list.map((j) => j.id));
		const shown = new Set();
		const out = [];
		for (const g of groups) {
			const members = g.teams.flatMap((t) => t.jobs).filter((id) => byId.has(id));
			if (members.some((id) => ids.has(id))) {
				const all = members.map((id) => byId.get(id));
				const html = groupHtml(g, inWork, shown);
				out.push({ html, live: all.some(isLive), brief: `${esc(groupWork(g)?.code || g.feature)} group` });
			}
		}
		const tops = list.filter((j) => !(j.parent && ids.has(j.parent)));
		/* A loop in the records leaves jobs no top reaches: they still get a line. */
		for (const j of [...tops, ...list]) {
			if (!shown.has(j.id)) {
				const all = [j, ...family(j)];
				const html = treeHtml(j, 0, inWork, shown);
				const brief = `${esc(worksOf(j)[0]?.code || j.label || j.id)} ${STATE[j.state]?.word || esc(j.state)} ${age(j.finishedAt || j.lastEventAt)} ago`;
				out.push({ html, live: all.some(isLive), brief });
			}
		}
		return out;
	}

	/* Strip: under the atlas light line, above the map. */
	const strip = document.createElement("section");
	strip.className = "live";
	strip.setAttribute("aria-label", "Jobs running now");
	document.getElementById("lightline").after(strip);
	/* Only a served page can carry place marks, so only it names them in the legend. */
	document
		.querySelector(".legend")
		?.insertAdjacentHTML("beforeend", '<span><i class="k-live" aria-hidden="true"></i>a job works here now</span>');

	/* Finished work folds into one line, so running work keeps the room; the line opens to show each one. */
	let showEnded = false;
	strip.addEventListener(
		"toggle",
		(e) => {
			showEnded = e.target.open;
		},
		true,
	);
	function endedHtml(ended) {
		if (!ended.length) {
			return "";
		}
		const brief = ended.map((u) => u.brief).join(" · ");
		return `<details class="live-ended"${showEnded ? " open" : ""}><summary><b>${ended.length} finished in the last hour</b> · ${brief}</summary><ul class="live-list">${ended.map((u) => u.html).join("")}</ul></details>`;
	}
	function renderStrip() {
		const live = jobs.filter(isLive);
		const all = units(jobs, false);
		const word = { live: "Live", lost: "Reconnecting…", silent: "Silent", connecting: "Connecting…" }[feed];
		const sum =
			feed === "connecting" && !jobs.length
				? ""
				: `<span class="live-sum">${stale ? "last known: " : ""}${countWords(countOf(live)) || "nothing running"}</span>`;
		const lost = stale ? `<span class="live-lost">${lostNote}</span>` : "";
		const on = all.filter((u) => u.live);
		strip.classList.toggle("stale", stale);
		strip.innerHTML =
			`<div class="live-head"><span class="live-feed is-${feed}" role="status"><i aria-hidden="true"></i>${word}</span>${sum}${lost}</div>` +
			(on.length ? `<ul class="live-list">${on.map((u) => u.html).join("")}</ul>` : "") +
			endedHtml(all.filter((u) => !u.live));
	}

	/* Atlas marks: every place a live job's work touches. Marks sit outside the card flow, so wires keep their routes. */
	const stage = document.getElementById("stage");
	function targetsOf(touch) {
		for (let id = touch; id; id = parentOf.get(id)) {
			const place = stage.querySelector(`.place[data-place="${CSS.escape(id)}"]`);
			if (place) {
				return [place];
			}
			const mod = stage.querySelector(`.mod[data-mod="${CSS.escape(id)}"]`);
			if (mod) {
				return [mod, ...mod.querySelectorAll(".place")];
			}
		}
		return [];
	}
	/* Most urgent first, so a click on a mark or a tag opens the job that needs a look. */
	const byRank = (list) => [...list].sort((a, b) => STATE[a.state].rank - STATE[b.state].rank);
	const idsOf = (list) =>
		esc(
			byRank(list)
				.map((j) => j.id)
				.join(" "),
		);
	function markAtlas() {
		for (const el of stage.querySelectorAll(".live-pin")) {
			el.remove();
		}
		const at = new Map();
		for (const j of jobs.filter(isLive)) {
			for (const el of new Set(worksOf(j).flatMap((w) => w.touches.flatMap(targetsOf)))) {
				at.set(el, [...(at.get(el) || []), j]);
			}
		}
		for (const [el, list] of at) {
			el.insertAdjacentHTML(
				"beforeend",
				`<i class="live-pin s-${best(list)}${stale ? " stale" : ""}" data-jobs="${idsOf(list)}" aria-label="${esc(plural(list.length, "job"))} here now"></i>`,
			);
		}
	}

	/* Side panel: the selected job's details, under its line or, with no line in the panel, as an entry on top. */
	function cardHtml(j) {
		const parent = j.parent && byId.get(j.parent);
		const g = j.group && groups.find((x) => x.id === j.group);
		const fam = family(j);
		const rows = [
			[
				"State",
				`<span class="live-st s-${esc(j.state)}"><i class="live-mark" aria-hidden="true"></i>${STATE[j.state]?.word || esc(j.state)}</span>`,
			],
			["Now", nowHtml(j)],
			["Engine", engineOf(j) || "not recorded yet"],
			["Last activity", stale ? lostNote : `${age(j.lastEventAt)} ago`],
			["Run time", `${runHtml(j)} · started ${clock(Date.parse(j.startedAt) - offset)}`],
			["Tools", `${plural(j.tools || 0, "tool call")} · ${j.hosted ? "runs in a Herdr tab" : "not in a visible tab"}`],
			parent ? ["Spawned by", `<span class="live-ref" data-job="${esc(parent.id)}">${esc(parent.label)}</span>`] : null,
			g ? ["Group", `${esc(groupWork(g)?.code || g.feature)} · ${esc(j.team || "")} · lead ${esc(g.lead)}`] : null,
			["Job", `<code>${esc(j.id)}</code>`],
		].filter(Boolean);
		const list = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
		const workers = fam.length
			? `<h5>Workers<small>${countWords(countOf(fam))}</small></h5><ul class="live-list">${(kids.get(j.id) || []).map((k) => treeHtml(k, 0, false, new Set([j.id]))).join("")}</ul>`
			: "";
		return `<div class="live-card${stale ? " stale" : ""}"><dl>${list}</dl>${workers}</div>`;
	}
	function entryHtml(j) {
		const href = esc(baseOf(location.hash));
		const row = `<a class="row" data-key="job:${esc(j.id)}" data-live-close href="${href}" aria-expanded="true" title="Close the job"><span class="kind">Job</span><span><span class="t">${esc(j.label || j.id)}</span><span class="pp">${STATE[j.state]?.word || esc(j.state)} · ${engineOf(j)}</span><span class="meta">This job names no feature, so the panel shows it here.</span></span><span class="ch" aria-hidden="true">−</span></a>`;
		return `<div class="entry open live-entry">${row}<div class="mid">${cardHtml(j)}</div></div>`;
	}

	/* Reading column: a mark on each work row with a live job, and the jobs at the top of an opened work. */
	function tagHtml(list) {
		const s = best(list);
		const more = list.length > 1 ? ` · ${list.length} jobs` : "";
		return `<span class="live-tag s-${s}${stale ? " stale" : ""}" data-jobs="${idsOf(list)}"><i aria-hidden="true"></i>${STATE[s].word}${more}</span>`;
	}
	function blockHtml(list) {
		const html = units(list, true)
			.map((u) => u.html)
			.join("");
		return `<div class="live-blk${stale ? " stale" : ""}"><h4>Jobs on this now<small>${list.length}</small></h4><ul class="live-list">${html}</ul></div>`;
	}
	function markRead() {
		const read = document.getElementById("read");
		for (const el of read.querySelectorAll(".live-tag,.live-blk,.live-entry,.live-card-li")) {
			el.remove();
		}
		if (selected && (selAt !== baseOf(location.hash) || !byId.has(selected))) {
			selected = null;
			renderStrip();
		}
		for (const row of read.querySelectorAll('a.row[data-key^="work:"]')) {
			const all = byWork.get(row.dataset.key.slice(5)) || [];
			const live = all.filter(isLive);
			if (live.length) {
				row.querySelector(".t")?.insertAdjacentHTML("beforeend", tagHtml(live));
			}
			const mid = row.closest(".entry.open")?.querySelector(":scope > .mid");
			if (!(mid && all.length)) {
				continue;
			}
			/* Under the "Open as a layer" link, above the outcome. */
			const top = mid.querySelector(":scope > .as-layer");
			if (top) {
				top.insertAdjacentHTML("afterend", blockHtml(all));
			} else {
				mid.insertAdjacentHTML("afterbegin", blockHtml(all));
			}
		}
		showSelected(read);
	}
	function showSelected(read) {
		const j = selected && byId.get(selected);
		if (j) {
			const line = read.querySelector(`.live-blk .live-job[data-job="${CSS.escape(j.id)}"]`);
			if (line) {
				line.insertAdjacentHTML("afterend", `<li class="live-card-li">${cardHtml(j)}</li>`);
			} else {
				const at = read.querySelector(":scope > .hint") || read.querySelector(":scope > .tools");
				at?.insertAdjacentHTML("afterend", entryHtml(j));
			}
		}
		const want = reveal;
		reveal = "";
		const target = want && read.querySelector(want);
		if (target) {
			target.scrollIntoView({ block: "center" });
		}
	}
	function markLayers() {
		for (const layer of document.querySelectorAll('.layers-root .layer[data-key^="work/"]')) {
			layer.querySelector(".live-blk")?.remove();
			const list = byWork.get(layer.dataset.key.slice(5)) || [];
			if (list.length) {
				layer.querySelector(".layer-body")?.insertAdjacentHTML("afterbegin", blockHtml(list));
			}
		}
	}

	/* A click on a record opens it in the side panel: on its feature when it names one, else as a job entry on top.
	   A record already in the panel opens in place. */
	function open(id, inPanel) {
		const j = byId.get(id);
		if (!j) {
			return;
		}
		selected = j.id;
		const here = baseOf(location.hash);
		const panelLine = document.querySelector(`#read .live-blk .live-job[data-job="${CSS.escape(j.id)}"]`);
		const w = worksOf(j)[0];
		selAt = here;
		if (w && !(inPanel && panelLine)) {
			selAt = `#work/${w.id}`;
		}
		reveal = `.live-job.sel[data-job="${CSS.escape(j.id)}"] + .live-card-li, .live-entry`;
		/* The strip marks the selected line at once; the panel follows the route. */
		renderStrip();
		if (selAt === here) {
			markRead();
		} else {
			location.hash = selAt;
		}
	}
	function openGroup(g) {
		const w = groupWork(g);
		if (!w) {
			const first = g.teams.flatMap((t) => t.jobs).find((id) => byId.has(id));
			if (first) {
				open(first, false);
			}
			return;
		}
		selected = null;
		renderStrip();
		reveal = `.live-blk .live-grp[data-group="${CSS.escape(g.id)}"]`;
		if (baseOf(location.hash) === `#work/${w.id}`) {
			markRead();
		} else {
			location.hash = `#work/${w.id}`;
		}
	}
	function activate(el) {
		hideTip();
		if (el.matches("[data-live-close]")) {
			selected = null;
			renderStrip();
			markRead();
			return;
		}
		const inPanel = !!el.closest("#read");
		if (el.dataset.job) {
			open(el.dataset.job, inPanel);
		} else if (el.dataset.jobs) {
			open(el.dataset.jobs.split(" ")[0], inPanel);
		} else if (el.dataset.group) {
			const g = groups.find((x) => x.id === el.dataset.group);
			if (g) {
				openGroup(g);
			}
		} else if (el.dataset.team) {
			const first = teamOf(el.dataset.team).team?.jobs[0];
			if (first) {
				open(first, inPanel);
			}
		}
	}
	const RECORD = "[data-job],[data-jobs],[data-group],[data-team],[data-live-close]";
	/* Window capture runs before the viewer's document handler, so a mark on a place opens the job, not the place. */
	window.addEventListener(
		"click",
		(e) => {
			const el = e.target.closest?.(RECORD);
			if (!el || el.closest(".live-tip")) {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			activate(el);
		},
		true,
	);
	document.addEventListener("keydown", (e) => {
		const el = e.target.closest?.("[data-job],[data-group],[data-team]");
		if (el && (e.key === "Enter" || e.key === " ")) {
			e.preventDefault();
			activate(el);
		}
	});

	/* Hover: one small card beside the record with who runs it, its state, its last activity, and how long it ran. */
	const tip = document.createElement("div");
	tip.className = "live-tip";
	tip.setAttribute("role", "tooltip");
	tip.hidden = true;
	document.body.append(tip);
	let tipOn = null;
	function jobTip(j) {
		const fam = family(j);
		return [
			`<b>${esc(j.label || j.id)}</b>`,
			engineOf(j) ? `<span>${engineOf(j)}</span>` : "",
			`<span class="live-st s-${esc(j.state)}"><i class="live-mark" aria-hidden="true"></i>${STATE[j.state]?.word || esc(j.state)}${j.doing && j.state !== "dead" && j.doing !== j.state ? ` · ${esc(j.doing)}` : ""}</span>`,
			`<span>${stale ? lostNote : `last activity ${age(j.lastEventAt)} ago`} · ${runHtml(j)}</span>`,
			fam.length ? `<span>${plural(fam.length, "worker")}: ${countWords(countOf(fam))}</span>` : "",
		].join("");
	}
	function marksTip(ids) {
		const list = ids
			.split(" ")
			.map((id) => byId.get(id))
			.filter(Boolean);
		const lines = list.map(
			(j) =>
				`<span class="live-st s-${esc(j.state)}"><i class="live-mark" aria-hidden="true"></i>${esc(j.label || j.id)} · ${STATE[j.state]?.word} · ${engineOf(j)} · ${runHtml(j)}</span>`,
		);
		const which = list.length > 1 ? "the most urgent" : "it";
		return `<b>${plural(list.length, "job")} here now</b>${lines.join("")}<em>Click to open ${which} in the side panel</em>`;
	}
	function groupTip(g) {
		const w = groupWork(g);
		const counts = countWords(g.count) || "no job on the page";
		return `<b>Group lead ${esc(g.lead)}</b><span>${esc(w ? `${w.code} · ${w.title}` : g.feature)}</span><span>${plural(g.teams.length, "team")} · ${counts}</span><em>Click to open the feature in the side panel</em>`;
	}
	function teamTip(name, t) {
		const first = byId.get(t.jobs[0]);
		const who = first?.role === "coordinator" ? "coordinator" : "first job";
		const hint = first
			? `<span>${who}: ${esc(first.label)}</span><em>Click to open the ${who} in the side panel</em>`
			: "";
		return `<b>${esc(name)}</b><span>${countWords(t.count) || "no job on the page"}</span>${hint}`;
	}
	/* `group-id/team-name` to the team and its name. */
	function teamOf(key) {
		const [gid, name] = key.split("/");
		return { name, team: groups.find((x) => x.id === gid)?.teams.find((x) => x.name === name) };
	}
	function tipHtml(el) {
		const { job, jobs: ids, group, team } = el.dataset;
		const j = job && byId.get(job);
		const g = group && groups.find((x) => x.id === group);
		const t = team && teamOf(team);
		if (j) {
			return `${jobTip(j)}<em>Click to open it in the side panel</em>`;
		}
		if (ids) {
			return marksTip(ids);
		}
		if (g) {
			return groupTip(g);
		}
		return t?.team ? teamTip(t.name, t.team) : "";
	}
	function showTip(el) {
		const html = el && tipHtml(el);
		if (!html) {
			hideTip();
			return;
		}
		tipOn = el;
		tip.innerHTML = html;
		tip.hidden = false;
		const r = el.getBoundingClientRect();
		const w = tip.offsetWidth;
		const h = tip.offsetHeight;
		const below = r.bottom + 6 + h < window.innerHeight;
		tip.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
		tip.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - h - 6)}px`;
	}
	function hideTip() {
		tipOn = null;
		tip.hidden = true;
	}
	document.addEventListener("mouseover", (e) => {
		const el = e.target.closest?.("[data-job],[data-jobs],[data-group],[data-team]");
		if (el !== tipOn) {
			showTip(el);
		}
	});
	document.addEventListener("focusin", (e) => showTip(e.target.closest?.("[data-job],[data-group],[data-team]")));
	window.addEventListener("scroll", hideTip, { passive: true, capture: true });
	/* A new snapshot redraws the records: the card follows the record under the pointer, or closes. */
	function retip() {
		if (!tipOn) {
			return;
		}
		const key = ["job", "jobs", "group", "team"].find((k) => tipOn.dataset[k] !== undefined);
		const attr = key && `data-${key}`;
		const again = attr && document.querySelector(`[${attr}="${CSS.escape(tipOn.dataset[key])}"]:hover`);
		if (again) {
			showTip(again);
		} else {
			hideTip();
		}
	}

	function apply() {
		byId = new Map(jobs.map((j) => [j.id, j]));
		kids = new Map();
		for (const j of jobs) {
			if (j.parent && byId.has(j.parent)) {
				kids.set(j.parent, [...(kids.get(j.parent) || []), j]);
			}
		}
		byWork = new Map();
		for (const j of jobs) {
			for (const w of worksOf(j)) {
				byWork.set(w.id, [...(byWork.get(w.id) || []), j]);
			}
		}
		renderStrip();
		markAtlas();
		markRead();
		markLayers();
		retip();
	}
	/* Ages tick in the page; a new snapshot comes only when something changes. An open feed with no message for 45 s
	   is as stale as a lost one. */
	function tick() {
		for (const el of document.querySelectorAll("[data-live-since]")) {
			const text = since(el.dataset.liveSince);
			if (el.textContent !== text) {
				el.textContent = text;
			}
		}
		if (feed === "live" && Date.now() - heardAt > 45_000) {
			feed = "silent";
			stale = true;
			lostNote = `feed silent since ${clock(heardAt)}`;
			apply();
		}
	}

	function connect() {
		source = new EventSource(data.dataset.live);
		source.addEventListener("open", () => {
			feed = "live";
			heardAt = Date.now();
			renderStrip();
		});
		source.addEventListener("activity", (e) => {
			const snap = JSON.parse(e.data);
			offset = Date.parse(snap.at) - Date.now() || 0;
			jobs = Array.isArray(snap.jobs) ? snap.jobs : [];
			groups = Array.isArray(snap.groups) ? snap.groups : [];
			feed = "live";
			heardAt = Date.now();
			stale = false;
			apply();
		});
		source.addEventListener("ping", () => {
			heardAt = Date.now();
			if (feed === "silent") {
				feed = "live";
				stale = false;
				apply();
			}
		});
		/* Nothing may claim to run on old data: every line, mark, and tag dims and names when the feed was lost. */
		source.addEventListener("error", () => {
			if (!stale) {
				lostNote = `feed lost at ${clock(Date.now())}`;
			}
			feed = "lost";
			stale = true;
			apply();
			if (source.readyState === EventSource.CLOSED) {
				setTimeout(connect, 5000);
			}
		});
	}

	renderStrip();
	/* The viewer redraws the reading column on each route; the job entry this layer adds there is not a redraw. */
	const ours = (n) => n.nodeType === 1 && n.classList.contains("live-entry");
	new MutationObserver((records) => {
		if (records.some((r) => [...r.addedNodes, ...r.removedNodes].some((n) => !ours(n)))) {
			markRead();
		}
	}).observe(document.getElementById("read"), { childList: true });
	const stack = document.querySelector(".layers-root .layers-stack");
	if (stack) {
		new MutationObserver(markLayers).observe(stack, { childList: true });
	}
	setInterval(tick, 1000);
	connect();
})();
