# F711 · Empty failed and stopped jobs do not send finish webhooks

## Outcome

Short failed or stopped jobs without a result no longer wake external recipients. Operators can still see why delivery was skipped in the job files and detail view. Failed work with a written result keeps its finish notification; job outcomes and subscribed coordinator wakes remain unchanged.

## Scope

- Automatic finish delivery, starting at `src/finish-webhook.ts`, shared by detached wrappers and hosted supervisors.
- Empty means a missing, zero-byte, or whitespace-only job `result` file, not an empty log or a short runtime.
- A timestamped skip reason in the existing aggregate receipt and job log, without new configuration or workflow state.
- Existing project selection, continuation inheritance, and single automatic decision remain intact.

## Out of scope

- Manual `bin/tony-finish-ping.sh` sends, recipient routing, retries, or receiver wake proof.
- Changing result capture, terminal states, native coordinator notifications, or judging whether a handoff is useful.
- Model fallback, Alice application changes, or the parked wake-attempt work.

## Acceptance

- A configured `failed` or `stopped` job with a missing, zero-byte, or whitespace-only result invokes no sender and records `skipped` with its state and empty-result reason.
- A configured `failed` or `stopped` job with a non-whitespace result still sends its original label, state, and branch after durable finalization.
- A configured `done` job still sends even with an empty result, preserving the existing completion contract.
- An unreadable result is not evidence of emptiness and does not suppress delivery.
- Repeated or concurrent automatic finalization cannot send twice or overwrite an existing delivery receipt with a skip.
- Both job detail views expose the skip, while terminal state and native notification readiness remain unchanged.

## Notes

The automatic claim records the one delivery decision, including an intentional skip; it is not proof of a transport attempt. A later result does not re-arm that job. An operator may deliberately send manually after inspection, but a skip is not a retry request. HTTP acceptance remains distinct from an observed receiver turn.
