---
opened: 2026-10-07
---

# F930 · The OptChat explainer shows plainly how OptChat differs from typical context management

## Outcome

A reader who does not write code opens the OptChat explainer and sees, in one look, two ways to manage an agent's context. The typical way fills the thread word for word, compacts when full, and loses detail that only a rare search can recover. OptChat keeps a permanent log, a summary tree, and a fixed view, and a zoom path reaches any fact. Adam already likes the page; this makes the comparison the clear spine of the whole document.

## Scope

- The product is the lab project `~/overment/lab/optchat-explainer/`, not plant `src/`. Read `HANDOFF.md` there first, in full.
- Start at section 01 Compared: `lib/Compare.svelte`, `lib/compare.js`, `lib/Versus.svelte`, `versus` in `lib/data.js`.
- Tell one fair story: the same message stream, the same window pressure, and what the agent can still reach on each side.
- Carry the same idea through the hero, the loop, the memory simulator, and the coda.
- Close the known gaps in `HANDOFF.md` that fit, such as raw `rgb()` in the hero, theme scope, dimmed loop nodes, a tooltip on the disabled button, and reduced motion.
- Ship `optchat.html` by `svx` export and copy it to `~/Downloads/optchat-vs-typical.html`.

## Out of scope

- A rebuild of the page from zero, or a new visual language.
- Decorative color, new hues, or a second corner radius.
- Measured benchmarks. Simulated values stay simulated and carry a label.

## Acceptance

- Section 01 names the typical strategy in plain words: fill word for word, compact when full, a hatched summary replaces detail, a dashed "search, rarely" path to the lost past.
- Section 01 names OptChat in plain words: a fixed view over the whole log, orange for a line not summarized yet, a zoom path to any fact.
- The context-size chart shows the typical sawtooth against the flat OptChat line, and a cold reader can say which is which without the legend.
- Every simulated number on the page (seeded sizes, 400 KB window, 92% compaction, 16 KB summaries, 32 drawn lines against about 500 real lines) carries a visible "simulated" or "drawn" label.
- The design law holds: white and black only, orange only for "not summarized yet", hatch only for "summarized away", one 6px corner radius.
- `~/Downloads/optchat-vs-typical.html` opens offline, and shots at 1440 and 900 px wide on the hidden screen show no overlap or clipping.

## Notes

- The lab folder is not a Git repository. The delivered file set is `optchat.svx`, `lib/*`, and `optchat.html`.
