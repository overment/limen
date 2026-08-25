Verdict: FAIL

Findings

1. [Proven, blocking] Batched follow-ups cause duplicate delivery.
   hook/wake.ts:423-434 stores only one activeDelivery. Pi 0.84.2 supports followUpMode: "all", which emits multiple queued user
   messages before one assistant response. Each message_start overwrites activeDelivery, so only the last wake is marked answered. At
   agent_settled, earlier wakes are treated as unconfirmed and reinjected despite appearing in the answered turn.
   Reproduction produced three injections for two jobs: job one remained undelivered with a new claim, while job two was delivered.
   Add coverage matching Pi’s batched event sequence and associate the assistant response with every wake entering that turn.

2. [Proven, blocking] Another listener can reclaim a live accepted claim after 30 seconds.
   hook/wake.ts:183-188 protects claims only through the current extension instance’s in-memory pendingDeliveries. A second window
   sharing the same Pi session has no such entry, so recoverClaim() at hook/wake.ts:581-591 removes the first window’s accepted claim
   once its directory is stale, even if that window is still processing the wake.
   A two-window reproduction aged the accepted claim to 31 seconds and observed injections from both instances ([0, 1]). This
   violates the exactly-once acceptance path for ordinary turns lasting over 30 seconds. Recovery must distinguish a live owner from
   a dead listener, with a cross-window stale-claim test.

3. [Unverified, non-blocking review environment] npm run check could not be completed.
   The checkout has no installed development dependencies, so tsc was unavailable. I did not repair the detached runtime. The
   relevant dependency-free tests passed, but the ticket’s required complete check remains unverified.

Checks run

- git rev-parse HEAD — matched the supplied commit.
- git status --short --branch — clean detached checkout.
- git diff --check HEAD^ HEAD — passed.
- Installed Pi version check — 0.84.2; its docs/source confirm batched followUpMode: "all" behavior.
- node --test ... test/wake-hook.test.ts — 27/27 passed.
- Clean-environment node --test ... test/structure.test.ts test/wake-hook.test.ts — 31/31 passed.
- Batched-follow-up reproduction — failed candidate behavior: injections [one, two, one]; first wake was not delivered.
- Shared-session stale-claim reproduction — failed candidate behavior: both extension instances injected the same wake.
- npm run check — failed before checks: tsc: command not found.
- npm test under inherited hosted environment — 26 passed, 9 failed, 17 cancelled; environment variables contaminated unrelated
  context tests.
- Clean-environment npm test — did not complete within 240 seconds; one unrelated prune test had reported failure before timeout.

Candidate commit: af12f1b70453b09ff5307c885459ecab1070c2e7.
