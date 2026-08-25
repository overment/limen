# F029-hosted-review · Reviews in Herdr are interactive tabs, like workers

[2026-08-20] [🟢] [PROVEN] [COORDINATOR] PROVEN · F029-hosted-review

## Outcome

`limen spawn --review` in Herdr opens an interactive Pi tab, the same way implementation spawn already does. You can type into the reviewer. `--detached` still means a log-tail reviewer: scripts, no Herdr, or when asked. The git worktree stays a detached checkout — the reviewer still does not own the candidate branch.

Human decision 2026-08-20: reviews should always be interactive when Herdr is there. F010 left `--tab` refusing `--review`; that refusal comes out.

## Scope

- **Default.** `spawnCommand`: hosted when Herdr is available and `--detached` was not passed, including `--review`. Drop `parsed.review ||` from the tab latch. Drop the `--tab does not support --review yet` error. `--tab --review` is allowed; `--tab --detached` still is not; hosted still refuses `--timeout`.
- **Shop manual.** `templates/agents.md`: the spawn table and the two “reviews stay detached / `--tab` does not support `--review`” sentences. Detached’s “when to use” no longer lists reviews as a reason. `--review` examples stay `--review --branch …` with no extra flag in Herdr.
- **Tests.** A Herdr-available `--review --branch` job writes `hosted` and takes the hosted start path. `--review --detached` does not. `--tab --review` no longer throws. Without Herdr, `--review` stays ordinary/detached and `--tab --review` still errors because hosted requires Herdr.

## Out of scope

- Changing review worktree isolation (`kind: "detach"` checkout, `candidate` file, reviewer preamble).
- Restarting the in-flight F027 review.
- Timeouts or process containment on hosted reviews — they keep the hosted weaker-guarantees note.
- F027 idle-advisory.

## Acceptance

- `HERDR_ENV=1`, `limen spawn --review --branch <b> "…"`: job record has `hosted`; stdout says `(hosted)`; no throw.
- Same with `--tab --review --branch <b>`: hosted, no throw.
- `limen spawn --review --detached --branch <b> "…"`: no `hosted` file; watch/log path.
- No Herdr: `--review` is detached; `--tab --review` errors `hosted spawn requires Herdr`.
- `templates/agents.md` does not say reviews stay detached or that `--tab` refuses `--review`.
- Existing `--review` tests without Herdr still pass. `npm run check` green.

## Notes

Seam is three lines in `src/commands/spawn.ts` (`tab` latch + the throw) plus shop-manual prose and `test/spawn-command.test.ts` / `test/hosted-spawn.test.ts`. Reviewer independence is a fresh session, not a detached process.
