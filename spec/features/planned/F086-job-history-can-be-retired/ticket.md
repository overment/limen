# F086 · Job history can be retired

## Outcome

An operator can retire finished job records, so a project that has run for
months costs a coordinator no more to open than a fresh one. Alice's
`.limen/jobs` holds 477 records and 497 MB — 244 done, 212 stopped, 17 failed,
2 running — and every one is walked at each session start and each sweep.
`limen prune` today removes worktrees and directories that carry no state file,
so the records themselves accumulate with no way to retire them but `rm`.

## Scope

- Start at `pruneCommand` in `src/commands/prune.ts`, which already walks the
  job root and can tell a live job from a finished one.
- What retiring keeps is the decision to make: the whole record, or the
  ticket-sized facts without the session transcript that holds most of the bytes.
- Whatever is kept must still answer what the board and the outcome files ask of
  a job that landed months ago.
- Retiring is something an operator asks for; a spawn or a sweep never removes
  history on its own.

## Out of scope

- The per-sweep cost of a single job, which is cut separately.
- Worktree pruning, which works today and keeps its behaviour.
- Archiving to a remote, or compressing records in place.

## Acceptance

- One command retires finished job records and reports how many it removed.
- A running job is never retired.
- A job whose branch has not yet been merged or dropped is never retired.
- A dry run prints exactly what would go and removes nothing.
- After retiring, `limen jobs` resolves and prints every record that was kept.
- The prune suite passes, including a project with a job running.
