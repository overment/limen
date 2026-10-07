# F930 comparison contract

Version: v1. Team 1 (comparison truth) owns every revision. Each revision raises the version and adds one line under "Changes". Teams 2 and 3 follow the newest version. A team that needs a change asks Team 1; it does not fork the words.

Product: `~/overment/lab/optchat-explainer/`. Spec text: `HANDOFF.md` Part 2 (cite section numbers).

## The one idea

Compare reach, not a promise of perfect recall. Typical compaction removes old detail from the active context. OptChat keeps the log and a zoom path to every message, but a summary can omit the clue needed to find it (§4.4, §5.1, §7.1).

## Fair setup (the same on both sides)

- Use the same seeded `stream()` from `lib/compare.js`, an assumed 400 KB model window (roughly 200k tokens only as an illustration), and the same question: "What can the agent still reach at the start of a turn, and how?" The window and stream are simulated, not spec constants.
- Typical reach: current word-for-word messages and an old summary are in context; detail the summary dropped requires a separate search of retained history, which agents rarely do (the typical strategy shown, not every agent).
- OptChat reach: a fixed-budget view covers the whole log with summary lines; `zoom` follows a solid path to any original message, provided the summary points to the relevant line (§5.1, §7.1).

## Typical thread: four beats, these words

| beat | words on the page | mark |
|---|---|---|
| fill | fill the context word for word | solid grey parts in the window |
| compact | compact when full (the animation triggers at an assumed 92%) | old parts fold into one summary |
| summarized away | one hatched summary replaces old detail in context | hatch on summary, not deleted history |
| search, rarely | lost detail needs a search of retained history; agents rarely do it | dashed path to the past |

## OptChat: four beats, these words

| beat | words on the page | mark |
|---|---|---|
| log | every message stays in the log, word for word (§2) | the log row, solid |
| tree | adjacent lines merge into summaries of summaries (§3) | section 03 shows it |
| view | one fixed-budget view over the whole log, bounded by 128 KB, not exactly 128 KB each turn (§5.1–5.2) | view lines on the same assumed window track |
| zoom | solid zoom path opens a line down to any message; 3–5 calls is typical, not a bound (§7.1) | view line to one message |

## Marks (design law)

- Solid grey or black: content the agent has now. Typical: words in the window. OptChat: view lines.
- Hatch: "summarized away". Typical side only. Never elsewhere.
- Orange (`--pending`): "not summarized yet", and the wait for it. OptChat side only. Never decorative.
- Dashed path: rare or return path ("search, rarely"). Solid path: the normal path ("zoom").
- One corner radius: `--radius: 6px`. White and black otherwise.

## Fairness: OptChat costs that section 01 must show

- The view has summary/tree lines, not a transcript of full messages. A short message may remain verbatim as a free node; for exact text not already visible, zoom to its message (§3, §5.1, §7.1).
- Each turn waits a few seconds for the compactor to settle (§6); about two compactor calls per message amortized (§10).
- A summary can drop an item. Its source remains in the log, but the agent may have no clue where to zoom (§4.4).

## Numbers and their labels

| number | source | label rule |
|---|---|---|
| message sizes, counts, compaction counts and chart values | seeded `compare.js` animation | "simulated" on chart, live counters and hover labels |
| 400 KB window, ≈ 200k tokens | drawing assumption, not a spec constant | "assumed window"; token approximation stays qualified |
| compact at 92% | drawing assumption | "simulated trigger: 92%" (or no unqualified percentage shown) |
| 16 KB compacted summary | drawing assumption | "simulated summary: 16 KB" in every label showing it |
| 30 KB tool-result size in stream | simulated approximation of spec `CAP = 30,000 chars` (§1, §7) | "simulated tool results up to 30 KB"; never label it the spec cap |
| 128 KB view budget | spec `VIEW = 128,000 bytes` (§1, §5.4) | "128 KB budget"; chart's 32-line fill is simulated, not constant-size measured data |
| 512 B summary target | spec `NODE = 512 bytes` (§1, §4.3) | "512 B target"; retries can exceed it |
| 32 drawn view lines | drawing | "drawn as 32; real view holds ~500 lines of ~250 B (§3, §5.4)" |
| 3–5 zoom calls | typical observed reach (§7.1) | "typically 3–5 zooms", never a guarantee |

UI label export from `lib/compare.js`: `SIM_LABELS` with `window`, `trigger`, `summary`, `stream`, `tool`, `view` strings. Use labels wherever these animated numbers appear; spec values have their separate rules above.

## Ownership (one writer per file part)

- Team 1: this file, `lib/compare.js`, the `versus` array in `lib/data.js`.
- Team 2: `lib/Compare.svelte`, `lib/Versus.svelte`, and the section 01 lines in `optchat.svx` (the `<Head n="01" …/>` line and the figure tags under it).
- Team 3: `lib/Hero.svelte`, `lib/Loop.svelte`, `lib/Detail.svelte`, `lib/Memory.svelte`, `lib/memory.svelte.js`, `lib/Stats.svelte`, `lib/Request.svelte`, `lib/theme.css`, the rest of `lib/data.js`, the rest of `optchat.svx`.
- A team that needs a change in a file it does not own sends the exact request to the owner.

## Changes

- v0: lead seed.
- v1: corrected the byte/character cap, view budget, zoom limits, simulated labels, typical scope and OptChat costs against §§1–7, 10.
- v1.1 (lead, at integration): `versus` now has 8 rows. Context size, context rot and prompt cache rows were added; turn cost and cache were merged into one "Cost?" row with costs on both sides. The stats label became "zooms to a message, typically".
