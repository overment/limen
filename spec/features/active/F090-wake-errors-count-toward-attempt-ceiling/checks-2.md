# Wake ceiling proof: repair fixed, full lane unresolved

Corrected candidate `0fa48fabd0f8faa9b461292d9cba97a1708fa59a` adds only a PID-cleanup wait to the finished-job refusal fixture. Coordinator inspection confirmed the retained patch matches the commit, the worktree is clean, and `hook/` and `src/` are unchanged from the original wake candidate `a477285`.

The missing-PID failure reproduced before the correction; the corrected refusal test passed 1/1 and also passed in the full lane. The installed-Pi replay at the corrected revision again recorded exactly two failed wakes, retained exhaustion, no delivered receipt, and no third wake after reload. Original focused wake evidence remains 64/64 at `a477285`; it is not a fresh 64-test run at this revision.

## Unresolved native proof

The one authorized full run passed TypeScript/Biome but timed out after 1,200 seconds without final test totals or a runner exit code. Its partial log emitted four failures:

- Concurrent independent jobs: `native-candidate.log:230`.
- Cross-process recovery of dead registry locks: `native-candidate.log:309`.
- Completion wake for a job that produced nothing: `native-candidate.log:335`.
- Watched/unwatched running-job sidebar counts: `native-candidate.log:347`.

Evidence root: `/home/overment/limen/tmp/evidence/f090-proof-repair-1/`. The log contains no final assertion diagnostics for these failures. Their causes are unproven; do not call them baseline defects, environment-only failures, or harmless timing noise. Coordinator process inspection found no remaining native test runner.

## Landing decision

Retain the candidate unmerged. Adam's review and the checklist's green full-native proof remain outstanding. The original run took 446 seconds and the repair run hit 1,200 seconds: about 27 minutes of full-lane checking across roughly 47 minutes of worker time.

The one-repair loop is closed after a second unsuccessful full lane. No third full run, repair, reviewer, or diagnostic job is started. The 1.0 wave is held at the wake ceiling; neutral webhook naming and subsequent checklist workers have not started. A separately bounded diagnosis of the four failures and runner timeout is the next technical work needed, not a waiver of the proof bar. This coordinator retains landing ownership; Phase 0's plan PASS is unchanged and is not a release claim.
