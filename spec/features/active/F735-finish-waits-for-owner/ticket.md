# F735 · A finished branch waits for its landing owner

## Outcome

A worker finishing its isolated branch tells shepherds the branch awaits its coordinator's absorb/review/merge, not that the plant is Ready to start the next lane. The job lifecycle remains truthful: done means the worker ended, not that the branch landed. Both automatic webhook and subscribed wake deliver the same distinction.

## Scope

- Start at the finish sender and completion wake; keep existing transport receipts, author routing and at-most-once event identity.
- Carry explicit waiting-on-owner/merge-not-ready information in finish events without claiming a specific coordinator when the job record has no reliable owner identity.
- Keep failed and stopped jobs actionable as failures, never as a new-spawn signal.
- Reflect the same owner handoff in `limen jobs` where job result or finish receipt is shown, without parsing project Markdown as machine state.

## Out of scope

- Automatically merging a finished branch, controlling external shepherd software, or installing an Alice/mega-specific protocol.
- Treating `status: done` as proof of acceptance, review or merge.

## Acceptance

- A finished side branch with a parent coordinator still landing work emits Waiting on owner, not Ready, to the opt-in webhook; its job state remains done.
- A review PASS awaiting exact-SHA merge does not invite another release lane through the default handoff.
- Subscribed coordinator wakes direct inspection and landing; unowned/fallback wakes do not spawn on behalf of another coordinator.
- Routing, no-author skip, duplicate-tip suppression and sender-failure receipts still work.
