PASS 99356b3e20e9b3be5f9fa9d382f9f9ae8fd54243

HEAD matches the named candidate (`99356b3e20e9b3be5f9fa9d382f9f9ae8fd54243`). Routing behavior is in parent `607e5f1` (`feat: route wakes to the owning session, facts first`); the tip only refreshes `templates/.history/agents.md`.

No blocking finding. Acceptance bullets hold on the tree and in the wake suite.

**Checks run**
- `git rev-parse HEAD` → `99356b3e20e9b3be5f9fa9d382f9f9ae8fd54243` (match)
- `npm ci` from `package-lock.json` in this worktree (12 packages, 0 vulnerabilities)
- `node --test --test-concurrency=1 --test-timeout=60000 test/wake-hook.test.ts` → 34 pass, 0 fail, 13159 ms
- Structure/typecheck/biome: not run (unverified, not blocking)

**Acceptance (proven)**
- Mid-turn owner does not lose the job to an idle helper inside grace; after the window, fallback requires a subscriber/watch record (`sessionOwnsJobs` reads `notify/subscribers/<session>`, the same path `limen watch` writes). Covered by `fallback waits out the grace window and skips sessions that own no jobs` and the updated fallback test.
- Assistant `error`/`aborted` sets `pending.errored`, `releaseUncounted` removes the claim and does not touch `notify/unconfirmed`; next sweep re-injects. Covered by `a provider-error turn releases the claim without spending an attempt`.
- Second delivery of the same slot is refused (`deliveryExists` before claim; exclusive `notify/claims/<slot>` mkdir; post-mkdir `delivered` check). Covered by the order test’s “two sweeps” assertion and existing confirmation tests.
- Wake order is label, first sentence of `task.md`, state, excerpt (commits / final message), instruction (`completionWake` / `joinWake`). Tests assert indices.
- Wake suite passed, as above.

**Notes (plausible, not blocking)**
- Default grace is 5 minutes (`DEFAULT_FALLBACK_GRACE_MS`); the new grace test sets `LIMEN_WAKE_FALLBACK_MS=60000` rather than asserting that default. Production path uses the constant unless the env knob is set.
- “Dropped and logged” only writes the job `log` on the post-mkdir `delivered` race; a later sweep that sees `delivered/<slot>` already returns before claiming (no log flood). Dropped-not-delivered is still proven.
