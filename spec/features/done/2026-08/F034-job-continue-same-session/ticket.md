# F034-job-continue-same-session · Resume a finished worker in its own session instead of starting over

[2026-08-20] [🟢] [PROVEN] [COORDINATOR] PROVEN · F034-job-continue-same-session

## Outcome

`limen continue <id|label> "follow-up instruction"` restarts a **finished** worker inside its own prior pi session — full conversation context, same worktree, same branch — instead of paying a cold context for a repair or follow-up slice. A new job record is created and linked to the parent, so history stays inspectable and wakes route normally.

## Evidence

pi already supports this natively: `--continue` / `-c` resumes the most recent session in `--session-dir` (`packages/coding-agent/src/cli/args.ts`; `SessionManager.continueRecent(cwd, sessionDir)` in `core/session-manager.ts`), and `pi --continue "message"` accepts an initial message. Limen already persists every job's session at `.limen/jobs/<id>/session` and its worktree path in the job record — no new state is needed, only a command that assembles the three.

## Scope

- New `continue` command: requires a terminal job (`done`/`failed`/`stopped`); refuses running jobs. Reads `worktree`, `branch`, `session` from the parent record; launches `pi --continue --session-dir <job>/session` in that worktree with the usual limen environment, extensions, and preamble — **without** re-sending `@task.md`.
- Writes a fresh job record (new ID, same branch/worktree rules as `spawn --branch`) with a `parent` file naming the origin job; subscribes the requesting session.
- Reviewer continuation is opt-in (`--review`) and the command output names the tradeoff: a continued reviewer is not an independent one. Default review flow stays fresh-spawn per the shop manual.
- Hosted sessions that are still open are explicitly not this command's job — type into the tab or use `herdr agent prompt` today; the stall handoff (F030) covers the wake side.

## Out of scope

- Automatic continuation or chaining.
- Resuming a job whose worktree was pruned (command states that plainly and exits).
- Compaction or transcript editing.

## Acceptance

- Fake-pi test: `continue` on a `done` job launches with `--continue` pointed at the parent's session dir and the parent's worktree as cwd; the new job record carries `parent`.
- `continue` on a running job refuses with the job ID and state.
- `continue` after the worktree is gone refuses with a plain message.
- Wakes for the continued job route to the requesting session like any spawn.
- `npm run check` green.

## Notes

This changes the economics of repair slices: a repair resume keeps the worker's earned context (seam knowledge, what it already tried) while keeping one-commit-per-slice discipline. Independence concern applies only to reviewers; for workers, continuity is a recovery win, not a risk.

Implementation note (2026-08-21): the child does not point `--session-dir` at the parent's dir — pi would append to the parent transcript. Instead the child gets its own session dir seeded with a copy of the parent's newest `.jsonl`, so `--continue` resumes full context while the parent record stays frozen history. Verified by `test/continue-command.test.ts`.
