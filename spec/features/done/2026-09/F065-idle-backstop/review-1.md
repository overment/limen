PASS 76e08959b168191e64d28b308be1a10a407eb6cb

`git rev-parse HEAD` matches the candidate (`76e08959b168191e64d28b308be1a10a407eb6cb`). No prior `review-*.md` in `spec/features/active/F065-idle-backstop/`. Board line for F065 matches the ticket; no ticket/board drift.

The prove-it-wrong check does not hold in this tree. `noteHostedIdle` (`src/supervisor.ts`) still refuses the new reason unless Herdr status is idle/done (not working/blocked), `activity` is `wait`, the last session stop is not `error`, assistant text exists, and `cleanWorktree` is true after the idle bound. Dirty, think/tool, errored, blocked, and missing-session cases return undefined and take the stall advisory instead. The reason string is `closed a clean idle session`, not `hosted session ended`. Result capture stays on the supervisor finalize path (`writeHostedResult` then `finalizeJob` → `recordCommits`).

**Note (plausible, not blocking).** `lastHostedAssistant` keeps the last non-empty assistant text in the newest jsonl, not strictly the last message. A later empty or tool-only assistant line would still satisfy `text`. After `turn_end` that is still a completed turn; it is not the response-less case the tests encode (no jsonl / no text at all).

**Note (plausible, not blocking).** `aborted` is not in the `errored` gate, so `noteHostedIdle` can return the clean-idle reason when aborted text and a clean tree coincide. The supervisor would still finalize `failed` from `isFailedStopReason` after `writeHostedResult` writes `stop-reason`. The recorded terminal reason would not be the clean-idle phrase.

**Checks run**
- `git rev-parse HEAD` → `76e08959b168191e64d28b308be1a10a407eb6cb`
- `npm ci` from `package-lock.json` → added 12 packages, 0 vulnerabilities
- `npx tsc --noEmit` → passed (hosted tests started afterward)
- `node --test test/hosted-spawn.test.ts` (full file, 120s wall) → 37 tests passed, then the reviewer harness timed out before the file finished; not a test failure, not re-run as a full lane
- Discriminating slice: `node --test --test-name-pattern='noteHostedIdle|clean tool-using idle|idle advisory|unseen idle after tools|session error fails' test/hosted-spawn.test.ts` → 12 pass, 0 fail (23.3s), including the new tool-using unit test, the new hosted supervisor finalize test, dirty/think/tool/error/blocked/missing-response boundaries, and the unseen-idle-after-tools regression
