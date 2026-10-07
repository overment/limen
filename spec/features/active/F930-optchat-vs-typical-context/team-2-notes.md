# Team 2 notes · section 01 "Compared"

Follows contract v1. Files: `lib/Compare.svelte`, `lib/Versus.svelte`, the `<Head n="01" …/>` line in `optchat.svx`.

## Decisions

- Reach is symmetric under each log row. Typical: dashed arc "search, rarely" from now back to the hatched past. OptChat: a solid path from one view line, down its fan, into a magnified ladder (the "lens") under the log. Each ladder row is one `zoom(id, n)` call and shows the two children it returns; the chosen child is black, its sibling is an outline. The last row ends on one message with an arrow.
- Zoom line choice: the oldest built view line that 3–5 zooms open (2^3–2^5 messages), sticky until it merges. Target message = `first + floor(n / 3)`, so the path alternates left and right. Shown once the first compaction exists, the same moment the search arc appears.
- Orange: the newest OptChat line, its fan and its log span, until it is summarized (`BUILD` = 750 ms after the last message; any new message also builds the one before). The caption then says "newest line not summarized yet · the next call waits". The fold uses this `builtTo`, so unbuilt pairs never merge.
- Hatch: the typical summary slot, the summarized-away log span, the legend swatch, and one band on each chart drop (peak to summary), named "compaction: detail summarized away" above the latest drop.
- Chart: no legend. Line labels sit in a right column (`.plot` grid, 7.5rem), each at the height its line ends, pushed apart when they would overlap. All three plots share the column, so the log axes still line up. Labels inside the sawtooth always collided (9 compactions in the end state), so the column is needed.
- All text over SVG is HTML placed in %, so it keeps 11–12 px at every width. The ladder pitch grows with narrow widths (`zs()`: at least 19 px a row).
- Reduced motion: `instant()` runs to 1,000 messages, then on until the thread is ≥ 75% full again, and draws once. The newest OptChat line stays orange in that frozen frame. A `$effect` reruns the static layout when the plot width changes.
- Versus: typical column dim (`--text-dim`, 14 px), OptChat strong (`--text`, 500, 15 px). The head says "typical thread · the strategy shown". Rows render from `versus` as they are.

## Copy (user-visible, section 01)

- Title: "A compacted thread loses reach. OptChat blurs, and keeps a zoom path." (the lead's line)
- Reach rows ("can still reach"): typical "Recent messages word for word, and one summary. Detail the summary dropped needs a search of the retained history, and agents rarely search." · OptChat "One fixed-budget view over the whole log. From any line, a solid zoom path leads down to the original messages, if the line names what the agent needs."
- Labels use `SIM_LABELS` from `lib/compare.js`: window, trigger, summary, stream, tool, view.

## Checks run

- `svx … --out /tmp/f930-team2.html`: exit 0.
- Shots read: `/tmp/f930-team2-1440final-{0,1}.png`, `/tmp/f930-team2-900final-{0,1}.png` (static), `/tmp/f930-team2-1440-anim-2.png` (animated).
- Radius audit: `6px` (chip, panel, btn) + `50%` (dot) only.
- Color audit in `.oc-compare` and `.oc-versus`: the only hue is `--pending`, on pending fan/slot/log span, the wait caption, its dot, and the legend swatch. `url(#oc-hatch)` only on summarized-away marks.

## Open questions

- None for Team 1. The contract's OptChat "log" beat is carried by the lead sentence and the "log" row label, not by a legend item.
