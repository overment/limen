# RUNNING job labels and operator guide for Adam's review

Candidate `839db4460868c3f874dbed48e0704d9948f816b6` on `limen/2026-09-08-f707-running-jobs-stay-visible-a15a7b12` makes settled coordinator panes show total RUNNING jobs and watched/unwatched counts. Hosted panes keep RUNNING visible without changing native lifecycle. The guide at `docs/herdr-status.md` distinguishes pane readiness, job completion, review/landing judgment, coordinator delivery, and automatic finish-webhook receipts.

The coordinator reproduced a warning-erasure bug in the first candidate. The correction defers ordinary hosted reports while a supervisor advisory exists and restores normal labels after recovery. It includes the already-landed automatic finish-delivery implementation; no second sender or project opt-in was added.

Retained evidence at the exact correction commit: 20/20 selected status/hosted tests, 50/50 helper/lifecycle tests, typecheck, scoped Biome, and rendered-metadata regression passed. The coordinator inspected the correction diff, raw check logs, and recorded Herdr frames. Synthetic idle/blocked/errored warnings survived refresh; recovery and shutdown changed the metadata as required. The clean worktree contains two implementation commits above main's findings record.

Evidence: `.limen/jobs/2026-09-08-f707-keep-stall-warnings-repair--1974416a/artifacts/HANDOFF.md`, with commands, outputs, scripts, and raw JSON beside it.

The old full-suite run remains incomplete: 113 observed passes, six unclassified failures, and a fifteen-minute timeout; it was not repeated. Real native blocked UI, long silent model turns, and external owner-wake observation remain unproven. This repair job was not opted into external finish delivery; no manual duplicate was sent.

Nothing from this candidate is merged. Adam owns review; no independent reviewer was started. Adoption after an accepted merge requires reloading coordinators and loading updated hooks in hosted sessions.
