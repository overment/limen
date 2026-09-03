# F056 notes

## Seams

- `hook/wake.ts`: fallback grace, owner eligibility, error release, wake text.
- `templates/agents.md`: routed-wake hands stay off spawn/stop/steer.

## Decisions

- Default fallback grace is 5 minutes (`LIMEN_WAKE_FALLBACK_MS` overrides, same shape as other `LIMEN_*_MS` knobs). Tests that need “already old” still stamp `finished-at` in 2000.
- A session “owns jobs” when any `notify/subscribers/<session>` exists under this root (spawn or `limen watch`). Fallback never goes to a research session with no such record.
- `error` / `aborted` on the assistant message that entered a wake marks the pending claim `errored`. Confirmation then `rm`s the claim and does not touch `notify/unconfirmed`. The next sweep retries.
- Wake order: label, first sentence of `task.md` (omitted when absent), state, `handoffExcerpt` (stop reason, commits, final message, undelivered steers), produced-nothing fact, instruction. Routed instruction is “subscribed coordinator is busy; do not spawn, stop, or steer unless the human asks.”
- Duplicate inject after `delivered/<slot>` appears mid-claim is dropped and logged on the job `log`. Steady-state sweeps that see an already-delivered slot return before claiming (no log flood).

## Out of this slice

- Advisory threshold and hosted ending (F055).
- Which session spawn subscribes.
