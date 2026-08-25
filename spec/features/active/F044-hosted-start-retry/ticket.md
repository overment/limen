# F044-hosted-start-retry · One retry before a hosted start failure is final

[2026-08-25] [🟠] [ACTIVE] [COORDINATOR] ACTIVE · F044-hosted-start-retry

## Outcome

A transient herdr pane failure no longer costs a job and a coordinator round-trip. Hosted start retries once, then fails honestly.

## Scope

- `startHostedPi` (`src/herdr.ts`): when `agent start` fails with the transient pane-shell error (observed: `agent target pane … is not an available shell`), re-run `waitForShell` on the pane and retry `agent start` once. Log both attempts to the job log.
- A second failure keeps today's path exactly: `locateHostedAgent` recovery probe, then `finalizeJob` `failed` with the herdr message.
- Match the error narrowly — an auth error, a missing binary, or a dead tab must not retry.

## Out of scope

- Retrying tab or workspace creation.
- Detached spawns, herdr version pinning, and any change to the recovered-agent fallback.

## Acceptance

- Fake-herdr scripted to fail `agent start` once with the pane-shell error, then succeed: the spawn ends `running`; the log names both attempts.
- Scripted to fail twice: the job finalizes `failed` with the herdr message, as today.
- A non-transient `agent start` error does not retry.
- `npm run check` green.

## Notes

Found in the 2026-08-25 wake investigation. Two occurrences: 2026-08-24 (alice workspace, pane `w18:p5G`) and 2026-08-25 (mega-live, pane `w1M:pF`) — both immediately recoverable by a manual respawn one minute later. The Aug 24 hit predates the herdr 0.8.2 install (2026-08-25 08:51), so treat it as a settle race between the fresh tab's shell and `agent start`, not a version bug.

Small and independent; before F039 is tidier since it touches the hosted-start seam a split reviewer would otherwise re-read.
