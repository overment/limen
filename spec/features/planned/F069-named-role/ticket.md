# F069 · A job kind is a named role

## Outcome

A new job kind is a name and a prompt file. Spawn that name and it loads its preamble and opens a Herdr space named after the project plus that name with an `s`, the same way workers and reviewers already do. Today only those two values exist, so research, quality, and picture cannot ship without another code change. This is the seam those three kinds need.

## Scope

- Open the role union at spawn (`src/commands/spawn.ts`) and the space namer (`src/herdr.ts`). A role is a name: it selects `templates/<role>.md` or the project overlay at `.agents/limen/<role>.md`, and the space `<project> <role>s`.
- `--review` stays the review spawn: detached checkout, candidate file, reviewer preamble. Add `--role <name>` for every other kind. Default remains worker. `--role` and `--review` together are an error. A missing preamble is a spawn error, not a silent fallback to worker.
- Persist `role` on every job, not only hosted, so continue can inherit it. Continue without `--review` loads the parent's preamble. Hosted sidebar description follows the same name (`limen <role>`).
- `--model` wins; otherwise reviewer still uses `LIMEN_REVIEWER_MODEL` and every other role uses `LIMEN_WORKER_MODEL`. No per-kind environment registry.
- `src/` is at 3308 lines against a 3348 cap. Stay under it, or raise the cap in the same change with a one-line audit of what the new lines buy.
- Shop manual: one short rule that `--role <name>` loads that preamble and space. Callers still pass `--detached` when a later ritual says so — the role name does not pick the spawn mode.

## Out of scope

- The researcher, judge, quality, and picture prompt files, and their shop-manual rituals.
- Changing how `--review` isolates a candidate, or inventing a registry of allowed roles.
- A plural table for space names. A later kind whose name reads badly with a trailing `s` picks a better identifier.

## Acceptance

- `limen spawn --role <name>` with a preamble at `templates/<name>.md` or the project overlay writes `role` as that name, loads that preamble, and opens `<project> <name>s`. A second spawn reuses the space.
- `--review` still requires `--branch`, still writes `candidate`, still loads the reviewer preamble, still opens `<project> reviewers`.
- Spawn with `--role` naming a preamble that does not exist, or combined with `--review`, exits nonzero and plants no job.
- `limen continue` on a `--role` job without `--review` loads the same preamble.
- Worker and reviewer spawns with no `--role` are unchanged.
- `src/` stays at or below the structure-test cap, or the cap moves in this change with the audit.

## Notes

The space suffix is mechanically `s`. Do not special-case `quality` or any other name here.
