# Seven native failures are pre-existing on main

All seven failures named in `../remove-audio/NATIVE.md` reproduced on both the speech-removal candidate and freshly fetched `main`, at the same assertion sites. They do not block landing under the owner's brief. No runtime or test repair is justified within this speech-removal slice.

## Revisions and method

- Candidate: `4686c241a4f10c28b460abf545fb7bf7455e0c33`, containing source removal `cb3542a` plus its prior evidence commit.
- Baseline: `38b2dc9ffbcf20bb88edd50900c43ba40b3f3f69`; local `main` and `origin/main` matched after `git fetch origin`.
- Both used Node `v24.1.0` and Apple Git `2.50.1` on the same Mac, serially, with unchanged environment. Main ran in a fresh detached worktree, not the owner's working checkout. These Node tests use built-ins and required no dependency install.
- Command on each revision: `node --test --test-reporter=tap --test-concurrency=1 --test-timeout=60000 --test-name-pattern="$pattern" test/continue-command.test.ts test/hosted-spawn.test.ts test/prune-command.test.ts test/spawn-command.test.ts test/stop-command.test.ts`. The exact anchored seven-name pattern is in `candidate-context.txt` and `main-context.txt`.
- Both commands completed with exit **1**, **0 passed / 7 failed / 0 cancelled**. Candidate took 76.814 seconds; main took 78.932 seconds. Complete assertion output is retained in `candidate-seven.tap` and `main-seven.tap`.

## Same failing assertions, not a passing suite

| Test | Candidate and main evidence |
| --- | --- |
| `continue refuses a pruned checkout when its branch is missing without writing records` | `test/continue-command.test.ts:246`: expected missing-branch error substring absent. The assertion does not print actual stderr; the exact mismatch was not further diagnosed. |
| `hosted continue survives a killed caller and passes durable @continue, not @task` | `test/hosted-spawn.test.ts:1084`: actual continuation path starts `/private/var/`, expected `/var/`; continuation text matches. |
| `prune keeps nested running jobs owned by another checkout` | `test/prune-command.test.ts:98`: porcelain output does not include the literal expected child path. The preceding child-content assertion passed. |
| `spawn keeps nested running jobs owned by another checkout` | `test/prune-command.test.ts:98`: same literal child-path inclusion failure; preceding child-content assertion passed. |
| `leftover sweep keeps a nested container with a locked registered child` | `test/prune-command.test.ts:127`: same literal child-path inclusion failure; preceding child-content assertion passed. |
| `independent jobs can run concurrently and are merely announced` | `test/spawn-command.test.ts:205`: second spawn prints its ID without `note: 1 job already running`. The fixture's first job exits after 400ms; both runs miss the notice. |
| `sleeping descendant discovery delays stop only through its short bound` | `test/stop-command.test.ts:224`: elapsed stop exceeds the 2000ms upper bound (candidate **2383ms**, main **2473ms**). |

The hosted failure establishes a macOS path-alias mismatch. The other literal-path failures are consistent with that mismatch, but this comparison did not instrument their actual paths. The announcement and stop failures are timing-sensitive assertions. Baseline reproduction, not a guessed root cause, establishes that none of these seven was introduced by removal. No assertion, timeout, fixture, or unrelated runtime path was changed.

The original full native run on clean source commit `cb3542a` remains failed/incomplete: TypeScript and Biome passed, but the suite hit a 1200-second outer timeout after these seven failures. This continuation has not rerun the full suite. The paired seven-test runs establish pre-existing failures; they do not claim full-suite success.

## Land decision

Native cleanup condition satisfied: all seven named failures reproduce on main. Retirement condition is **not** satisfied: F046 still describes current optional playback. This implementation worker is prohibited by higher-priority instructions from editing board, ticket status, or outcome files. A coordinator must retire F046 honestly, then perform the already-authorized merge and push. See `HANDOFF.md`; no new owner permission is needed.
