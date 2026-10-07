# F931 · Team 2 notes (mixed visuals)

## Seams

- `lib/run.js` (new): the one seeded run, `run = simulate()` and `turns = perTurn(run)`. Every cache figure imports it, so the 20,000-message fold runs once (~80 ms). New cache figures should import it too.
- `lib/Turns.svelte` (new, section 01, after `<Compare />`): per-turn simulated main-agent input, one panel per side, one KB scale. Black paid at the base, grey read from cache above. Typical compactions are hatched ticks under the axis ("compaction call"); their KB is never in the bars, only in the hover line and the note under the chart. Hover shows one turn on both sides. Totals sit in the right label column.
- `lib/Request.svelte` (section 04, rewritten): rows from `examples(run)`, drawn to scale on 0–400 KB (the assumed window). The segment builders: `plain` (cached prefix, new part), `fresh` (first request after compaction: tools + system, summary, new part, plus the hatched drop up to the compaction call's size), `start` (OptChat turn start cut at `FIXED + MARKS` and `FIXED + BUDGET`). Under the rows: the simulated view-hit counts of the whole run and `CACHE_LABELS.measured`.
- `lib/Compare.svelte` (section 01 context chart): the area is now `--line` (read from cache); each drop has a black summary block under its hatch (`SUMMARY`, paid in full by the next request); side labels add "re-read from cache" and "changed tail paid"; one legend row under the chart.
- `lib/data.js`: `columns` and `requests` are removed (no reader left).

## Decisions

- The per-turn series lives in section 01 (contract v1 "Chart and request examples", lead routing), not in 04. Section 04 keeps the request stacks only.
- Typical and OptChat stacks are one above the other on one shared KB axis, not two columns: two columns at 900 px leave ~1 px per KB and the mark labels collide.
- The OptChat view is drawn as exactly `BUDGET` KB (the seeded view is full: 512 lines × 250 B). If `cache.js` ever starts with a part-full view, `start()` must use the real view size; ask Team 1 for a `view` field on turn records.
- Below 1000 px the 04 name column narrows to 8rem so the 80k and 100k labels keep apart.
- No new animation. Under reduced motion the 01 chart uses its existing static end state; the new blocks follow it.

## Open

- The typical per-turn bars are noisy (1–4 tool steps per turn); the sawtooth between compactions is visible but not smooth. A per-request series would read cleaner but leaves `perTurn()`, which the contract names.
- Typical paid-in-full is 1–4 px tall per turn at this scale. That is the honest result; do not rescale one side.
