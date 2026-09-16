# F713 · Same settled tip does not ping twice

## Outcome

After an automatic finish already notified the owner for a settled git tip, another job that settles at that same tip stays quiet. Operators still see the skip in the job files. Empty failed and stopped jobs already stay quiet; this closes the remaining duplicate owner pings on a tip that already fired.

## Scope

- Automatic finish delivery, starting at `src/finish-webhook.ts`.
- Dedupe or idempotency for the same settled tip; no new configuration surface.
- A timestamped skip in the existing aggregate receipt and job log.
- Focused tests, plus evidence under `tmp/evidence/simple-path-wave/`.

## Out of scope

- The empty-result skip already landed for failed and stopped jobs.
- Manual finish-ping retries, receiver proof, or bot-turn receipts.
- Spawn refusing a ticket missing from the base commit, hosted PATH, jobs filtering, or a land command.

## Acceptance

- Two configured jobs that settle at the same recorded tip send at most one automatic ping.
- A job that settles at a different tip still sends.
- The quieted job records skipped with a same-tip reason in the aggregate receipt and job log.
- Empty failed/stopped skip and done-with-empty-result send remain unchanged.
- Repeated or concurrent finalization of one job still cannot send twice.
- Focused finish-webhook tests cover the same-tip skip and the different-tip send.

## Notes

Prefer idempotency over a new config surface. Map how a job records its settled tip before adding files. The per-job delivery claim already exists; this is the cross-job case Tony sees as ~5-minute duplicates.
