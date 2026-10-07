# F931 prompt-cache contract

Version: v0 (lead seed). Team 1 (cache truth) owns every revision. Each revision raises the version and adds one line under "Changes". Teams 2 and 3 follow the newest version and re-read this file before they finish. A team that needs a change asks Team 1; it does not fork the words.

Product: `~/overment/lab/optchat-explainer/` (not a Git repository). Spec text: its `HANDOFF.md` Part 2 (cite section numbers). The comparison words, marks and number labels from the earlier comparison work stay in force: `spec/features/active/F930-optchat-vs-typical-context/contract.md` (v1.1).

## The one idea

Both strategies lean on the prompt cache, in different ways. A typical thread reads its whole growing context from the cache on every request; compaction replaces that prefix with one summary, and the next request pays the summary in full. OptChat sends a bounded request each turn: tools and system prompt never change, the start of the view rarely changes, and the changed tail of the view, the new message and each step's new part are paid in full. Neither side is free. The page shows what each side reads and what each side pays; it does not claim a winner the series do not show.

## The model (seed, `lib/cache.js`)

- One request per model call. The typical thread and OptChat both send a request after the user message and after each tool result (§7, §8). Input only: model output is not drawn.
- Typical: a request reads the whole request before it from the cache and pays the new part. Before a message that would pass the simulated 92% trigger, one compaction call reads the context and the context becomes one simulated 16 KB summary. The next request reads only tools + system prompt and pays the summary and the new part in full.
- OptChat: a turn's first request is `[tools][system][view][message]` (§7, §8). It reads tools + system prompt and the longest marked piece of the view (50k, 80k, 100k chars; §1, §8) that is identical to the previous turn's view. The rest of the view and the message are paid in full. Each step inside the turn reads the request before it (§8).
- The view is the real fold of `lib/fold.js` (§5.2) with every line drawn as 250 B, so the 128 KB budget holds 512 lines. OptChat starts with a simulated 20,000-message log already folded; the typical thread starts just after a compaction.
- Both sides use the same seeded `stream()` from `lib/compare.js` and the same assumed 400 KB window.

## Seed result (lead probe: `node probe.mjs` in the job folder; seed 11, 240 turns)

| | read from cache | paid in full |
|---|---|---|
| typical | 173,201 KB | 5,592 KB (15 compactions) |
| OptChat, 20,000-message log | 100,398 KB | 28,221 KB |
| OptChat, 400,000-message log | 109,058 KB | 19,561 KB |

OptChat's view piece read at turn start, 20,000-message log: 0 KB in 93 turns, 50 KB in 141, 80 KB in 6. The spec measured 57k–81k chars of view read per turn on real sessions (§8) and 73k chars shared at 20,000 messages (§5.4). The seeded stream has 4–10 messages per turn, more than a chat turn; more messages per turn mean more merges and a shorter shared prefix.

## Truth questions for Team 1 (answer in v1)

1. Is the request model fair to both sides (§7, §8)? Fix `lib/cache.js` where it is not.
2. When no marked view piece matches, does OptChat still read tools + system prompt (§8 says they are always cached; only 4 breakpoints exist: 3 in the view and the request end)?
3. Which log length and which messages-per-turn to draw, and how to place the simulated view read beside the spec's measured 57k–81k chars.
4. A user pause over 5 minutes (≈6% of turns, §8): show it on both sides or on neither.
5. OptChat's compactor (≈2 cheap-model calls per message, each reading the view from cache, §10) against the typical compaction call: how to show both background costs fairly.
6. Units: KB read from cache and KB paid in full. No price ratios, except a labeled one the spec states (5-minute cache write = 1.25× input, §8).
7. Do not tune a knob to change which side pays less. The words on the page follow the series.

## Marks (design law)

