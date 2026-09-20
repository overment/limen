# F720 · Running jobs no longer count dirty files

## Outcome

A running job no longer shows how many files are dirty in its worktree. That count was missing for hosted jobs, reset to zero after a checkpoint commit, and counted every dirty file rather than this run's work. Operators still see pulse, tool count, log, and commits.

## Scope

- Start at the wrapper path that records a dirty-file count on every activity event, including `message_update`, by shelling `git status`.
- Remove the job-file, the jobs/view rendering, and the dedicated tests for that count.
- Prefer delete. Do not extend the same signal to hosted jobs.

## Out of scope

- Changing tool-calls, pulse, log, or commit listing.
- GitHub doorbell, unusable-route refusal, or a living architecture picture.
- A replacement “files this run produced” metric.

## Acceptance

- A detached running job does not write a `changed-files` record.
- Compact and detailed `limen jobs` output for a running job has no live dirty-file count from that record.
- The wrapper activity path does not invoke `git status`.
- Focused jobs, view, git-status, and wrapper tests that remain pass.

## Notes

Quality findings named this a drop-candidate: hosted-absent, checkpoint-reset, hot-path `git status` on every parsed activity event. Tool count, pulse, log, commits, and an inspected worktree already provide the evidence.
