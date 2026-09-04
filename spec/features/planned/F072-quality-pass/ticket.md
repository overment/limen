# F072 · Quality pass over landed work

## Outcome

Over a stretch of landed work, a quality session reads the vision and the styleguide and writes one findings file: what is badly organized, what is dead, and where two files claim the same decision. Findings become tickets or one small slice. The pass never rewrites the tree and never gates a merge.

## Scope

- One package prompt file: `templates/quality.md`. Spawn `--role quality --detached`.
- Schedule: the coordinator starts it unprompted after ten proven landings since the last quality findings file — the same window the board keeps in PROVEN — or when the human asks. Not after every merge, not on a calendar, never as a condition of landing work. It interleaves with seat work; it is not sequenced behind it.
- One findings file per pass at `spec/quality/YYYY-MM.md`. If a month already has a file, the next pass in that month is `YYYY-MM-2.md`. The file lists each finding as a proposed ticket line or a drop candidate. The coordinator turns those into planned tickets or one small slice; the quality job does not.
- Bar: subtraction and unification. A rewrite is out of scope. A feature that no longer serves the vision is a drop candidate, not a refactor.
- Ship a history hash and extend the structure-test template list.

## Out of scope

- Rewriting code in the quality job, editing the board, merging.
- A merge gate, a CI check, or a required reviewer step.
- Replacing the styleguide or the vision.

## Acceptance

- The shop manual states the schedule (ten proven landings or the human asks), the detached `--role quality` spawn, the findings path, and that the pass does not rewrite.
- `templates/quality.md` exists with a history hash; spawn `--role quality` loads it.
- The prompt judges against the vision and the styleguide, forbids rewriting, and tells the session to write `spec/quality/YYYY-MM.md`.
- The prompt names drop-candidate versus ticket versus slice as the only outputs.

## Notes

Ten is the board's own PROVEN window so the schedule does not invent a new counter. The human can ask earlier. The space will be named `<project> qualitys` until someone picks a better identifier; do not add a plural table.
