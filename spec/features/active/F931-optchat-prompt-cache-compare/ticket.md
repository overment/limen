---
opened: 2026-10-07
---

# F931 · The OptChat explainer shows what the prompt cache reads and what is paid in full, for a typical thread and for OptChat

## Outcome

A reader of the OptChat explainer sees, on the same page as the existing comparison, which part of each request the prompt cache reads and which part is paid in full. A typical thread keeps a growing cached prefix until compaction replaces the old messages with a summary; the next request then pays the whole new context in full. OptChat keeps the system prompt identical and changes only the end of the view, so most of each request stays cached. Adam asked to mix this into the visuals the page already has, not to add a second page.

## Scope

- The product is the lab project `~/overment/lab/optchat-explainer/`, not plant `src/`. Read its `HANDOFF.md` first: Part 1 for the page, Part 2 §5.2, §5.4, §7, §8 and §10 for the cache rules.
- Start at section 04 (`lib/Request.svelte`, `columns` and `requests` in `lib/data.js`) and the section 01 comparison (`lib/Compare.svelte`, `lib/compare.js`, `lib/Versus.svelte`).
- Tell one fair turn-by-turn cache story for both sides: what stays in the cached prefix, what breaks it, and what is paid in full.
- Reuse the hero fan, the comparison strips, the context-size chart, the loop, the memory simulator and the request layout. Do not add a parallel style.
- Ship by `svx` export to `optchat.html` and copy it to `~/Downloads/optchat-cache-compare.html`.

## Out of scope

- A rebuild of the page, a new visual language, a new hue or a second corner radius.
- Measured prices or token benchmarks. Simulated values stay simulated and carry a label.
- Vendor price tables beyond the ratios the spec states.

## Acceptance

- Section 04, or the section 01 comparison, shows cached against paid-in-full parts for a typical thread and for OptChat, side by side.
- The typical side shows that compaction breaks the cached prefix and that the requests after it pay more in full until the cache builds again.
- The OptChat side shows the identical system prompt, the 50k / 80k / 100k character breakpoints in the view, a changed tail of the view, and the in-turn tool steps that read the step before them.
- Every simulated number about the cache carries a visible "simulated" label; spec values cite their spec section.
- The design law holds: white and black only, orange only for "not summarized yet", hatch only for "summarized away", one 6px corner radius.
- `~/Downloads/optchat-cache-compare.html` opens offline. Shots at 1440 and 900 px wide on the hidden screen show no overlap or clipping, with reduced motion and a dark system scheme.

## Notes

- The lab folder is not a Git repository. The delivered file set is `optchat.svx`, `lib/*` and `optchat.html`.
- The comparison words and number labels from the earlier comparison work are in `spec/features/active/F930-optchat-vs-typical-context/contract.md`. This ticket extends them for the cache.
