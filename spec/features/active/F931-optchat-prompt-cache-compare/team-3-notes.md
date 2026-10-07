# F931 · Team 3 (cohesion) notes

## Seams

- Memory simulator cache marks: `lib/Memory.svelte`, derived `cached` = number of leading view lines whose rendered text (`m.render(p)`) equals the last call's view (`m.calls.at(-1)`). Each row has a `.mk` bar: `--line` grey = read from cache, `--text` black = paid in full. The `.read` readout above the rows says "next call reads N of M view lines from cache" plus "simulated line count". Before the first call, all lines are paid.
- Text comparison, not `shared()` from `lib/cache.js`: a built line's text never changes, and a call never sees a placeholder (§6), so text equality equals part equality here and needs no import of the 20,000-message model.
- `lib/memory.svelte.js` `jump()` now records the view before each user message into `calls` (as `turn()` does, §7). Without it, the demos showed every line as paid.
- Loop detail rows (`stages` in `lib/data.js`): call has `cached` / `paid` / `steps`; view has `cache marks` (spec §8) and `next turn`; compactor `context` says the view is mostly read from cache (§8, §10).
- Prose in `optchat.svx`: 01, 02, 03 and 04 leads, the 04 title, and the contrast line under the coda. Header lead, coda and rules table unchanged.

## Decisions

- 04 title: "Both reuse a cached start. Each pays for what changed." It follows Team 1's suggested "Both reuse a prefix; each pays for what changed." with "prefix" swapped for plain words. Team 1 has not confirmed the swap.
- Hero and stats unchanged. Cache marks on 32 drawn hero lines imply a scale the drawing does not have; no stat added because the 50k · 80k · 100k marks read badly at 46 px in a 4-column row.
- 04 lead says OptChat keeps "often the view up to a cache mark" cached, not the contract's "much of the view": the seed reads no view mark in 93 of 240 turns, and the 04 figure shows a turn with none. The view node's `why` says "often" for the same reason.
- The memory simulator shows low reuse (often 0–5 of 8–16 lines) because a 64-message log still merges near its view start. This is the real fold, not a bug. The caption says so and cites §5.2.

## Open questions

- The 01 "input per turn" note and the 04 figure note both state the two omissions: pauses over 5 minutes are not modeled, and OptChat's compactor is outside the KB. No head lead states them.
- HANDOFF.md Part 1 rows for 01 and 04 match the integrated figures from the final export.
- At 900 px, two small label collisions remain in Team 2 figures: a bar crosses the "1,000 KB" axis label in the typical "input per turn" chart, and the "80k" and "100k chars" ticks in 04 touch. HANDOFF known gap 3 lists them.
- Emulation checks (reduced motion, dark scheme) used a held CDP session: `/tmp/f931-team3-cdp.mjs`. The session must stay attached while `shot` runs, or Chrome drops the emulation.
