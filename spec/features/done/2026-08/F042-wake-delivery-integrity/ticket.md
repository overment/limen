# F042-wake-delivery-integrity · A wake is only consumed by a wake that actually happened

[2026-08-25] [🟢] [PROVEN] [COORDINATOR] PROVEN · F042-wake-delivery-integrity

## Outcome

A wake claim is consumed only when the coordinator demonstrably processed the message. A footer error never silently stops delivery. A coordinator (re)start delivers advisories before completions. Whether anything was listening is a one-file question.

## Scope

- Delivered means answered. Today `claimDelivery` writes `accepted` and renames to `delivered` the moment `sendUserMessage`'s promise resolves — but a `followUp` resolves on queueing and dies with the process, and an idle inject whose turn immediately errors also counts. Split acceptance from confirmation: hold the claim accepted-but-unmoved until a turn actually ran after the injection (`agent_settled` is the candidate signal); only then promote to `delivered`. Invert `recoverClaim`'s stale-accepted promotion: stale and unconfirmed means release for re-delivery, not assume success.
- Verify pi 0.84.2's extension API semantics before designing: what promise resolution means per `deliverAs`, what fires when a turn errors, whether queued followUps survive shutdown (the 2026-08-25 evidence says they do not). Build on what pi guarantees; the fallback stance is delivered-at-most-30s-late, never silently-never.
- After two consecutive unconfirmed injections for the same job: stop retrying, toast naming the reason, durable job-log line. The claim stays for a human.
- `retire()` only on `session_shutdown`. A `setStatus` / `ui.notify` throw drops the footer (status timer) and nothing else — watcher, sweeps, and delivery keep running; one durable note records that the footer died.
- Advisory-first on `session_start`: the initial sweep handles running-with-advisory jobs before terminal completions, so a state flip mid-sweep cannot eat a standing advisory.
- Liveness stamp: the sweep touches `<root>/.limen/last-sweep` (ISO time + session id) at most every 30 s. It lives outside `jobs/`, so the recursive watcher never sees it. F043 reads it.

## Out of scope

- Supervisor-side rings (F045) and the seat sweep (F043).
- Changing claim-staleness constants or the claims/delivered directory protocol.
- Forking or patching pi. If its API cannot confirm turn execution, file the upstream issue and ship the staleness-re-delivery fallback.

## Acceptance

- Replayed 2026-08-25 scenario: an injection that never becomes a turn (queued followUp, process exits) leaves the claim recoverable and the wake re-delivers on a later sweep — the test ends with the wake in the transcript.
- Normal path: claim → accepted → confirmed → delivered exactly once; no double injection.
- Two unconfirmed attempts → no third automatic attempt, a toast, a job-log line.
- `setStatus` throw mid-session: footer gone, the next completion still delivers.
- `session_start` over one running-with-advisory job and one job finalizing that same second: both the advisory and the completion arrive.
- `.limen/last-sweep` is fresh while a coordinator is open and goes stale when none is.
- Wake-hook tests cover the new paths. `npm run check` green.

## Notes

Found in the 2026-08-25 wake investigation. Delivered markers written at 19:31:57/58 while one wake never entered the transcript (followUp lost at pi exit) and the other landed as a user message with no assistant reply (provider 400, credit exhaustion, earlier in the same session). `hook/wake.ts` accepts on promise resolution; `recoverClaim` promotes stale accepted claims to delivered; `retire()` at the `setStatus`/`notify` catches kills all delivery for the session with no trace. For calibration: 38/38 wakes landed over Aug 24–25 whenever a live coordinator existed — this ticket is about the lies at the margin, not the pipeline.

F038's pulse rewrite already landed in `hook/wake.ts` (`54e678c`) — build on that shape; the delivery paths this ticket touches are disjoint from pulse.
