# F717 · land merges a ready job onto the target branch

## Outcome

After a job is done and the owner has accepted it (review PASS, or Adam's no-review rule on this plant), `limen land <id>` merges that candidate onto a named target branch with an explicit confirm. Operators do not have to remember the git incantation. If the merge surface is larger than one ordinary Git merge, the command exists as a stub that refuses and prints the approach, and this slice stops.

## Scope

- A new `limen land` command, starting at the CLI dispatch in `src/main.ts`.
- Merge the job's branch onto a named target (default current branch) using ordinary Git.
- Owner confirm suitable for plant use: TTY prompt, or `--yes` when already authorized.
- Refuse dirty target, missing job, non-terminal job, or a job with no commits.
- Focused tests for refuse-and-confirm paths. If blast radius grows past one merge, land the approach plus a refusing stub and stop.

## Out of scope

- A second merge control plane, review gates, or Linear/GitHub.
- Rebase policy, stacked lands, or rewriting job state.
- Finish receipts, jobs filters, or hosted PATH.
- Independent review automation.

## Acceptance

- `limen land <id>` on a done job with commits asks for confirm, then fast-forwards or merges onto the named target with ordinary Git.
- `--yes` skips the prompt for plant use.
- Missing id, running job, empty commits, or dirty target exits non-zero and does not merge.
- No new workflow files or job state.
- If the implementation would invent rebase/review machinery, the shipped command refuses with the written approach instead.

## Notes

This plant merges without an independent review lane. Confirm is the owner check, not a hidden gate. Prefer `git merge` over a custom merger.
