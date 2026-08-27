# F049-running-owner-truth · Every running job has a live owner

[2026-08-27] [🔴] [PLANNED] [COORDINATOR] PLANNED · F049-running-owner-truth

The reaper's law (F025) is "dead running jobs reap to failed" — but two loopholes make zombies immortal. A running job with no `pid` is skipped before any liveness check, forever. A hosted job whose supervisor died but whose agent lives counts as live and is left alone — running, unadvised, unfinalizable. F048 closes the front door; this closes the back. Sequenced with F048 before F013.

## Outcome

A record that says `running` is a promise that some live process owns the job to its terminal state. The reaper enforces it: a hosted job that lost its supervisor while its agent lives gets a fresh supervisor; a job with no live owner and no live agent past the startup grace records `failed`. No record is skipped because of its shape.

## Scope

- Split two questions now conflated by `liveJob`: "is any job process alive?" remains useful to branch/prune visibility; the reaper separately asks "is the recorded wrapper/supervisor PID a live owner?" A hosted agent without its supervisor is live work but not ownership, so it must enter adoption.
- Grace is only for a newly planted running record that has no valid PID. A valid recorded PID that is dead enters the existing confirm window immediately, regardless of job age. A pid-less record waits through `STARTUP_GRACE_MS`; absent or malformed `started-at` cannot skip inspection forever and is treated as grace-expired. Any newly live owner clears the pending observation.
- After confirmation, a running job either has a live owner, has a concretely live hosted agent to adopt, has a concretely missing agent and fails, or has an uncertain Herdr probe and waits for a later sweep. `unknown`/Herdr unavailable is not proof of life and is not proof of death; F020's transient-failure safety stands. No record is skipped because its PID or timestamp is absent or malformed.
- Hosted reality comes from `herdr/agent`, falling back to the recorded pane and F048's persisted agent name so `locateHostedAgent` can follow a move. A concrete location found during reap updates the hosted target before adoption.
- Adoption is watch-only: hosted + concrete live agent + dead/absent owner → launch the existing detached supervisor without F048's initial-start marker. The supervisor writes its own normal PID/birth handshake, then runs advisories, result capture, finalization, and tab close as if it had always owned the job.
- One adopter wins through a dedicated filesystem claim that is separate from notification `claims`/`delivered` slots. The winner rechecks state, owner, and agent after claiming. A lost race is silent; a claimant that dies before launch is recoverable from its recorded PID/time, so the claim cannot create a new immortal shape. The claim is released once a new owner is observable or the job becomes terminal, allowing later re-adoption if another supervisor dies.
- Reconstruct the watch contract from durable record truth: job directory/ID, current target, F048's role and agent name (with deterministic fallbacks for pre-F048 records), label, and context root. No caller-only environment is required.
- When no live owner or hosted agent remains, capture any hosted result and finalize `failed`: detached records use `process group gone`; hosted records use `hosted supervisor lost`. Terminal finalization makes the existing wake path eligible.
- Both existing sweeps enforce the law: the coordinator wake sweep and F043 seat LaunchAgent already call the reaper, so adoption works with no coordinator tab open and after a seat process restarts.
- Inspect reality — state, PID identity, pane, agent — never record vintage. Pre-F048 orphans from 2026-08-27 follow the same rule; no migration or legacy branch.

## Out of scope

- Any change to what `done`/`failed`/`stopped` mean, to wake routing, or to fallback delivery.
- Resurrecting hosted agents whose tab is gone (F035's law stands: reopen is a log view, never a resurrection).
- Detached-wrapper internals; F048's start phase.

## Acceptance

- Kill a hosted job's supervisor while its agent works. Without waiting for the job-age grace, one sweep observation plus the confirm window produces one new live supervisor; later idle advisory and session-end finalization work normally.
- Concurrent coordinator and seat sweeps produce exactly one adopter. A synthetic claimant death is recovered on a later sweep, and killing the adopted supervisor permits another adoption rather than being blocked by a permanent marker.
- Kill the supervisor after the agent is concretely gone: the job records `failed: hosted supervisor lost`, captures any final session handoff, and becomes wake-eligible instead of staying `running`.
- A pid-less running record remains protected while genuinely inside startup grace, then is adopted when its hosted agent lives and failed when it does not. Missing/malformed `started-at` is also resolved rather than skipped. Verify this against a copied pre-F048 orphan shape.
- An `unknown` Herdr result neither adopts nor fails; a later concrete live/missing result completes the same pending case.
- Detached owner loss still records `failed: process group gone`. F025 reap coverage and F038 pulse behavior remain unchanged.

## Notes

Root-cause companion to F048; the live evidence lives in that ticket's notes. The gap in numbers: `liveJob` returns true for hosted-with-live-agent regardless of a dead recorded pid — true for "is something running", false as "is someone responsible". This ticket splits those meanings and makes the second one the reaper's business.
