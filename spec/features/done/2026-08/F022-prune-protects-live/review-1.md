**PASS.** Candidate `8a44bb56c036cd2d6200b9aec1d2ecd561bffd80` matches this checkout (`git rev-parse HEAD`). It does what `spec/features/active/F022-prune-protects-live/ticket.md` asks: prune keeps live checkouts from the job’s `worktree` record (detached reviewers included), the leftover sweep skips paths still in `git worktree list`, `running` + no pid + `started-at` younger than 10 minutes is live for keep-set and `liveJobUsesBranch`, `HANDSHAKE_MS` is 10s and `LIMEN_HANDSHAKE_MS`-overridable, handshake exit on a non-`running` state prints that state instead of `started`, and the suite scripts use `--test-concurrency=1`.

This is a first review. No prior `review-*.md`.

## Findings

None blocking.

Non-blocking, outside blast radius (**proven**, not an F022 regression): `test/stop-command.test.ts` `sleeping descendant discovery delays timeout only through its short bound` failed here at 2988 ms and again solo at 3124 ms (`Date.now() - started < 2000`). F022 does not touch that test or the timeout-exhaustion path. Same test fails on main `b55853e` (F022 is not an ancestor) at 2980 ms. F018/F023 already recorded this flake. Sibling stop-bound test passed.

Non-blocking (**unverified** as one command): this worktree has no `node_modules`; literal `npm run check` was not executed. Equivalent pieces below.

`hook/wake.ts` `pulseOf` is still a local Pulse (missing pid → `"starting"`), not the new `liveJob`. Ticket allowed unification “if it stays small”; the boolean keep-set helpers that caused the prune bug are the ones that were unified.

## Acceptance

| Requirement | What the candidate does | Evidence |
|---|---|---|
| Live detached reviewer survives `prune` and a later `spawn`; next prune after finalize removes it | `pruneFinishedWorktrees` adds `resolved(jobDir/worktree)` for `liveJob`; leftover sweep also skips `registered` git paths | `prune and spawn keep a live reviewer's detached worktree` passed (6928 ms / 6750 ms) |
| `git worktree remove` failure survives leftover `rm -rf` | After `removeWorktree` catch + `pruneWorktrees`, sweep skips `registered.has(path)` | `leftover sweep leaves a worktree git still has registered` (lock) passed |
| `running`, no pid, `started-at` 1 min: keep + `spawn --branch` refuse; 1 hour: neither | Shared `liveJob` in `src/proc.ts` (`STARTUP_GRACE_MS = 10m`); prune and `liveJobUsesBranch` / `countRunning` call it | `startup window is live; expired running-without-pid is not` passed |
| Wrapper dies before pid write → output names `failed`, not `started` | After `waitForHandshake`, `state !== "running"` prints `${state} ${label}` + last `[limen ` / `[control ` detail. `spawn("")` throws before the pid write; `failInternalJob` finalizes | `spawn prints failed when the wrapper dies before writing pid` passed (1860 ms); status 0 as the test requires |
| Suite stops racing itself | `package.json` `test` and `check`: `--test-concurrency=1 --test-timeout=60000`. `LIMEN_HANDSHAKE_MS` is allowlisted in `test/scratch.ts` | Setting present; serial full run 103 pass / 1 fail (stop flake above) |
| `npm run check` green | tsc + biome + tests | See checks; literal script **unverified** |

Seams match the ticket: local `liveJob` copies in `prune.ts` / `spawn.ts` are gone; one export in `src/proc.ts`. `HANDSHAKE_MS` default 10_000, env override. Handshake timeout still `finalizeJob` + throw (not the honest-print path); ticket only requires the print when the loop exits because state is no longer `running`.

## Checks run

| Check | Result |
|---|---|
| `git rev-parse HEAD` | `8a44bb56c036cd2d6200b9aec1d2ecd561bffd80` (matches named candidate) |
| `git status --short` | clean |
| `node --test --test-concurrency=1 --test-timeout=60000 test/prune-command.test.ts test/spawn-command.test.ts` (this job’s `LIMEN_*` / `PI_SESSION_*` unset) | 12/12 pass, 47.0s |
| Same flags, `test/*.test.ts`, same clean env | 103 pass, 1 fail (stop timeout bound, above), 199.8s |
| That stop test solo in this worktree | fail, 3124 ms |
| Same stop test on main `/Users/overment/.overment/limen` @ `b55853e` | fail, 2980 ms |
| `/Users/overment/.overment/limen/node_modules/.bin/tsc --noEmit --typeRoots <main-repo>/node_modules/@types` | pass (worktree has no `@types/node`; bare `tsc --noEmit` is `TS2688`) |
| `/Users/overment/.overment/limen/node_modules/.bin/biome check .` | pass, 47 files |
| Homebrew `biome check .` | config error (CLI 2.4.9 vs schema 2.5.8) — wrong binary, ignored |
| Literal `npm run check` | **unverified** (no worktree `node_modules`) |

Candidate commit: 8a44bb56c036cd2d6200b9aec1d2ecd561bffd80.
