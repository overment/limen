# F026-spawn-preflight · A job records what it ran against, and refuses what cannot work

[2026-08-19] [🟠] [ACTIVE] [COORDINATOR] ACTIVE · F026-spawn-preflight

## Outcome

Every job record names the pi and Herdr versions it ran under, so a post-mortem never guesses; a coordinator on the wrong Node or with dead credentials learns at spawn time, not from a burned 90-minute job; and the security notes state precisely what containment does not do on Linux.

Observed cost today (2026-08-18 review, finding A4): limen pins neither binary and probes neither at runtime, while both move fast — pi 0.84.0 shipped a breaking change to the exact JSON stream limen consumes (absorbed, by luck of good parsing), and Herdr 0.8's envelope shape drift produced F020. When the next break lands, limen fails at a distance — a wake that never fires, a supervisor that finalizes early — rather than at the boundary with a name attached.

## Scope

- **Record versions.** `spawn` captures `pi --version` and (when Herdr is in play) `herdr --version` into `.limen/jobs/<id>/versions`, best-effort and non-blocking. `limen jobs <id>` prints it.
- **Fail loud on the impossible.** `pi` missing from `PATH` fails spawn with a clear message before any worktree is created. `bin/limen` checks `process.versions.node` against the supported major (24) and exits with one sentence instead of a strip-types stack trace.
- **Optional auth preflight.** With `LIMEN_PREFLIGHT=auth`, spawn runs `pi auth check` (exists since pi 0.84.1) with the job's resolved model before creating the record; a failed check fails the spawn with pi's own message. Off by default — the seat may intentionally spawn ahead of a credential refresh.
- **Say what Linux does not contain.** One precise paragraph in `SECURITY.md`: on Linux, escaped-descendant containment does not signal at all (identity verification is macOS-only, and unverified processes are never signaled) — group-level TERM/KILL is the real boundary there; a cleanup note records what could not be confirmed. `docs/remote.md` already accepts this; SECURITY.md is where a reader checks.
- **Known-good note, not a gate.** The README (or `docs/`) names the last pi and Herdr versions the suite was exercised against, updated when they move. No runtime version gate — recording and documentation only; a gate would rot faster than the binaries.
- **Name the duplicate-wake window.** One sentence in `docs/remote.md`'s traps: with two coordinators (laptop + seat), a machine suspended mid-claim for over 30 s can produce a rare duplicate wake — at-least-once is the designed failure direction, not a bug to file.

## Out of scope

- Any behavior branch on version numbers.
- Retry, model fallback, or provider logic.
- Bundling or vendoring pi/Herdr, or `npm engines` enforcement beyond the one-line runtime check.

## Acceptance

- A spawned job's record contains `versions` naming both binaries when both are present, and pi alone otherwise; `limen jobs <id>` shows it.
- Spawn without `pi` on `PATH` fails before `git worktree add` runs.
- `bin/limen` on an unsupported Node major prints the one-line requirement (exercised by invoking the check function, not by installing old Node).
- With `LIMEN_PREFLIGHT=auth` and a fake `pi` whose `auth check` fails, spawn fails with that output and creates no job directory; with the check passing, spawn proceeds. Unset, no preflight call is made.
- `SECURITY.md` carries the Linux containment paragraph; `npm run check` green.

## Notes

Seams: `spawnCommand` in `src/commands/spawn.ts` (before `planWorktree`); `bin/limen`; `SECURITY.md`; `README.md`. Keep the version capture out of the job's critical path — a hung `herdr --version` must not stall a spawn (bounded like the process queries in `src/proc.ts`, or fire-and-forget after the handshake). The record is the point: F020's shape drift was only diagnosable because a live probe happened to run — `versions` makes that probe permanent and free.
