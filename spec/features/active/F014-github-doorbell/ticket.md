# F014-github-doorbell · A PR command reaches its Herdr seat

[2026-08-16] [🔴] [PLANNED] [COORDINATOR] PLANNED · F014-github-doorbell

Depends on F013 (one durable seat per project). GitHub is a doorbell, not a second coordinator or a job runner.

## Outcome

An authorized collaborator comments `/limen review` on a PR. The GitHub App routes that request to the project's persistent Herdr coordinator on its owning seat. The coordinator starts a hosted Limen job; the App replies with the job ID and later the actual outcome. A Mac attached to a VPS is a window, not another consumer of that project's comments.

## Scope

- Ship a reusable, opt-in GitHub integration with Limen. On each seat, set up an App identity installed only on repositories that seat owns. Keep its private key outside project checkouts and unreadable to hosted workers; merely omitting it from prompts is not isolation when poller and worker share a Unix user. One seat may own several projects; another VPS has its own registrations and credentials.
- From a project's checkout in its Herdr coordinator, `limen github connect` detects `origin`, records that project's coordinator target and private registration under its git-ignored `.limen/`, and enables the seat's poller. No hand-written tracked policy, branch list, or per-project env file. `limen github disconnect` stops consumption before moving a project to another seat; the new seat connects it there. `status` shows the binding and last delivery without exposing credentials.
- Start with polling on each seat: no inbound VPS port, central router, or Actions runner. Accept only an exact `/limen review` PR comment from a collaborator with repository write access or higher. Verify the PR and installed repository with GitHub, resolve its actual base and pinned head SHA, and carry repo, PR number, comment ID, actor, SHA, and URL into a structured coordinator request. The PR body, diff, and comment after the command are data, not instructions with higher authority. A ticket pointer is context only when it names a committed ticket in the trusted checkout.
- Persist a recoverable claim keyed by repository and comment ID before handoff; on an ambiguous retry, reconcile it with the seat's job records rather than blindly prompting again. Deliver to the recorded coordinator with Herdr's agent prompt interface, but do not mistake prompt acceptance for a started job. The coordinator, from inside Herdr, starts a hosted Limen review tab against the pinned PR head. If Herdr or the coordinator is unavailable, retain a visible pending/error receipt and notify the PR; never fall back to `limen spawn --detached` or silently review a newer head.
- Post a start reply with job ID and branch, then a terminal reply with state, evidence/checks actually available, and how to inspect the job on its seat. A `done` job is not an approval. A stalled hosted job remains visible rather than being reported as success; the human decides any repair or merge.

## Out of scope

- Automatic claims for new, unlabeled, or unmentioned PRs; labels, arbitrary comment-to-shell commands, issue-to-ticket sync, or documentation-drift commands before their own workflow exists.
- Running the agent on GitHub Actions or on a second checkout on the Mac; copying `.limen/` between seats.
- Automatic push, merge, required checks, or treating worktree isolation as a sandbox for untrusted PR code. Untrusted contributors do not get an auto-approved worker on a credentialed seat.
- A central multi-seat service or a GitHub integration inside the core spawn/job state machine.

## Acceptance

- On a test PR, one authorized `/limen review` produces exactly one hosted Herdr job on the owning seat and a PR reply identifying it; `limen jobs <id>` shows the same record. The review uses the PR's real base and pinned head, not the repository default branch.
- A duplicate delivery, poller restart, unauthorized commenter, non-PR comment, or unassigned repository starts no job. An unrelated PR starts no job.
- With the coordinator unavailable, the request remains inspectable and the PR gets an honest failure/pending notice; no detached job appears. Reconnecting does not spawn twice.
- Two projects on different VPSs route to their respective Herdr coordinators; a Mac clone without a seat registration consumes neither. Disconnecting the old seat before connecting a new one preserves one active owner.
- Final comments distinguish job termination from review approval; a hosted worker cannot read the App key or token, and no credential appears in its task, log, or worktree.

## Notes

The previous F014 draft proposed a detached spawn and label/mention triggers. This 2026-09-24 revision supersedes that design after the owner's Herdr-only and one-command project setup decisions. `docs/remote.md` still describes the old, unbuilt doorbell; update the operator guide when implementing this ticket.
