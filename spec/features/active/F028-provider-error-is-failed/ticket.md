# F028-provider-error-is-failed · A run whose last turn errored records failed, as pi itself would

[2026-08-19] [🟠] [ACTIVE] [COORDINATOR] ACTIVE · F028-provider-error-is-failed

**Decision ticket.** This reverses one line of F011's out-of-scope ("Changing what `done`, `failed`, and `stopped` mean"). Do not activate without explicit human sign-off; if declined, move to `dropped/` with the reasoning in `outcome.md`.

## Outcome

A job whose final assistant message ended in `stopReason: "error"` or `"aborted"` records `failed: <reason>`, not `done: pi exited 0`. The coordinator's triage starts from the truth — resume or re-spawn — instead of from a reassuring label that F011's advisory then has to argue with.

## The decision, honestly stated

F011 held that `done` means "pi exited 0" and chose advisory over reclassification. New evidence changes the frame: pi's *own* text mode maps a final `stopReason` of `error`/`aborted` to exit code 1 (verified in pi 0.84.2 `dist/modes/print-mode.js`); only the JSON mode limen uses skips that check. So "pi exited 0" on an errored run is an artifact of the output mode, not pi's judgment of the run. Recording `failed` is not limen re-judging the work — it is aligning with the exit semantics pi already applies everywhere a human would see them. The counterargument, also real: an errored *last* turn can still sit on top of committed, useful work, and `failed` may read as "discard" to a hasty coordinator. The wake carrying commits (F017) is the mitigation — `failed` plus visible commits reads as "interrupted", which is the truth.

## Scope

- After F024 lands (`stop-reason` capture for both detached and hosted), the wrapper and hosted supervisor finalize `failed: <stop-reason line>` instead of `done` when the captured reason is `error` or `aborted` — and only then; a clean exit stays `done`.
- `docs`/`README` sentence updated: `done` means the run ended cleanly; provider-errored runs record `failed` with the reason.
- F011's ticket gets one clarifying line: its empty-job advisory now targets clean-but-empty runs; errored runs are `failed` by this feature.

## Out of scope

- Retry, resume, or any automatic reaction to the new `failed`.
- Any change for runs that errored mid-way but recovered and finished cleanly — only the final message's reason counts.
- Hosted sessions the human closed mid-work (no errored final message) — those remain `done: hosted session ended` with F011's advisory.

## Acceptance

- A fake-pi run ending in `stopReason: "error"` with exit 0 finalizes `failed: error: <message>`; the wake and `limen jobs` show it; commits made before the error still appear in the handoff.
- A clean run is byte-identical in behavior to today.
- A hosted session whose last assistant message errored finalizes `failed` at session end with the same reason.
- Documentation reflects the sharpened meaning. `npm run check` green.

## Notes

Depends on F024. Evidence: F011's own observed case (`2026-08-15-f009-steer-channel-6fa9c051`, usage limit reached, reported `DONE`); pi 0.84.2 print-mode source for the text-mode exit-1 behavior. If this is signed off, do it *after* F011's advisory exists anyway — empty-but-clean runs (model answered, did nothing) are untouched by this ticket and still need F011's voice.
