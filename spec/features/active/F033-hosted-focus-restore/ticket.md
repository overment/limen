# F033-hosted-focus-restore · Hosted spawn takes focus briefly and gives it back politely

[2026-08-20] [🟠] [ACTIVE] [COORDINATOR] ACTIVE · F033-hosted-focus-restore

## Outcome

The hosted-spawn focus dance stops stealing attention. Today `startHostedPi` focuses the job tab, blocks inside `agent start` until Herdr detects the agent ready (up to 120 s), then unconditionally refocuses `HERDR_TAB_ID`. Two visible defects: if the human switched tabs during the wait, the restore drags them back anyway; if the restore call fails, the job tab stays focused with no log line. The window length varies per spawn, which is why the steal reads as intermittent.

## Evidence

Herdr 0.8 cannot start an agent in a background pane — the focus dance itself stays. `herdr notification show` has no focus behavior (title/position/sound only), so wakes are exonerated; the spawn path is the only offender. Restore currently sits in a `finally` with a catch whose comment accepts "the new tab staying focused."

## Scope

- Before restoring, read the currently focused tab: restore `HERDR_TAB_ID` only if focus still sits on the job tab; if the human took focus elsewhere during the wait, leave them there.
- Every restore outcome — performed, skipped (user has focus), failed — gets one durable line in the job log.

## Out of scope

- Eliminating the focus window (Herdr 0.8 limitation; revisit when Herdr supports background starts).
- Watch-tab and log-tab creation (already `--no-focus`).

## Acceptance

- Fake-herdr test: focus moved away during start → no restore call, log says skipped.
- Focus untouched → restore happens, log says performed.
- Restore herdr call fails → job tab may keep focus but the log records it.
- `npm run check` green.

## Notes

Small, self-contained in `src/herdr.ts`. Fine to ride along with F032's pass.
