# Review verdict: FAIL

## Findings

1. **[Proven, blocking] Stale-lock recovery can still lose registered projects.**
   `hook/seat.ts:67-87` lets multiple contenders identify the same dead owner and recursively remove `projects.lock`. After one contender removes the stale lock and a new writer acquires it, another stale-lock contender can remove that new writer’s live lock. Multiple writers then enter the read-modify-write section concurrently.

   An 8-round probe started each round with a dead-owner lock and 80 concurrent registrations. One round retained only 78/80 projects despite every child exiting successfully. The prior blocking finding is therefore improved for ordinary concurrency but not fully resolved. Reclaim stale locks without allowing a contender to delete a replacement lock, and add dead-owner concurrent registration/pruning coverage.

2. **[Unverified, non-blocking setup limitation] The exact acceptance command remains unavailable.**
   `npm run check` exited 127 at `tsc: command not found` because this detached worktree has no `node_modules`.

## Checks run

- `git rev-parse HEAD` → `4e8429604c1d518fb0768da27955b06f1e9e6e86`; checkout matches the supplied candidate.
- `git status --short` → clean.
- `git diff --check 3acecfa..HEAD` and `git diff --check ee0a0c2..HEAD` → passed.
- Source count → 2692 `src/` lines, within the 2750-line limit.
- Targeted structure, sweep, and wake tests → 37/37 passed.
- New ordinary concurrent registration/pruning test → passed.
- Dead-owner lock stress probe → 7 rounds retained 80/80; one retained 78/80, with no process failures.
- `npm run check` → exited 127 because `tsc` was unavailable.
- Full native test command → timed out after 300 seconds; before timeout it also encountered unrelated hosted-environment communication assertions and existing prune/process-timing failures, so the full suite is unverified in this runtime.
- Isolated communication/prune rerun → exited 1; communication tests consumed the harness’s `LIMEN_CONTEXT_ROOT`, and the prune assertion also failed.

Candidate commit: 4e8429604c1d518fb0768da27955b06f1e9e6e86.
