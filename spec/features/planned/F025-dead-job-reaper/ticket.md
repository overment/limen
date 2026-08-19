# F025-dead-job-reaper · A job whose process died stops claiming to run

[2026-08-19] [🔴] [PLANNED] [COORDINATOR] PLANNED · F025-dead-job-reaper

## Outcome

After a crash, reboot, or kill, the record catches up with reality on its own: a `running` job whose process group is gone becomes `failed: process group gone`, its completion wake fires, its branch is spawnable again, and its worktree becomes prunable. A recycled process group cannot impersonate a dead wrapper on macOS.

Observed cost today (2026-08-18 review, finding S4): nothing ever transitions a dead `running` job. The wake footer shows `dead`, `limen jobs` shows `(not alive)`, but no wake fires, `liveJobUsesBranch` keeps refusing the branch, and prune keeps the worktree — forever, until a human notices and hand-stops a job that is not there. Liveness is a bare `kill(-pid, 0)`, so after a reboot a recycled pgid makes a dead job look alive indefinitely. The containment code re-verifies birth identity before every signal (`src/proc-pidinfo.rb`); the liveness checks never learned that discipline.

## Scope

- **Reaper in the sweep.** The wake's existing 500 ms sweep (`hook/wake.ts`) finalizes a running job as `failed: process group gone` when its recorded group has been observed dead across two checks at least 10 s apart, and `started-at` is older than F022's startup grace. Finalizing goes through the same file writes the wrapper uses (state after facts, idempotent per F024), and the normal completion wake then delivers with its ordinary claim path.
- **A CLI path too.** A coordinator is not always attached; `limen jobs` (or `limen prune`) performs the same transition under the same rules, so a headless seat converges when anyone looks. One shared helper, two callers.
- **Identity on macOS.** At handshake, the wrapper records its own birth time (`processInfo` already exists) beside `pid`. Liveness treats "group alive but recorded pid's birth mismatches" as dead. On Linux the file is absent and behavior degrades to today's group check plus the age rules — consistent with the accepted macOS-shaped identity stance in `docs/remote.md`.
- **Hosted jobs.** A hosted job whose supervisor is dead but whose agent target still answers is not reaped — the agent is the job. Dead supervisor and missing agent together reap as above.

## Out of scope

- Restarting, resuming, or re-spawning anything automatically.
- Porting the birth-identity helper to Linux (`docs/remote.md`: do not, until stop-on-Linux actually hurts).
- Changing what `failed` means, or adding new terminal states.
- The startup grace definition itself — F022 owns it; this feature consumes it.

## Acceptance

- A job record with `state=running` and a pid whose group is gone, `started-at` past the grace: within the sweep cadence the wake session transitions it to `failed: process group gone` and delivers a completion wake exactly once (claims dedupe as usual across two watching sessions).
- The same record younger than the startup grace is left alone.
- `limen jobs` run in a fresh shell (no coordinator) performs the same transition and prints the terminal state.
- After the transition, `limen spawn --branch <that branch>` succeeds and `limen prune` removes the worktree.
- On macOS, a fabricated record whose pid points at a live group but whose recorded birth time mismatches is treated as dead; with no birth file the group check alone decides.
- A hosted record with a live agent target and dead supervisor is not reaped.
- `npm run check` green.

## Notes

Seams: the sweep and `pulseOf` in `hook/wake.ts`; `liveJob` duplicates in `src/commands/spawn.ts` and `src/commands/prune.ts` (F022 may have unified them — build on that); `processInfo` in `src/proc.ts` for the birth read; finalize via F024's idempotent helper. The two-observations-10-seconds rule exists so one EPERM blip or a mid-write pid file cannot reap a live job; keep both observations on the same session's clock. The reaper writing `failed` is not a judgment about the work — the branch may hold perfectly good commits; the wake text should carry the ordinary handoff excerpt so the coordinator inspects rather than assumes loss.
