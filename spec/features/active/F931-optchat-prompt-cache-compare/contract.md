# F931 prompt-cache contract

Version: v1. Team 1 (cache truth) owns every revision. Each revision raises the version and adds one line under "Changes". Teams 2 and 3 follow the newest version and re-read this file before they finish. A team that needs a change asks Team 1; it does not fork the words.

Product: `~/overment/lab/optchat-explainer/` (not a Git repository). Spec text: its `HANDOFF.md` Part 2 (cite section numbers). The comparison words, marks and number labels from the earlier comparison work stay in force: `spec/features/active/F930-optchat-vs-typical-context/contract.md` (v1.1).

## The one idea

Both strategies use the prompt cache. A typical thread reads its growing prefix on each request; compaction replaces it with one summary, so the next request pays that summary in full. OptChat sends a bounded view at each turn; its fixed tools and system prompt stay cached, while the changed view tail and new message are paid in full. Inside either turn, each step reads its previous request. Neither side is free, and the page must follow the series.

## Model and observed output (`lib/cache.js`)

- `simulate({ seed: 11, turns: 240, history: 20000 })` reuses the same seeded stream for both sides. `LIMIT = 400 KB`, `NEAR = 92%`, `SUMMARY = 16 KB`, `FIXED = 12 KB`, and each view line = 250 B are drawing assumptions, not measured data (spec §§1, 5.4, 7).
- Main-agent requests follow the user message and each tool result. Output sent back on the next request counts in the added part. Typical compaction runs **before the next input request** when its context would exceed the simulated trigger, never before an output that has not been generated. It reads the old prefix and rewrites it as the simulated summary. The next request reads tools + system and pays the summary and new part (§§7–8).
- OptChat renders the view before logging a new user message (§7). It folds the 20,000-message simulated log with `fold.js` (§5.2), then appends the same messages as the typical thread. On a new turn it reads fixed tools + system and the longest unchanged marked piece of its view; any unmatched tail and new message are paid in full. A later request in the turn reads its previous request (§8). The model assumes cache entries survive across turns.
- `perTurn()` totals **main-agent input only** on both sides. Typical compaction requests remain in `simulate().typical` and their input is separately exposed as `compactCached` and `compactPaid` in `perTurn().typical`; `compact` counts them. OptChat's compactor input is not sized: the spec describes a different cheap model, view-without-IDs prefix, free nodes, and retries, none measured by this stream (§§3, 4.2–4.3, 10). Never stack typical compaction KB against an OptChat series that omits its compactor. Say the spec's OptChat compactor takes *about two cheap-model calls per message* with a largely cached view; typical compaction is a separate large call. Call counts are not equivalent prices.
- Default probe (`node .../probe.mjs`, seed 11, 240 turns, 20,000-message history), **simulated main-agent inputs only**: typical reads 167,592 KB from cache, pays 5,585 KB in full (15 separate compactions); OptChat reads 100,398 KB from cache, pays 28,221 KB in full. Typical's separate compaction inputs read 5,582 KB and pay 7 KB. At OptChat turn starts, simulated view marks read 0 KB for 93 turns, 50 KB for 141, and 80 KB for 6. No knob was changed to reverse the result. These are not bills, token prices, or a measured winner.

## Seven truth decisions

1. **Fair requests (§§7–8):** the two main-agent series share stream, fixed-prefix assumption, and input accounting. The typical compaction call happens before a request, not before an unsent model output. Show compactor work separately; it cannot be silently charged to only one side.
2. **No view mark (§§7.2, 8):** OptChat still reads the simulated 12 KB fixed tools + system prompt, *provided the cache entry survives and the bytes stay identical*. A zero view hit is not a zero request hit. Three view marks plus the request-end mark use the four breakpoint slots.
3. **History (§§5.4, 8):** draw the assumed 20,000-message log, 4–10 simulated messages per turn from `stream()`. The spec measured **73k shared view characters at 20,000 messages** and **57k–81k view characters read per turn** on replayed real sessions. This seed reads 0/50/80 KB of the view at turn starts, not those measured values: message frequency, line sizes, mark rounding and sessions differ. Put measured figures in a separate cited annotation, never on the simulated axis as measured data. Bytes ≠ characters except in this assumed ASCII drawing.
4. **Expiry (§8):** model pauses longer than five minutes on neither side. Both modeled entries persist; the spec reports ~6% of OptChat turns after such pauses. State this omission, not a promise that prefixes always hit after a pause. Do not apply Anthropic's 5-minute expiry to one side only; OpenAI's entry life differs.
5. **Compactors (§§3, 4, 8, 10):** typical compaction calls are separate recorded requests with cached/full input and simulated size. OptChat needs about two cheap-model calls per message *amortized*, each using a mostly cached view; free nodes, variable content, retries and a different model prevent a fair KB or price total here. Show both as work outside the main-agent chart, or size both under explicit new assumptions.
6. **Units (§§1, 8):** chart KB of input read from cache versus KB of input paid in full. Never claim price savings from these two quantities. If mentioning the 5-minute cache-write price, label Anthropic's **1.25× input** as the spec vendor note, not a plotted price.
7. **Result (§§5.2, 8, 10):** the simulated typical thread reads more cached input and pays less full input per drawn stream; OptChat pays a changing view tail on new turns and background compactor work. That result follows this stream and is not a universal ranking.

