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
	let byWork = new Map();
	/* Server clock minus page clock, measured when a snapshot arrives. */
	let offset = 0;
	let feed = "connecting";
	let stale = false;
	/* "feed lost at hh:mm:ss" or "feed silent since hh:mm:ss", set when the data goes stale. */
	let lostNote = "";
	/* Page time of the newest `activity` or `ping`; the server pings every 15 s. */
	let heardAt = 0;
	let source = null;

	/* "12 s", "4 min", "2 h 5 min": time since an ISO moment on the server clock. */
	function since(iso) {
		const s = Math.max(0, Math.round((Date.now() + offset - Date.parse(iso)) / 1000));
		if (s < 60) {
			return `${s} s`;
		}
		const m = Math.floor(s / 60);
		return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
	}
	const age = (iso) => `<span data-live-since="${esc(iso)}">${since(iso)}</span>`;
	const clock = (ms) =>
		[new Date(ms).getHours(), new Date(ms).getMinutes(), new Date(ms).getSeconds()]
			.map((n) => String(n).padStart(2, "0"))
			.join(":");
	const worksOf = (job) => (job.work || []).map((id) => WORK.get(String(id).toLowerCase())).filter(Boolean);

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
	function metaHtml(j) {
		const parts = [j.engine, j.model ? String(j.model).split("/").pop() : ""].filter(Boolean).map(esc);
		if (stale) {
			parts.push(lostNote);
		} else if (["working", "waiting", "starting"].includes(j.state)) {
			parts.push(`last event ${age(j.lastEventAt)} ago`);
		} else if (j.state === "failed" || j.state === "stopped") {
			parts.push(`${age(j.finishedAt || j.lastEventAt)} ago`);
		}
		return parts.join(" · ");
	}
	function whatHtml(j) {
		const [w, ...more] = worksOf(j);
		if (!w) {
			return `<span class="live-what">${esc(j.label || j.id)}</span>`;
		}
		const extra = more.length ? ` <small>+ ${more.map((x) => esc(x.code)).join(", ")}</small>` : "";
		return `<a class="live-what" href="#work/${esc(w.id)}"><b>${esc(w.code)}</b> ${esc(w.title)}${extra}</a>`;
	}
	/* One job line. The strip leads with the feature; a work detail leads with the job's own label. */
	function lineHtml(j, inWork) {
		const hint = [
			j.label,
			j.id,
			`${j.tools || 0} tool calls · ${j.hosted ? "runs in a Herdr tab" : "not in a visible tab"}`,
			j.startedAt ? `started ${clock(Date.parse(j.startedAt) - offset)}` : "",
			j.detail,
		].filter(Boolean);
		const what = inWork ? `<span class="live-what">${esc(j.label || j.id)}</span>` : whatHtml(j);
		return `<li class="live-job s-${esc(j.state)}${stale ? " stale" : ""}" title="${esc(hint.join("\n"))}"><i class="live-mark" aria-hidden="true"></i>${what}<span class="live-now">${nowHtml(j)}</span><span class="live-meta">${metaHtml(j)}</span></li>`;
	}

	/* Strip: under the atlas light line, above the map. */
	const strip = document.createElement("section");
	strip.className = "live";
	strip.setAttribute("aria-label", "Jobs running now");
	document.getElementById("lightline").after(strip);

	function summary(live) {
		const n = {};
		for (const j of live) {
			n[j.state] = (n[j.state] || 0) + 1;
		}
		const parts = Object.keys(STATE)
			.filter((s) => n[s])
			.map((s) => `<span class="s-${s}">${n[s]} ${STATE[s].word}</span>`);
		return parts.join(" · ") || "nothing running";
	}
	/* Finished jobs fold into one line, so running work keeps the room; the line opens to show each one. */
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
		const brief = ended
			.map(
				(j) =>
					`${esc(worksOf(j)[0]?.code || j.label || j.id)} ${STATE[j.state]?.word || esc(j.state)} ${age(j.finishedAt || j.lastEventAt)} ago`,
			)
			.join(" · ");
		return `<details class="live-ended"${showEnded ? " open" : ""}><summary><b>${ended.length} finished in the last hour</b> · ${brief}</summary><ul class="live-list">${ended.map((j) => lineHtml(j, false)).join("")}</ul></details>`;
	}
	function renderStrip() {
		const live = jobs.filter((j) => STATE[j.state]?.live);
		const word = { live: "Live", lost: "Reconnecting…", silent: "Silent", connecting: "Connecting…" }[feed];
		const sum =
			feed === "connecting" && !jobs.length
				? ""
				: `<span class="live-sum">${stale ? "last known: " : ""}${summary(live)}</span>`;
		const lost = stale ? `<span class="live-lost">${lostNote}</span>` : "";
		strip.classList.toggle("stale", stale);
		strip.innerHTML =
			`<div class="live-head"><span class="live-feed is-${feed}" role="status"><i aria-hidden="true"></i>${word}</span>${sum}${lost}</div>` +
			(live.length ? `<ul class="live-list">${live.map((j) => lineHtml(j, false)).join("")}</ul>` : "") +
			endedHtml(jobs.filter((j) => !STATE[j.state]?.live));
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
	const best = (list) => list.reduce((a, j) => (STATE[j.state].rank < STATE[a.state].rank ? j : a)).state;
	const jobText = (j) => {
		const w = worksOf(j)[0];
		return `${w ? `${w.code} · ` : ""}${STATE[j.state].word}${j.doing && j.state !== "dead" ? ` · ${j.doing}` : ""}`;
	};
	function markAtlas() {
		for (const el of stage.querySelectorAll(".live-pin")) {
			el.remove();
		}
		for (const el of stage.querySelectorAll("[data-live-title]")) {
			el.title = el.dataset.liveTitle;
			delete el.dataset.liveTitle;
		}
		const at = new Map();
		for (const j of jobs.filter((x) => STATE[x.state]?.live)) {
			for (const el of new Set(worksOf(j).flatMap((w) => w.touches.flatMap(targetsOf)))) {
				at.set(el, [...(at.get(el) || []), j]);
			}
		}
		const note = stale ? `\n(${lostNote}; this may be out of date)` : "";
		for (const [el, list] of at) {
			const text = `Jobs here now:\n${list.map(jobText).join("\n")}${note}`;
			el.insertAdjacentHTML(
				"beforeend",
				`<i class="live-pin s-${best(list)}${stale ? " stale" : ""}" title="${esc(text)}" aria-hidden="true"></i>`,
			);
			if (el.matches(".place")) {
				el.dataset.liveTitle = el.title;
				el.title = `${el.title}\n\n${text}`;
			}
		}
	}

	/* Reading column: a mark on each work row with a live job, and the jobs at the top of an opened work. */
	function tagHtml(list) {
		const s = best(list);
		const more = list.length > 1 ? ` · ${list.length} jobs` : "";
		return `<span class="live-tag s-${s}${stale ? " stale" : ""}" title="${esc(list.map(jobText).join("\n"))}"><i aria-hidden="true"></i>${STATE[s].word}${more}</span>`;
	}
	function blockHtml(list) {
		return `<div class="live-blk${stale ? " stale" : ""}"><h4>Jobs on this now<small>${list.length}</small></h4><ul class="live-list">${list.map((j) => lineHtml(j, true)).join("")}</ul></div>`;
	}
	function markRead() {
		const read = document.getElementById("read");
		for (const el of read.querySelectorAll(".live-tag,.live-blk")) {
			el.remove();
		}
		for (const row of read.querySelectorAll('a.row[data-key^="work:"]')) {
			const all = byWork.get(row.dataset.key.slice(5)) || [];
			const live = all.filter((j) => STATE[j.state]?.live);
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

	function apply() {
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
	new MutationObserver(markRead).observe(document.getElementById("read"), { childList: true });
	const stack = document.querySelector(".layers-root .layers-stack");
	if (stack) {
		new MutationObserver(markLayers).observe(stack, { childList: true });
	}
	setInterval(tick, 1000);
	connect();
})();
