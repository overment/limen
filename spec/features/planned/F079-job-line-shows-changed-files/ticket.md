# F079 · The job line says how many files a job has changed

## Outcome

`limen jobs` shows, for a running job, how many files it has changed, so a
worker that is still reading is visible without opening its worktree. At Alice
the median worker made 55 tool calls and 38 reads before its first edit and
opened 28 distinct files on the way; the worker reading budget that landed on
2026-09-03 asked for ten reads and the median moved from 30 to 38 after it. The
owner sent three steers whose whole content was that the worktree was still
empty, one of them after 57 minutes.

## Scope

- Start in `src/wrapper.ts`, which already records `commits` at finish: sample
  the worktree's changed-file count on the same cadence the activity file uses.
- `src/view.ts` prints that count on the running-job line beside `tools`.
- A count the harness could not read is absent, not zero.

## Out of scope

- Steering, stopping, or failing a job on the count; it informs, nothing gates.
- Counting lines, hunks, or which files changed.
- The worker and coordinator prompts, whose sentences about the stall already
  exist (F061, F062).

## Acceptance

- A running job with an edited file prints a non-zero changed-file count on its
  `limen jobs` line; one with a clean worktree prints zero.
- A job whose worktree is gone prints no count and no error.
- The jobs-command and view suites pass.

## Notes

This is the one finding where the sentence already landed and the behaviour got
worse, so the fix is a signal rather than another rule.