- Read from cache: `--line` fill (light grey). Paid in full: `--text` (black). Section 04 already uses this legend.
- Hatch stays "summarized away" only: the typical compaction drop. The paid-in-full request after it is black, not hatched.
- Orange (`--pending`) stays "not summarized yet" only. It never means a cache miss.
- Cache breakpoints: thin ticks labeled `50k · 80k · 100k chars`.
- White and black otherwise. One corner radius: `--radius: 6px`. Calm motion; reduced motion shows the final state.

## Numbers and their labels

| number | source | label rule |
|---|---|---|
| request sizes, cached and paid KB, compaction count | seeded `cache.js` | "simulated" on every chart, row and hover label |
| 12 KB tools + system prompt | drawing assumption | "simulated tools + system prompt: 12 KB" |
| 250 B per view line, 512 lines | drawing assumption after §5.4 (~500 lines of ~250 B) | "simulated 250 B lines" |
| 20,000-message log | drawing assumption at a measured point (§5.4) | "simulated log: 20,000 messages" |
| 128 KB view budget | spec `VIEW` (§1) | "128 KB budget" |
| 50k / 80k / 100k chars | spec `MARKS` (§1, §8) | "cache marks (spec §8)" |
| 57k–81k chars read per turn | spec, measured on replayed sessions (§8) | "measured in the spec", never as a sim value |
| 5-minute entries; 1.25× write | spec vendor notes (§8) | cite §8 |
| 400 KB window, 92%, 16 KB summary | F930 labels in `SIM_LABELS` | unchanged |

UI label export: `CACHE_LABELS` in `lib/cache.js`.

## Interface: `lib/cache.js`

- `simulate({ seed, turns, history })` returns `{ typical, optchat }`, two arrays of `{ side, turn, kind: 'turn' | 'step' | 'compact', size, cached, paid }` in KB.
- `perTurn(run)` returns `[{ turn, typical: { cached, paid, compact }, optchat: { cached, paid } }]`.
- `shared(a, b)` returns how many leading view parts two views share (the memory simulator may use it).
- Constants: `FIXED`, `LINE`, `BUDGET`, `MARKS`, `CACHE_LABELS`.
- These names stay stable. Team 1 may add fields and exports; it tells Teams 2 and 3 in "Changes".

## Where the cache shows (lead plan; Teams 2 and 3 refine)

1. Section 01: the context-size chart shows, per side, what each request reads from cache and what it pays in full. Typical: a black spike after each hatched drop. OptChat: a steady black band.
2. Section 04: two request stacks on one scale: typical (a request before compaction, the compaction call, the first request after, the next) and OptChat (a turn's first request, one step, the next turn's first request), with the cache marks.
3. Section 03 memory simulator: after a turn, the view lines the next turn reads from cache and the changed tail, from the real fold.
4. Section 02 loop and detail: the view and call nodes say what is cached.
5. Hero: only if it stays quiet, the view row shows the cache marks.
6. Versus: one "Prompt cache?" row in plain words that match the series.

## Ownership (one writer per file part)

- Team 1: this file, `lib/cache.js`, `lib/compare.js`, the `versus` array in `lib/data.js`.
- Team 2: `lib/Compare.svelte`, `lib/Versus.svelte`, `lib/Request.svelte`, `columns` and `requests` in `lib/data.js`, the figure tags under sections 01 and 04 in `optchat.svx`.
- Team 3: `lib/Hero.svelte`, `lib/Stats.svelte`, `lib/Loop.svelte`, `lib/Detail.svelte`, `lib/Memory.svelte`, `lib/memory.svelte.js`, `lib/Head.svelte`, `lib/theme.css`, the rest of `lib/data.js`, all prose in `optchat.svx` (header, section heads, rules table, coda), `HANDOFF.md` Part 1.
- `lib/fold.js`: nobody changes it (the hero, the comparison and the cache model share it). Ask the lead.
- Lead: the final export to `optchat.html` and `~/Downloads/optchat-cache-compare.html`.
- Shared files (`optchat.svx`, `lib/data.js`): re-read before each edit and touch only the owned part.

## Changes

- v0: lead seed. Model, seed result, truth questions, marks, labels, interface, ownership.
