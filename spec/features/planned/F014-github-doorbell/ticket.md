# F014-github-doorbell · Mention starts a job on the seat

[2026-08-16] [🔴] [PLANNED] [COORDINATOR] PLANNED · F014-github-doorbell

Depends on F013 (a real seat). GitHub is ingress, not a second coordinator.

## Outcome

A subscribed mention or an explicit label on a pull request starts one Limen job on the seat. The PR gets a comment with job id, branch, and how to inspect. Merge stays human. Unlabeled, unmentioned PRs stay untouched.

## Scope

- Thin ingress: GitHub App and/or `repository_dispatch` / comment webhook → `limen spawn` on the seat (same disk as F013).
- Map PR context into the handoff: repo, SHA, number, author, comment body. Ticket pointer if the comment names one; otherwise a PR-scoped note in the job task, not a new product board.
- Reply on the PR: job id, branch, terminal state, pointer at `.limen/jobs/<id>/` or a log artifact. Not a merge, not “Limen approved.”
- Opt-in auto-queue only behind a label (e.g. `limen:triage`) or allowlist — default off.
- Actions (if used) only ring the seat. Job records stay on the seat disk, not only in the Actions log.

## Out of scope

- Making hosted/`--tab` the path for CI runners (ephemeral disk). Detached spawn on the persistent seat.
- Auto-merge, required checks, or replacing fresh review.
- Claiming every opened PR.
- Multi-tenant SaaS or a Limen-hosted control plane.
- Implementing the remote seat itself (F013).

## Acceptance

- Mention or labeled comment on a test PR produces a job on the seat and a comment that names the job id and branch.
- The same job is visible to `limen jobs` on that seat.
- A PR with no mention and no triage label produces no job.
- Closing or losing the GitHub delivery does not leave a record stuck at `running` without a durable reason on disk.

## Notes

Unsolicited ownership is the failure mode. If policy is fuzzy, refuse and ask — do not spawn.
