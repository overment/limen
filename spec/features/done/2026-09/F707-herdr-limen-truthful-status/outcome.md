# Outcome

Settled Herdr panes now show RUNNING jobs and watched/unwatched counts without hiding active supervisor warnings; `docs/herdr-status.md` explains pane readiness, job completion, review/landing judgment, and the separate wake channels.
Adam authorized the merge of candidate `839db4460868c3f874dbed48e0704d9948f816b6`, landed as `756c74750e4cd3dc6e89c1ea949bdbbe1a682a19`, with no independent reviewer and no changes to the existing dirty jobs/workspace files, verified by hashes.
The candidate passed 20 status/hosted and 50 finish-wake checks plus typecheck, scoped Biome, and synthetic rendered-metadata checks; after merging, typecheck passed and the status lane returned 19/20, with the timed-out coordinator-label check passing its isolated recheck.
The full suite remains incomplete, and real native blocked UI, long silent model turns, and an observed external owner wake remain unproven; candidate evidence is retained under `.limen/jobs/2026-09-08-f707-keep-stall-warnings-repair--1974416a/artifacts/`, with landing checks under `tmp/evidence/F707/landing/`.
The repair job had no automatic-delivery config snapshot or attempt, so the explicitly requested manual `herdr-status done` completion fallback ran once and received HTTP 200; that is acceptance, not proof Tony woke.
Reload coordinators and load the updated hosted hooks in new/reloaded sessions; automatic finish delivery remains per-project opt-in, with no existing jobs retrofitted.
