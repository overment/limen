# F714 · Spawn refuses a ticket missing from the base commit

## Outcome

When a spawn task names a ticket path, Limen refuses to start unless that file exists in the job's base commit. The operator sees a clear error. No worktree, branch, or job directory is left behind. This closes the footgun where an uncommitted ticket is pointed at and the worker hunts in an empty tree.

## Scope

- Spawn, starting at `src/commands/spawn.ts` before the worktree is created, or with full cleanup if it already exists.
- A `Ticket:` pointer in the task; the path must be present in the job base commit.
- Clear error on stdout/stderr; no running job record.
- Focused spawn tests for missing, untracked, and committed tickets.

## Out of scope

- Hosted PATH or `HERDR_ENV` reliability.
- `limen jobs` filtering.
- Finish receipts or a land command.
- Rewriting how `Ticket:` paths are expanded for workspace coordinators.

## Acceptance

- Spawn with `Ticket: spec/...` whose file is untracked or not in the base commit exits non-zero, prints that the ticket is missing from the base commit, and leaves no worktree, branch, or job directory.
- Spawn with that same path committed on the base succeeds as today.
- Spawn without a `Ticket:` pointer is unchanged.
- A resume on `--branch` checks the ticket against that branch's base commit, not the caller's dirty tree.
- Focused tests cover missing and present tickets; no half worktree remains after the refusal.

## Notes

The shop manual already tells coordinators to commit the feature folder before spawn. This is the fail-closed backup, not a new workflow gate. Prefer checking the tree of the intended base before `executeWorktree`.
