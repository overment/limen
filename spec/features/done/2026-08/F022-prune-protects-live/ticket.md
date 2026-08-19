# F022-prune-protects-live · Prune never deletes a checkout a live job is standing in

[2026-08-19] [🟢] [PROVEN] [COORDINATOR] PROVEN · F022-prune-protects-live

## Outcome

Spawning or pruning while other jobs run is safe: a live reviewer's detached worktree survives, a job still in its startup window survives, and a locked checkout actually stays, as the code already promises. A spawn that failed during its handshake says so instead of printing `started`.

Observed cost today (2026-08-18 review, findings C1/S3/M1): `pruneFinishedWorktrees` protects live jobs by matching worktrees on *branch*, but review worktrees are detached — `git worktree list` reports them with no branch — so a running reviewer's checkout never enters `keepPaths` and is removed by `git worktree remove --force` on the next `limen spawn` (which prunes at `src/commands/spawn.ts:78`). The leftover sweep then `rm -rf`s anything not kept, including the locked checkouts the comment above it says survive. Liveness itself requires a `pid` file, which a detached job lacks for up to 2 s and a hosted job for up to ~3 minutes (`waitForShell` + `agent start` before the supervisor pid lands) — during that window the job is invisible to prune's keep-set, to `liveJobUsesBranch`, and to `countRunning`.

## Scope

- **Keep by the job's own record.** For every live job, `pruneFinishedWorktrees` adds `resolve(<jobDir>/worktree)` to `keepPaths` — branch-matching is no longer how live checkouts are found. Detached review worktrees are thereby covered.
- **The leftover sweep respects git.** The final `rm -rf` pass skips any path still registered in `git worktree list` for that repository, restoring the "a locked checkout stays until the next prune" behavior.
- **The startup window counts as live.** A job with `state=running`, no `pid`, and `started-at` younger than a grace bound (default 10 minutes — longer than the worst hosted startup) is treated as live by prune's keep-set and by `liveJobUsesBranch` in `src/commands/spawn.ts`. Older than the grace with no pid, it is not.
- **Handshake budget.** `HANDSHAKE_MS` rises from 2 s to 10 s (env-overridable). The wrapper writes `pid` immediately after boot, so the budget only bounds how long a genuinely dead wrapper takes to be noticed; 2 s is a false-failure budget on a loaded seat — the suite's own wrapper-spawning tests time out under parallel load for the same reason.
- **Honest spawn output.** When the handshake loop exits because state is no longer `running`, `spawn` prints the actual terminal state and detail instead of `started <label>`.
- **Deterministic suite.** The check/test scripts stop racing themselves: `--test-concurrency=1`, or timing budgets scaled by one env knob. Observed 2026-08-18: a parallel full run failed ~25 wrapper-spawning tests on a loaded machine; every one passes solo.

## Out of scope

- Reaping dead jobs whose grace has expired — F025 owns transitions; prune only decides what to keep.
- Any change to how worktrees are created or planned in `spawn`.
- Closing Herdr tabs of pruned jobs.

## Acceptance

- With a running fake review job (detached worktree, live pid), `limen spawn` of another job and a bare `limen prune` both leave the reviewer's worktree present; after the reviewer finalizes, the next prune removes it.
- A worktree whose `git worktree remove` fails is still present after the leftover sweep.
- A job directory with `state=running`, no pid, `started-at` 1 minute old: prune keeps its worktree, and a second `spawn --branch` on its branch refuses. The same record with `started-at` 1 hour old is not protected.
- A wrapper forced to fail before its pid write yields spawn output naming `failed`, not `started`.
- The full suite passes repeatedly under `npm run check` on a loaded machine (run it while a parallel load is active, or demonstrate the concurrency setting).
- `npm run check` green.

## Notes

Seams: `pruneFinishedWorktrees` and its local `liveJob` in `src/commands/prune.ts`; `liveJobUsesBranch`, `countRunning`, `waitForHandshake`, `HANDSHAKE_MS` in `src/commands/spawn.ts`; `package.json` scripts. The grace bound belongs beside the liveness helpers so prune and spawn share one definition — the current duplication (`liveJob` in both `spawn.ts` and `prune.ts`, plus `pulseOf` in `hook/wake.ts`) is exactly where the drift came from; unifying them into one exported helper is in scope if it stays small.
