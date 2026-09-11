# Running-owner recovery: implementation and evidence map

Running records now distinguish process visibility from responsibility. `src/reap.ts:liveJob` retains branch/prune visibility semantics; `ownerAlive` checks the recorded PID and its available birth identity. Only a PID-less/invalid-PID record with a valid recent `started-at` receives startup grace. Dead valid PIDs enter confirmation immediately, and missing/malformed timestamps expire rather than suppress inspection.

## Recovery seam

- `src/recovery.ts` reconstructs label, role, agent name, job ID and context root from the job directory. Pre-F048 records use the existing deterministic `hostedAgentName` and `worker` fallback. A concrete relocation updates both `herdr/agent` and `herdr/pane` before the handshake.
- The existing detached supervisor starts a **candidate**, not a second agent. The candidate acquires `job/recovery` in its own process before rechecking state, owner and hosted reality. Competing sweeps can briefly launch multiple candidates, but only the winner writes a PID and enters supervision; losers exit without a handshake. Claiming in the child deliberately avoids transferring a dead caller's claim across a launch-to-handshake gap.
- A populated claim directory is atomically renamed into place. Its unique entry carries claimant PID/time and available birth identity. Stale removers unlink only the entry they inspected and use nonrecursive `rmdir`; they cannot remove a replacement owner's populated directory. Dead claimants are reclaimable. The winner releases after the normal PID/birth handshake; failure finalization uses the same claim. Notification claims and coordinator subscriptions are untouched.
- `src/supervisor.ts` never rewrites a terminal state to `running`. Recovery cannot enter initial agent startup, even with an inherited start flag. The ordinary advisory, result, finalization and tab-close loop remains the watch implementation.
- Recovery uses fresh Herdr status, not the last-good status used for ordinary visibility. Unknown status, unavailable Herdr, failed list queries, or inconclusive relocation wait without adopting or failing. A positive location with a contradictory follow-up status also waits.
- Hosted owner loss with a concretely absent agent captures the session handoff and finalizes `failed: hosted supervisor lost`; detached owner loss keeps `failed: process group gone`.
- Both existing entry points remain wired to this reaper: `hook/wake.ts` calls `reapDeadJobs`, and `src/commands/sweep.ts` calls `confirmDeadJobs`. There is no coordinator adoption, new daemon, notification routing change, wake-candidate change, or startup retry change.

## Discriminating fixtures

`test/reaper.test.ts` first changed the old live-agent/dead-supervisor visibility assertion into a young-owner-loss recovery assertion. Against the original implementation it failed with PID `999999999` unchanged. That counterexample is retained in `regression.log`.

`test/recovery.test.ts` uses private real job files, real long-lived Node agent processes, real detached supervisors and separate Node sweep processes. Its fake Herdr reports those fixture agents, records every command and refuses any `agent start`. It verifies:

- Killing the original young supervisor, three competing sweeps, exactly one replacement handshake, killing that replacement, two further competing sweeps, exactly one further owner, idle advisory, captured handoff, terminal `done`, and tab close. The final log has exactly three supervisor starts including the original, zero agent starts, and unchanged coordinator/subscriber files.
- Killing a real process after it acquires the filesystem claim; three sweeps recover it, produce one owner and remove the claim.
- A PID-less hosted agent waits inside actual startup grace and is adopted after expiry. Missing/malformed PID/timestamp detached records and a copied 2026-08-27 shape fail after confirmation. An expired PID-less hosted record with a missing agent also fails.
- Previously cached working status followed by a transport outage, explicit unknown status and an unavailable relocation list all preserve the pending case without an owner or failure. A later concrete moved pane is adopted using missing-role/name/agent-file fallbacks and malformed PID/missing timestamp.
- Uncertain then concretely absent agent captures the final handoff, records the hosted failure reason, preserves its subscriber and leaves delivery unclaimed. Launching a recovery candidate against that terminal record neither writes a PID nor starts an agent.

Only fixture-owned processes were killed. No production job, coordinator process, real Pi provider or real Herdr pane was used. Linux process/file behavior is proven here; a real-seat/macOS orphan adoption was not run. Wake eligibility is proven, not transport delivery or a receiver turn.

## Retained checks

Artifacts are outside the worktree at `/home/overment/limen/tmp/evidence/f049-63cc811b/`.

- `install.log`: `npm ci` succeeded from the lockfile.
- `regression.log`: initial expected failing ownership regression.
- `reaper-probe.log`: seven reaper checks passed.
- `recovery-probe.log`: five isolated recovery checks passed, with fixture PID/count diagnostics.
- `typecheck-2.log`: initial new-test errors (unused import and tuple inference); corrected locally. `typecheck-3.log` and `scoped-static.log`: TypeScript passed.
- `biome-probe.log`: formatting differences in changed files; only those files were formatted. `scoped-static.log` and `scoped-biome-final.log`: scoped Biome passed. `git diff --check` passed.
- `structure-probe.log` and `structure-count.log`: the new runtime exceeded the old source ceiling. The structure test now bounds the resulting 3915 lines (142 above the old ceiling), explicitly including recovery rather than removing the guard.
- `focused.log`: 98 passed, five failed. Those five jobs/pulse fixtures planted supposedly new running records without a timestamp, relying on the loophole this change removes. Their timestamps now represent real startup grace; the historical ordering fixture uses a live fixture-test PID. Display/pulse assertions were preserved, not weakened.
- `focused-final.log`: 103 passed, zero failed/cancelled across reaper, recovery, hosted-spawn, hosted-hook, job, jobs-command and structure tests. Includes existing killed-caller startup, continuation and stop behavior.
- `fixtures/`: retained job log/state/result/advisory/target/coordinator snapshots and fake-Herdr command transcripts for the five recovery scenarios.
- `candidate.txt`, `candidate.patch`, `native.log`, `native.exit`, `handoff.md`: the committed candidate identity, reviewable diff, single post-commit full native run and final handoff. Read those files for the full-lane result; the focused result above is not a full-suite claim.

Focused command: `LIMEN_RECOVERY_EVIDENCE=/home/overment/limen/tmp/evidence/f049-63cc811b/fixtures node --test --test-concurrency=1 --test-timeout=60000 test/reaper.test.ts test/recovery.test.ts test/hosted-spawn.test.ts test/hosted-hook.test.ts test/job.test.ts test/jobs-command.test.ts test/structure.test.ts`.

The full native command is `npm run check`, once after the clean candidate commit. Preserve unrelated failures without repairing them or repeating that lane. Board changes, merge and review remain coordinator-owned.
