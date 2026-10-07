# Team 3 notes · page cohesion and known gaps

Product: `~/overment/lab/optchat-explainer/`. Contract followed: v1. Review findings closed: 1, 3 (hero and stats half), 5, 6.

## Copy (one idea: compaction loses reach; OptChat blurs and keeps a zoom path)

- Title lead (`optchat.svx`): adds "fixed-budget view" and "A zoom opens any blurred line back to the words."
- Hero captions (`Hero.svelte`): `view` = "the whole log under a 128 KB budget · drawn as 32 lines; the real view holds ~500". Default hover info = "each line zooms down to the messages under it" (replaces "what every call sees", finding 1). New legend: orange dot = "not summarized yet · the next call waits".
- Stats (`data.js` `stats`): "fixed-budget view over the whole log"; "512 B target per summary line"; "3–5 zooms to a message, typically. A summary can drop the clue."
- Section 02 lead: "No step replaces the log with a summary: the log only grows, and zoom reads it back." The loop's `zoom` edge is now solid (contract: solid = zoom, dashed = return/rare); legend reads "forward and zoom" / "the reply returns".
- Section 03 lead: "…so zoom has a path from each line down to the words. A compacted thread has no such path." Zoom label: "zoom, from a blurred line down to the words". Empty zoom text names the typical path: "it can only search, and agents rarely do."
- Rules table: "a large tool output forces merges that never undo" (finding 6; no "30 KB").
- Detail data: `you` "no thread-wide compaction"; compactor "512 B target"; tree sub "~512 B lines"; view sub "≤ 128 KB, blurs with age".
- Coda: kept "Nothing is deleted. The past only blurs." Added `.oc-contrast` line: "A compacted thread loses reach. OptChat blurs the past and keeps a zoom path to every message."

## Known gaps (HANDOFF Part 1)

- Gap 7 closed: reduced motion draws the hero end state once (1,024 messages, newest line orange) and runs no frame loop; replay redraws it. Loop tokens and their legend items hide. Memory never autoplays.
- Gap 1 closed: hero `rgb()` → `color-mix(in srgb, var(--text) N%, transparent)`, same values (`--text` = #0a0a0a). Also tokenized the two raw hexes in `theme.css` (`.btn.primary:hover`, coda gradient) with `color-mix` at matching lightness.
- Gap 5 closed: non-selected loop nodes dim to 0.6 (`.face` and text); hover/focus raises to 1. An opaque `.back` rect under each node keeps tokens hidden behind dimmed nodes.
- Gap 4 closed: `next turn`, `play`, `−`, `+` carry a `title` that says why they are off (or what they do).
- Gap 2 closed: `body:has(.oc-hero)` removed. Tokens live on `article.doc` only. The article is full width and centers its 76rem column with padding (`max(3.5rem, calc((100% - 76rem) / 2 + 3.5rem))`), so the page stays one white sheet: light and dark schemes both measured article = viewport width, h1 x unchanged (160.5 px at 1440). Remaining differences: body background (hidden under the article) and the root scrollbar follow the system scheme; in the svx daemon the viewer's top bar now uses its own tokens instead of white.
- Gap 3 closed: demo row in the simulator. `zoom to an old ruling` (jump to message 48, zoom path to the oldest user message a coarse line names), `a summary drops a detail` (path to one the line dropped; note says the agent has no clue to zoom there, §4.4), `a call before the summaries` (guard: 4 unsummarized lines, the call waits; status `.guard` then says "call N waited for 4 lines, so it saw no cut text"). New `Memory` methods: `jump(T)`, `rush(n)`, `zoomTo(i)`, state `waited`.
- Gap 6: radius audit = `6px` (chip, panel, btn, row) + `50%` (dot); alignment probe (`.panel .label`) = []. SVG node `rx="6"` matches.

## Also fixed

- Hero intro let the log scale run past the figure's right edge while it eased; `x()` now clamps to the figure width.

## Open

- Section 04 header labels at 900 px sit tight ("system view", "message step 1"); no overlap. Not changed.
- No contract change requested.
