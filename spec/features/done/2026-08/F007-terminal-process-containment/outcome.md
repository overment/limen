# Outcome

## Result

Limen stop and timeout now snapshot escaped descendants before terminating the wrapper group, then clean them up best-effort without broad process matching.

On macOS, a shipped Ruby/Fiddle helper reads `proc_pidinfo` microsecond birth identity. Limen rechecks that identity before every PID signal, distinguishes confirmed absence from unavailable verification, and writes a durable `cleanup` note whenever ownership or termination cannot be confirmed. Process-table scanning and birth capture share one aggregate one-second pre-TERM deadline; cleanup after the snapshot does not delay terminal state.

`limen jobs <id>` surfaces cleanup notes. Reviewer guidance also treats failed runtime setup as an unverified finding rather than a harness-repair task.

## Date

2026-08-14

## References

- Initial reproduction: `59fa24f test: prove an escaped-group child survives limen stop untraced`
- Initial containment merge: `4e52583 feat: contain escaped job descendants at stop and timeout`
- macOS design: `macos-process-identity.md`
- Final macOS candidate: `12473d1 fix: distinguish process query outcomes`
- Acceptance correction: `226b136 test: accept either escaped cleanup outcome`
- Merge: `4995e1a feat: make terminal cleanup PID-safe on macOS`
- Independent review: `2026-08-14-f007-cleanup-outcome-review-1c648e19` verified behavior and found one obsolete helper; `7e3736e` removed it mechanically.
- Proof: `npm run check` passed with 73/73 tests after integration.
