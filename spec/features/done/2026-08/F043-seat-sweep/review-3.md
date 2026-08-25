# Review verdict: FAIL

## Findings

1. **[Proven, blocking] Dead-lock reclamation can still make valid registry mutations fail.**  
   `hook/seat.ts:86-95` writes `reclaimer` before verifying that the lock inode still matches the abandoned lock. After another contender renames that lock and a new writer acquires `projects.lock`, a stale contender can create `reclaimer` inside the replacement lock. This races with the new owner’s recursive cleanup at `hook/seat.ts:70`.

   An 8-round dead-owner stress probe with 80 registrations and 12 pruners produced one child failure:
   `ENOTEMPTY, Directory not empty: .../.limen/projects.lock`, originating at `withRegistryLock` line 70. All 80 paths remained registered, but the mutation threw after completing. For `sweepCommand`, that prevents the project sweep; for `init`, it aborts remaining initialization.

   The exact lost-update path from `review-2.md` appears closed—no probe lost a registered path—but stale-lock concurrency is not reliably resolved. Reclamation must prevent stale contenders from mutating a replacement lock, with repeated regression coverage requiring both complete retention and zero child failures.

2. **[Unverified, non-blocking setup limitation] The exact acceptance command remains unavailable.**  
   `npm run check` exited 127 at `tsc: command not found` because this worktree has no `node_modules`.

## Checks run

- `git rev-parse HEAD` → `8548de08d6b37def5c41300faabd671bc65e3b9d`; checkout matches the supplied candidate.
- `git status --short` → clean.
- `git diff --check 4e84296..HEAD` and `git diff --check ee0a0c2..HEAD` → passed.
- Source count → 2692 `src/` lines, within the 2750-line limit.
- Targeted structure, sweep, and wake tests → 37/37 passed.
- Existing registry regression test repeated 25 times → passed each time.
- Dead-owner stress, 8 rounds of 80 registrations plus 12 pruners → one `ENOTEMPTY` child failure; no paths lost.
- Follow-up stress, 12 rounds of 100 registrations plus 20 pruners → no failures or lost paths, confirming the failure is intermittent.
- External TypeScript 5.9.3 compiler with cached Node type roots → passed.
- Biome 2.5.8 `check .` → 52 files passed.
- `npm run check` → exited 127 because `tsc` was unavailable.

Candidate commit: 8548de08d6b37def5c41300faabd671bc65e3b9d.
