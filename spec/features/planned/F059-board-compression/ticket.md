# F059 · The board stays short: older proven work collapses into monthly highlights

## Outcome

A fresh coordinator can read the whole board aloud. NOW and NEXT hold one clause per feature, PROVEN keeps only the last ten landed features, and everything older sits in one line per month with three highlights and a pointer to the month's folder, where each feature's outcome file already holds the detail. At Alice the board reached 30 KB, its NOW entries ran to three hundred words of mechanism, and the coordinator invented a 21 KB "do not re-litigate" section by hand; the owner then restarted sessions with a pasted summary because the board could not be read.

## Scope

- `templates/spec/build.md`: TRACK at most three bullets; NOW one clause per feature plus one clause for the current slice, about forty words; NEXT one clause; PROVEN a rolling window of ten, then one line per month: count landed, three highlights in product words, the folder path.
- `templates/agents.md` step 7: when landing or dropping a feature, if PROVEN exceeds the window, fold the oldest entries into their month line in the same change; a month line is rewritten, never appended to.
- The per-turn build advisory in `hook/communication.ts` adds one informational line when the board exceeds about 120 lines.
- The system-prompt digest (F053) reads NOW and NEXT as written, so these rules bound what every model sees.

## Out of scope

- Any parser or validator of board shape; the advisory informs.
- Rewriting existing project boards; the coordinator folds them on the next landing.
- Outcome files, which keep the detail.

## Acceptance

- The board template shows the window and a month line by example.
- The shop manual's step 7 names the fold and the ten-entry window.
- A test board of 130 lines produces the advisory line; one of 80 lines does not.
- Following the template, a month with forty landed features occupies one line.
- The structure and hook suites pass.

## Notes

Detail is not lost: the month's `done/` folder holds a ticket and outcome per feature, and Git holds the rest. The board is a view, not the archive.
