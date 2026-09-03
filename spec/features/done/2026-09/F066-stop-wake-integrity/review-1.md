PASS 50d0b07ae9ed97e94a26fd8fc3d8ebec5f85f1a8

Reviewed `50d0b07ae9ed97e94a26fd8fc3d8ebec5f85f1a8` (`feat: mark stop delivered only after terminal state`) against `spec/features/active/F066-stop-wake-integrity/ticket.md`. `git rev-parse HEAD` is that commit.

The check that would prove it wrong does not hold. A hosted stop that still reports running throws `agent is still up` before `markCallerDelivered` in `src/commands/stop.ts`, so it never creates `notify/delivered/${session}`. Wake delivery in `hook/wake.ts` skips a session only when that slot already exists (`deliveryExists` / `claimDelivery`).

**Proven — acceptance holds.** Hosted and detached success paths write the caller marker only after state is not `running` (hosted: after the still-running throw; detached: after the 25ms settle or after `finalizeJob`). The pre-signal `mkdir` is gone. Discriminating tests in `test/stop-command.test.ts` passed: hosted success leaves `coordinator-a` delivered; hosted still-running does not; existing detached `done:` stop still silences the caller.

**Note — transient, not blocking.** Same file, two timeout-containment tests failed and were not rerun: `timeout completes delayed discovery before a fast parent exit` (`waitForState` 2s, job never `failed`) and `sleeping descendant discovery delays timeout only through its short bound` (elapsed ≥ 2s). Neither writes the stop delivered marker. The stop sibling of the sleeping-ps test passed. Not a proven F066 break.

**Note — plausible, not blocking.** “Eventual completion remains eligible” is shown by marker absence plus the wake-hook contract, not by an end-to-end wake after a failed hosted stop. Success tests assert the marker after the command returns, not an in-process order probe; the order is in `stop.ts`.

Checks run: `npm ci` from the lockfile (12 packages, 0 vulnerabilities). `node --test --test-concurrency=1 --test-timeout=60000 test/stop-command.test.ts` — 18 pass, 2 fail (the timeout tests above). Not run: `test/hosted-spawn.test.ts`, `test/wake-hook.test.ts`, `tsc`, biome.
