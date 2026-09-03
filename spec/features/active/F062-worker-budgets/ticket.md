# F062 · Workers stay off the board and inside reading and check budgets

## Outcome

A worker never edits the board, ticket status, or outcome files; makes its first edit after reading only the ticket, the findings file, and the file the handoff names; runs the check that discriminates before any full lane and the full lane once; and ends with its handoff followed by the finish tool. At Alice 44 of 50 board edits were unasked and caused merge conflicts, the median worker made 25 tool calls before its first edit, repo-wide `cargo fmt --check` hit the output cap 47 times, and 28 workers symlinked the coordinator's dependencies into their worktree.

## Scope

- `templates/worker.md`: replace "reconcile `spec/build.md` only as far as this slice earns" with a flat rule against editing the board, ticket status, or outcome files; progress lives in the commit and the final message.
- Reading budget: before the first edit, the ticket, the findings file if any, and the named file; ten reads without a changed file means make the probe edit; a repair starts by reproducing the finding with the named test.
- Check budget: the discriminating check first, scoped to the diff; the full native lane once before the final commit and again only if that commit changed; no repo-wide formatter over untouched files; no two lanes in parallel in one worktree; install from the lockfile, never a symlink to another checkout.
- Question trigger: if the slice would touch more than the seam the handoff names, commit what is useful, write the question to a plain file, and finish.
- Hosted ending: the final summary is the last message, then `finish` (F055); the sentence about quitting Pi is gone.

## Out of scope

- The coordinator's handoff rules (F061).
- Reviewer behaviour (F063).
- Any measurement of tool calls by the harness.

## Acceptance

- The worker template contains the board rule, the reading budget, the check budget, and the question trigger, asserted by phrase in the structure test.
- The template no longer contains "quit pi" or "as far as this slice earns".
- The structure test passes.

## Notes

The two longest handoffs at Alice produced the two overbuilt candidates; the question trigger gives a worker a way out that no worker used in 351 jobs.
