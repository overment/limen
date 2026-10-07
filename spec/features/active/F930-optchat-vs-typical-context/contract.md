# F930 comparison contract

Version: v0 (lead seed). Team 1 (comparison truth) owns every revision. Each revision raises the version and adds one line under "Changes". Teams 2 and 3 follow the newest version. A team that needs a change asks Team 1; it does not fork the words.

Product: `~/overment/lab/optchat-explainer/`. Spec text: `HANDOFF.md` Part 2 (cite section numbers).

## The one idea

Typical compaction loses reach. OptChat blurs, but keeps a zoom path to every message.

## Fair setup (the same on both sides)

- The same message stream: seeded `stream()` in `lib/compare.js`.
- The same model window: 400 KB (≈ 200k tokens). This is an assumption of the drawing, not an OptChat constant.
- The same question at the start of each turn: what can the agent still reach, and how?

## Typical thread: four beats, these words

| beat | words on the page | mark |
|---|---|---|
| fill | in the context, word for word | solid grey parts in the window |
| compact | compacts when the window is full | the parts fold into one summary |
| summarized away | one summary replaces the old messages | hatch |
| search, rarely | the lost detail is only in the history; a search can find it, and agents rarely search | dashed arc |

## OptChat: four beats, these words

| beat | words on the page | mark |
|---|---|---|
| log | every message stays in the log, word for word | the log row, solid |
| tree | summaries of summaries, one line each | (section 03 shows it) |
| view | one fixed view over the whole log, the same size on every turn | view lines on the window track |
| zoom | zoom opens a line down to the message, 3–5 calls | solid path, view line to one message |

## Marks (design law)

- Solid grey or black: content the agent has now. Typical: words in the window. OptChat: view lines.
- Hatch: "summarized away". Typical side only. Never elsewhere.
- Orange (`--pending`): "not summarized yet", and the wait for it. OptChat side only. Never decorative.
- Dashed path: rare or return path ("search, rarely"). Solid path: the normal path ("zoom").
- One corner radius: `--radius: 6px`. White and black otherwise.

## Fairness: OptChat costs that section 01 must show

- No message is in full in the view, not even the last reply. Exact text needs a zoom (§5).
- Each turn waits a few seconds for the compactor.
- About two cheap compactor calls per message.
- A summary can still drop an item. Then the agent has no clue to zoom toward.

## Numbers and their labels

| number | source | label rule |
|---|---|---|
| message sizes | seeded random, `compare.js` | "simulated" |
| 400 KB window | drawing assumption | "assumed window" |
| compact at 92% | drawing assumption | "simulated trigger" |
| 16 KB summary | drawing assumption | "simulated" |
| 30 KB tool result cap | spec `CAP` (§1) | spec value |
| 128 KB view | spec `VIEW` (§1) | spec value |
| 512 B per line | spec `NODE` (§1) | spec value, a target maximum |
| 32 drawn view lines | drawing | "drawn as 32; the real view holds ~500 lines of ~250 B (§5)" |
| 3–5 zooms | spec | spec value |

## Ownership (one writer per file part)

- Team 1: this file, `lib/compare.js`, the `versus` array in `lib/data.js`.
- Team 2: `lib/Compare.svelte`, `lib/Versus.svelte`, and the section 01 lines in `optchat.svx` (the `<Head n="01" …/>` line and the figure tags under it).
- Team 3: `lib/Hero.svelte`, `lib/Loop.svelte`, `lib/Detail.svelte`, `lib/Memory.svelte`, `lib/memory.svelte.js`, `lib/Stats.svelte`, `lib/Request.svelte`, `lib/theme.css`, the rest of `lib/data.js`, the rest of `optchat.svx`.
- A team that needs a change in a file it does not own sends the exact request to the owner.

## Changes

- v0: lead seed.