## Plain words

| side | what stays cached | what breaks the cache | what is paid in full |
|---|---|---|---|
| Typical | Each request reads the growing thread it already sent from cache. | Compaction replaces that thread with a short summary; a long pause may also expire an entry. | Each new message or tool step, and the new summary after compaction; the growing prefix is still read on every request. |
| OptChat | Fixed tools and instructions, much of the view, and the previous step within a turn stay cached. | A changed view tail crosses a view mark, or an entry expires during a pause. | The changed view tail and new message each turn, each step's new part, and extra cheap-model compactor calls that this KB chart does not size. |

## Chart and request examples

- Section 01: per-turn **simulated main-agent input KB** from `perTurn(run)`: grey read from cache and black paid in full, same scales for typical and OptChat. A mark at `typical.compact > 0` names a *separate simulated compaction call*; do not stack its KB into main-agent bars. State that both sides use extra compactor work not priced in this chart and give the spec's OptChat ~2 cheap-model calls per message.
- Section 04: `examples(run)` returns actual records on a shared KB scale. Typical order: request just before compaction, compaction call, first request after it, next request. OptChat order: turn's first request, one in-turn step, next turn's first request. Grey means read from cache; black means paid in full. Do not call the compaction call a normal turn request. The first OptChat request of each turn may read **only** fixed tools + system when no view mark matches.

## Marks (design law)

- Read from cache: `--line` fill (light grey). Paid in full: `--text` (black). Section 04 already uses this legend.
- Hatch stays "summarized away" only: the typical compaction drop. The paid-in-full request after it is black, not hatched.
- Orange (`--pending`) stays "not summarized yet" only. It never means a cache miss.
- Cache breakpoints: thin ticks labeled `50k · 80k · 100k chars`.
- White and black otherwise. One corner radius: `--radius: 6px`. Calm motion; reduced motion shows the final state.

## Numbers and their labels

| number | source | label rule |
|---|---|---|
| main-agent request sizes and per-turn KB, separate typical compaction KB and count | seeded `cache.js` | "simulated" on every chart, row, example and hover label; mark which totals exclude both compactors |
| 12 KB tools + system prompt | drawing assumption | "simulated tools + system prompt: 12 KB"; subject to cache lifetime |
| 250 B per view line, 512 lines | drawing assumption after §5.4 (~500 lines of ~250 B) | "simulated 250 B lines" and "simulated 512-line capacity" when shown |
| 20,000-message log; 4–10 messages per turn | drawing assumptions | "simulated log: 20,000 messages"; "simulated 4–10 messages per turn" when shown |
| 0/50/80 KB view hits and all view KB per request | seeded simulation; ASCII approximation of §8 character marks | "simulated view KB read from cache"; never equate to spec replay measurements |
| 128 KB view budget | spec `VIEW` (§1) | "128 KB budget", not a measured request size |
| 50k / 80k / 100k chars | spec `MARKS` (§1, §8) | "cache marks (spec §8)", characters not bytes |
| 73k shared chars at 20k messages; 57k–81k chars read per turn | measured replay sessions (§§5.4, 8) | "measured in the spec"; keep separate from simulated KB |
| 5-minute entries, ~6% long pauses, 1.25× write | spec Anthropic vendor notes (§8) | cite §8; not a simulated event or plotted price |
| 400 KB window, 92%, 16 KB summary | F930 labels in `SIM_LABELS` | unchanged |

UI label export: `CACHE_LABELS` in `lib/cache.js`.

## Interface: `lib/cache.js`

- `simulate({ seed, turns, history })` returns `{ typical, optchat }`, two arrays of `{ side, turn, kind: 'turn' | 'step' | 'compact', size, cached, paid }` in KB.
- `perTurn(run)` returns `[{ turn, typical: { cached, paid, compact, compactCached, compactPaid }, optchat: { cached, paid } }]`. `cached` and `paid` exclude the separate typical compact call.
- `shared(a, b)` returns how many leading view parts two views share (the memory simulator may use it).
- `examples(run)` returns `{ typical: [before, compact, after, next], optchat: [first, step, nextTurn] }` when available; each entry is a `simulate()` record.
- Constants: `FIXED`, `LINE`, `BUDGET`, `MARKS`, `CACHE_LABELS`.
- These names stay stable. Team 1 may add fields and exports; it tells Teams 2 and 3 in "Changes".

## Where the cache shows (lead plan; Teams 2 and 3 refine)

1. Section 01: show per-turn **main-agent** input from both sides. Typical compaction gets a mark, and its request KB can be shown separately; the first normal request after compaction has a black summary segment. OptChat has a changing black band; neither series establishes a general cost winner.
2. Section 04: two request stacks on one scale, selected by `examples(run)`, with the cache marks. Label the typical compaction stack a separate call. Explain that OptChat's cheap-model compactor is real but not sized in these main-agent KB.
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
- v1: separated compaction input from main-agent totals; moved typical compaction to a request boundary, fixed labels and truth answers, and added `examples(run)` plus separate `compactCached`/`compactPaid` fields.
