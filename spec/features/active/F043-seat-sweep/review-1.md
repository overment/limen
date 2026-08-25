# Review verdict: FAIL

## Findings

1. **[Proven, blocking] Concurrent registry upserts lose registered projects.**
   `hook/seat.ts:10-18` performs an unlocked read-modify-write of `~/.limen/projects`. Concurrent `session_start` or `limen init` processes can read the same old registry and overwrite each other. Five 100-process probes retained only 79, 84, 92, 14, and 93 projects; a final probe retained 34/100. Missing projects are never swept, reaped, or rung until registered again. `sweepCommand` can similarly overwrite a concurrent registration while pruning. Serialize all registry mutations across processes and atomically replace the file; add concurrent registration/pruning coverage.

2. **[Unverified, non-blocking setup limitation] The exact acceptance command did not run.**
   `npm run check` exited 127 at `tsc: command not found` because this detached worktree has no `node_modules`. Equivalent locked compiler and formatter binaries passed, but the exact command remains unverified.

## Checks run

- `git rev-parse HEAD` → `3acecfa245be660826ff69fdd8eeaa20b57a810b`; checkout matches the supplied candidate.
- `git status --short` → clean.
- `git diff --check 3acecfa^ 3acecfa` → passed.
- Source count → 2694 lines, within the 2750-line limit.
- Locked TypeScript 5.9.3 compiler with external type roots → passed.
- Biome 2.5.8 `check .` → 52 files passed.
- Targeted structure, sweep, and wake tests → 36/36 passed.
- Full clean-environment test run → 166/171 passed. One prune test and four pre-existing process/timing tests failed; isolated prune rerun passed, while the four stop-process tests still failed in this runtime.
- Concurrent registry probe → reproducibly lost 7–86 of 100 distinct registrations.
- `plutil` coverage passed through the sweep install test.
- No-pane Herdr probe reached the daemon but reported notifications disabled; `osascript` argument handling probe passed. Actual launchd interval/reboot execution was not live-proven.

Candidate commit: 3acecfa245be660826ff69fdd8eeaa20b57a810b.
