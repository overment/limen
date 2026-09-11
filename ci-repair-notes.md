# CI repair: Actions run 34586899458

Both failures originate in `src/git.ts`; no close/sweep behavior, fake Herdr behavior, or wait deadlines changed.

- The leftover-tab test reproduced on the 14th full open-command repetition. Added timeout diagnostics exposed `state: failed` and `git add` failing on the worktree's `index.lock`, not a slow worker. Background `changedFileCount` runs status while the fake worker stages files. Both status probes now use `--no-optional-locks`, so observation cannot refresh/lock the worker's index.
- `test/git-status.test.ts` makes tracked-file stat data stale in real Git repositories. Both probes rewrote the index before the fix (2 failures); neither does afterwards, and clean/dirty counts remain correct.
- The ticket-author path test reproduced immediately on macOS: `/var/...` absolute input differs lexically from Git's `/private/var/...` root. Resolve directory aliases before containment, retaining the literal filename for Git history. Explicit directory-alias cases also exercise this on Linux.
- Source budget grows by four lines for directory normalization; timeout errors now retain job state and log before scratch cleanup.

Evidence lives outside this worktree at `/Users/overment/.overment/limen/tmp/evidence/ci-34586899458/`. Key files: `limen-ci-failed.log` (both Actions logs), `open-suite-probe-14.log` (index-lock reproduction), `paths-before.log`, `git-status-before.log`, `focused-final.log`, and `open-after-1.log` through `open-after-20.log` (20 passing open-command suites). A timed-out repetition batch was resumed; its incomplete 17th run was replaced by a completed run. The first focused bundle failed only the four-line source budget, then passed after its explicit adjustment.

Adam reviews/merges the candidate. Run the full native lane once after the candidate commit and retain `check.log` plus its exit status beside this evidence; that result is not asserted here. No Linux runner or new Actions run has been executed locally. F090/F092 are untouched.
