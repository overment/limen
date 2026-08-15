# Outcome

## Result

Landed. When Herdr is running, `limen spawn` opens a named tab that tails the job log without stealing focus. When the job ends the tab is renamed `<label> · done|failed|stopped` and left open. `limen open <id>` focuses that tab, or recreates it (live log if still running, stored log if finished). `limen close FNNN` closes leftover job tabs only after that feature folder is under `done/` or `dropped/`. It never closes the coordinator tab and never deletes `.limen/jobs/`.

Without Herdr, spawn is unchanged. Files remain the record; a tab is a view.

Coordinator ran `tsc`, biome, and 14/14 on `open-command`, `spawn-command`, and `structure`. The worker’s full suite was 88/88 with `LIMEN_*` stripped. Independent review was skipped: the complete diff is local and reversible, native checks passed, and a bad tab is cheap to close.

## Date

2026-08-15

## References

- `037cc81` feat: open a named Herdr watch tab on spawn
- `762768d` feat: rename, reopen, and close leftover Herdr job tabs
- `a65584e` fix: format the F012 command list in the structure test
- `src/herdr.ts`, `src/commands/open.ts`, `src/commands/close.ts`
- `test/open-command.test.ts`, `test/spawn-command.test.ts`
