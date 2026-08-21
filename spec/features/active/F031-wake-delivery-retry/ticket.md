# F031-wake-delivery-retry · A failed wake is retried, not silently lost

[2026-08-20] [🟠] [ACTIVE] [COORDINATOR] ACTIVE · F031-wake-delivery-retry

## Outcome

A completion wake whose injection fails reaches the coordinator on a later sweep instead of vanishing behind a permanent `delivered` marker. The observed failure: toast fires, no turn starts, and the job reads delivered forever — including for the `_fallback` slot, which then blocks every other coordinator from ever picking the job up.

## Evidence

`hook/wake.ts` `injectWake` calls `pi.sendUserMessage()` fire-and-forget; `claimDelivery` writes `accepted` and renames the claim to `delivered` synchronously, before the injection resolves. Meanwhile pi's `prompt()` rejects asynchronously when compaction is in progress ("Cannot submit a prompt while compaction is in progress"), and pi's `isIdle` is only `!_isAgentRunActive` — manual compaction does not set `_isAgentRunActive`, so `isIdle()` reports true exactly when the bare idle-path injection will throw. Verified against pi source (`packages/coding-agent/src/core/agent-session.ts`): `isIdle` getter, `compact()` controller handling, `prompt()` guard at the streaming branch.

## Scope

- `injectWake` returns the `sendUserMessage` promise; `claimDelivery`'s `send` path awaits it and only writes `accepted` + renames to `delivered` after resolution. A rejection removes the claim so the next 500 ms sweep retries delivery.
- Applies to both completion and advisory paths; fallback eligibility logic itself unchanged.
- One durable log line when a retryable injection failure happens, so the compaction window is observable.

## Out of scope

- Any change to pi (compaction-awareness belongs upstream).
- Toast wording, Herdr notification behavior, or mute semantics.

## Acceptance

- A test stubbing `sendUserMessage` to reject: claim is released, no `delivered` marker, next sweep attempts delivery again; eventual success marks delivered exactly once.
- Happy path byte-identical: idle-first inject stays a real turn; busy inject stays `followUp`.
- `npm run check` green.

## Notes

Blast radius is notification routing — per the shop manual this earns a fresh reviewer when implemented. Small enough to implement in one sitting beside F030's live prove.
