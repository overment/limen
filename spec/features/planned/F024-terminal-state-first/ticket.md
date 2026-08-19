# F024-terminal-state-first · Terminal truth lands first, once, and includes why the run stopped

[2026-08-19] [🔴] [PLANNED] [COORDINATOR] PLANNED · F024-terminal-state-first

## Outcome

The durable record beats the cosmetics: a job's terminal state is written before any Herdr call can delay it, exactly one writer finalizes, a provider-failed run is visibly a provider failure instead of a calm `done`, and a steer the worker never saw is reported rather than lost.

Observed cost today (2026-08-18 review, findings S2/A2/M3/M4): `finalizeJob` runs `renameJobTab` — a `spawnSync` against Herdr with a 180 s timeout — *before* writing `finished-at`/`state`, so a slow Herdr delays every completion wake by minutes. On the exhaustion path the 5 s group-SIGKILL grace timer is never cleared, so a finalize blocked past ~4 s is killed mid-write and the job stays `running` forever with a dead pid — no wake ever fires. Separately: pi's JSON mode exits 0 even when the run died on a provider error (only text mode maps `stopReason: "error"` to exit 1 — verified in pi 0.84.2 `dist/modes/print-mode.js`), so the wrapper records `done: pi exited 0` for a job that never got a model response; F011 documented exactly this on 2026-08-15. And `stop` plus the wrapper both finalize, double-writing the record's timeline.

## Scope

- **Order.** `finalizeJob` writes `commits`, `finished-at`, `state`, and removes `pid` first; the log append is best-effort and cannot block them; `renameJobTab` runs after the state is durable, fire-and-forget.
- **One writer.** Finalize is idempotent: if `state` is already terminal, it returns without rewriting. `stopCommand`'s belt-and-suspenders finalize and the wrapper's own finalize stop racing each other's timestamps.
- **The grace timer dies with the child.** After the pi child closes and containment has had its bounded window, the exhaustion SIGKILL timer is cleared (or unref'd and guarded) so the wrapper never SIGKILLs itself mid-finalize.
- **Stop reason on the record.** `src/stream.ts` surfaces the final assistant message's `stopReason`; when the last one is `error` or `aborted`, the wrapper writes `.limen/jobs/<id>/stop-reason` (one line, e.g. `error: usage limit reached`) before finalizing. `done` still means pi exited 0 — the semantics F011 fixed in place do not change here; this feature only makes the reason durable. The wake's handoff excerpt and `limen jobs <id>` include the line when present. F011 reads this file for its advisory instead of parsing session JSONL.
- **Unseen steers surface.** At finalize, remaining `steer/inbox` entries are counted into the log (`N steer(s) never delivered`), and the wake's excerpt names the count, so a correction the worker never saw is not silently lost.

## Out of scope

- Reclassifying provider-failed runs as `failed` — that is a semantics change F011 explicitly declined; if it is ever wanted, it is its own decision with its own ticket.
- F011's advisory wording and empty-job detection; this feature only supplies the durable inputs.
- Hosted finalize policy (F020/F021) beyond inheriting the reordered, idempotent `finalizeJob`.
- Retry, resume, or preflight (F026).

## Acceptance

- With a fake Herdr that hangs on `tab rename`, a finishing job's `state` flips within the normal path (no multi-second delay) and the wake fires; the rename happens or fails afterward without touching the record.
- An exhaustion-path job (tool-call cap with a low `LIMEN_MAX_TOOL_CALLS`) finalizes `failed` durably even when the tab rename is artificially slow; the wrapper's self-SIGKILL never precedes the state write.
- `limen stop` on a running job leaves exactly one `finished-at` value and one terminal log line for the state transition.
- A fake-pi stream ending in an assistant message with `stopReason: "error"` yields `stop-reason` on disk, the line in `limen jobs <id>`, and the line in the completion wake; a normal run writes no such file.
- A steer enqueued just before the fake pi exits produces the undelivered count in the log and wake.
- `npm run check` green.

## Notes

Seams: `finalizeJob`, `exhaust`/`graceTimer`, `runInternalJob` in `src/proc.ts`; `interpret`/`assistantText` in `src/stream.ts` (`message_end` carries the full assistant message including `stopReason` — see pi's `docs/json.md` and session format); `renameJobTab` in `src/herdr.ts`; `stopCommand` in `src/commands/stop.ts`; `handoffExcerpt` in `hook/wake.ts`. Evidence for the exit-0 behavior: pi 0.84.2 `dist/modes/print-mode.js` — the `stopReason` check that sets `exitCode = 1` sits inside `if (mode === "text")`. Optional, cheap, in keeping: pi ships `pi auth check` since 0.84.1; F026 owns whether spawn uses it.
