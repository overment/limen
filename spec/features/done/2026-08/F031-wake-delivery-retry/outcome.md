# F031 outcome · wake delivery retry

Landed at `6ee8ff1` (2026-08-21, coordinator-written, suite-covered).

`claimDelivery` now awaits the injection promise before writing `accepted` and renaming the claim to `delivered`. A rejected injection — pi mid-compaction, where `isIdle()` reports idle but `prompt()` throws — releases the claim and logs `wake injection failed; the next sweep retries`, so the wake arrives on a later sweep instead of being lost behind a permanent delivered marker (including the `_fallback` slot, which previously would have blocked every other coordinator).

Proven: `test/wake-hook.test.ts` "a rejected injection releases the claim and the next sweep retries" (reject → no delivered marker → later sweep delivers). Live delivery through the new path exercised 2026-08-21 on this coordinator: the F030 stall wake for `2026-08-21-f034-continue-try-30eeedf4` arrived carrying commits and the final message after `/reload`. The rejection branch itself is test-proven; a live compaction collision was not staged.
