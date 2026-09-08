# F707 · Herdr and Limen show the same job truth

## Outcome

Adam, Tony, and shepherds can tell at a glance whether work is still running,
waiting, merge-ready, or finished — without mistaking a Herdr coordinator pane
`done`/`idle` for a Limen job that is still `RUNNING` (including long silent
`think · unwatched` hosted turns). Finish wakes reach Tony automatically when a
project opts in, instead of depending on an agent remembering to ping.

## Scope

- Start from Limen's Herdr integration, job listing/activity signals, and the
  F702 finish-webhook path (Bearer helper + automatic finalization peer still in
  flight): make pane/tab status, job lines, and wakes agree on one truth.
- Per-project configurable automatic finish wakes that extend F702 — not a
  worker-memory fallback. Keep credentials out of job logs and argv.
- Plain-English operator docs: how to read Herdr panes vs `limen jobs`, what
  `done`/`idle`/`working` mean, what unwatched think means, and when a finish
  ping should fire.

## Out of scope

- Alice product UI or Alice app merges (tiny client display note only if
  unavoidable; primary work stays in this Limen repo).
- Closing or hijacking `w98:t1` or unrelated Alice coordinators.
- Reviving the idle `limen-finish-webhooks` zombie as the owner of this work.

## Acceptance

- A hosted job that is still `RUNNING` with silent think/unwatched does not
  present as "everything finished" on the owning coordinator pane labels or in
  the operator reading guide.
- Operators can distinguish: job RUNNING vs coordinator pane settled; unwatched
  think; merge-ready candidate vs waiting on review/human; finish wake delivered
  vs not configured.
- Finish wakes are automatic for opted-in projects (extends F702); a configured
  job reaching terminal state pings without relying on the worker prompt.
- Docs in Limen explain Herdr vs Limen status in plain English for Adam.
- Focused checks cover the status/wake seams touched; Adam owns review (no
  independent review lane unless asked).

## Notes

Live pain 2026-09-08: coordinator panes flip `done`/`idle` while Limen jobs stay
`RUNNING` (`think · unwatched`, hosted weaker guarantees); tip/shepherd assume
finished; finish-ping sometimes works (F702 helper woke Tony) but many jobs end
without a wake. F702: helper `DONE`, auto-delivery still dirty/RUNNING; coord
`limen-finish-webhooks` `w98:t14` done/idle awaiting review. Prefer this new
coord `limen-f707-herdr-status` over reviving that zombie. Related planned:
`F049-running-owner-truth` (reaper ownership) — adjacent, not a substitute.
Models: coordinators `openai-codex/gpt-6-astra:xhigh`; workers/reviewers same
family per board (`LIMEN_WORKER_MODEL` / `LIMEN_REVIEWER_MODEL`).
