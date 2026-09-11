# Finish transport inspection seam

Automatic finalization now preserves per-target transport independently of the aggregate sender exit. The selected neutral configuration keys, once-only claim, concurrent fan-out and three-second finalizer budget remain in place. Explicit selections are limited to 64 targets so all validated destinations fit the bounded receipt channel.

- `bin/tony-finish-ping.sh` writes start/result JSON lines on fd 3 only when automatic correlation is present. Stdout/stderr remain discarded; response bodies are never read. Ordinals refer to the private env array order, not receiver names.
- `src/finish-webhook.ts` accepts at most 32 KiB, validates every record and flushes at most two records per ordinal to mode-600 `finish-webhook-targets`. A completed acceptance survives another target's timeout/process kill. Existing `finish-webhook` aggregate and attempt files remain authoritative for retry ambiguity.
- `src/finish-receipt.ts` owns the allowlist, bounded inspection and event identity: `limen-finish-` plus SHA-256 of the job ID. The sender adds `finishEvent` to automatic JSON payloads without changing label/status/branch. Job ID, not label, correlates across seats; a continuation gets a different event.
- `src/commands/jobs.ts` and `src/view.ts` display configuration selection, per-target transport and bot-turn evidence separately in detail. Pending transport becomes unknown, not rejected; aggregate-only historical jobs have unknown per-target transport. Inspection does not open private configuration.
- No receiver verification contract exists here. The CLI always says bot-turn unobserved, including after HTTP acceptance or a forged local completion claim. Externally verified proof does not yet promote a CLI field. No receiver API, polling, retry daemon or receiver product edits were added.

## Evidence and continuation

Retained evidence directory outside the worktree: `/home/overment/limen-evidence/f091-5932f3a5`. Two-target artifacts include safe JSON lines, aggregate, both CLI views and request counts before/after repeat finalization. Synthetic transport intercepts fetch; it opens no sockets. `checks-1.md` records the coordinator's partial landing decision and exact check results; the retained handoff includes all probe failures.

The first operational proof remains **Alice on Mac**, not this VPS. Receiver owners must provide authorized Johnny/Tony destination-to-ordinal mapping privately, then sanitized durable session/history references, completed turn IDs and timestamps, and excerpts explicitly preserving the exact `finishEvent` from one authorized newly spawned Alice job. Retain that job's automatic transport records and an intentionally HTTP-accepted/no-completed-turn control. Missing, inaccessible, incomplete or mismatched receiver history remains unobserved. Neither endpoint URLs nor private env values belong in evidence. The step-by-step proof and exact outstanding evidence are in `docs/finish-webhooks.md`.

The transport portion landed as `2dabae7`; this feature remains open because observed-turn integration and Alice Mac proof are missing. Receiver owners must supply the completed-turn evidence source/contract; no verifier or endpoint may be guessed. The coordinator continues the remaining wave from the landed transport code without claiming this feature complete.
