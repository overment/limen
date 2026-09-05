PASS a48202003436520932a905def91650598d216917

No proven break of the F085 acceptance bullets. `HEAD` matches the supplied candidate; the worktree remained clean. No source edits.

**Checks run**
- `npm ci`: passed in candidate and parent checkouts; zero vulnerabilities.
- `node --test --test-reporter=tap --test-concurrency=1 --test-timeout=60000 test/wake-sweep.test.ts test/wake-hook.test.ts test/reaper.test.ts`: **51 passed, 1 failed**. All **45 wake tests passed**, including fallback after grace with no filesystem events and exactly one confirmed busy-session wake. The second 475-record sweep took **1.843 ms**, with zero settled-record reads.
- Targeted execution of the four previously reported native failures: **2 passed, 2 failed**.
- One baseline comparison at parent `60f28df2ba584c588d269d191d3d74458d0c2cfe`, selecting the two remaining failures plus the process-identity failure: **2 passed, 1 failed**.
- `git diff HEAD^ HEAD --check`: passed.
- Recomputed retained CPU sample statistics: matched the supplied summary.

**Nonblocking findings**
- **PROVEN — baseline failure:** `test/finalize.test.ts:136`, “a clean run writes no stop-reason,” timed out waiting for `done` on both candidate and parent. This is not evidence of an F085 regression.
- **UNVERIFIED — cause/attribution:** `test/diff-command.test.ts:24`, the no-TTY diff test, timed out waiting for its fixture job to finish on the candidate but passed on the parent. Failure occurred before invoking `diff`; fixture/startup code is unchanged. Keep this unresolved rather than declaring the native lane green.
- **UNVERIFIED — process-query failure:** `test/reaper.test.ts:37` expected `processInfo(...).kind === "present"` but received `"unavailable"`; the parent passed. This assertion exercises unchanged process-query code, not the new shared-candidate reaper path. That new path’s test passed.
- **PROVEN — non-reproduction:** the Herdr diff-tab test (`test/diff-command.test.ts:51`) and hosted-start handshake test (`test/hosted-spawn.test.ts:535`) passed in isolation. Their earlier failures remain transient observations with unverified causes.

**Retained evidence, not rerun**
The clean-candidate real-Pi CPU recording contains 61 samples per minute-long phase: idle maximum **2.4%**, one-running maximum **10.1%**. This used synthetic progress writes and disabled Herdr. **UNVERIFIED:** Alice production CPU and real model-backed wake turns.

The retained full `npm run check` passed TypeScript/Biome but timed out at 600 seconds without final test totals. It remains incomplete; no full-suite rerun was made.

Review logs are retained under `.limen/jobs/2026-09-05-f085-coordinator-cpu-review-1-8b74163a/evidence/` in the owning repository.
