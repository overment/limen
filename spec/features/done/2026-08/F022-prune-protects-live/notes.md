# F022 notes for the next worker

Landed at `8a44bb5` on `limen/2026-08-19-f022-prune-protects-live-889f375a`.

## Done
- `pruneFinishedWorktrees` keeps `realpath(jobDir/worktree)` for every `liveJob`, not branch match.
- Leftover `rm -rf` skips any path still in `git worktree list`.
- Shared `liveJob` in `src/proc.ts`: running + (live pid | hosted agent | no pid and `started-at` younger than `STARTUP_GRACE_MS` = 10m).
- `liveJobUsesBranch` / `countRunning` use the same helper.
- `HANDSHAKE_MS` default 10s via `LIMEN_HANDSHAKE_MS`.
- Spawn prints `<state> <label>` + last limen/control log line when handshake exits because state is no longer `running`.
- Suite: `--test-concurrency=1`, `--test-timeout=60000`.
- Keep-set compares `realpath` so macOS `/var` vs `/private/var` does not drop a live checkout.

## Checks
- This worktree has no `node_modules`. Typecheck used main-repo `tsc --typeRoots`. Biome used main-repo `biome check .` (clean).
- F022 tests pass: `test/prune-command.test.ts` (3) + spawn fail-before-pid.
- Full `npm run check` cannot run here (`tsc` not on PATH).
- Communication-hook tests fail if parent `LIMEN_*` / `PI_*` leak; strip them (see `test/scratch.ts`).
- `test/stop-command.test.ts` "sleeping descendant discovery delays timeout only through its short bound" is a pre-existing 2s wall-clock flake (F007). Not changed. Failed twice at ~3–4s under load.

## Not done
- Ticket not moved to proven. Reviewer still needs `npm run check` in a tree with `node_modules`.
- F025 still owns reaping dead jobs after grace.
- `pulseOf` in `hook/wake.ts` still duplicated with `derivePulse`; not unified (display vs keep-set).
