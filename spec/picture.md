# Picture

An authorized PR mention can now reach one warm coordinator on the repository's seat. The GitHub App rings the bell; it does not run a job, approve a review, or merge a PR.

## How it fits

You talk to one coordinator. Its seat owns the checkout, worktrees, and job records; a laptop is a window onto that seat, not a second job cabinet. The vision, board, feature folders, and Git hold intent and decisions. Job records under `.limen/jobs/` hold execution state. Herdr shows the sessions, but a tab is not a job.

```text
PR comment ──► isolated seat poller ──► registered warm Herdr coordinator
                 App key and private          │ one pane can serve several
                 claims stay away from        │ registered repositories
                 hosted workers               ▼
                                      hosted job in its own worktree
                                                 │
                                  actual job state and evidence
                                                 │
                             poller posts start and terminal PR replies

laptop ── attaches to the seat; it does not consume PR commands
```

The App accepts an exact `@limen` or `/limen` mention on an open PR from someone with write access or higher. It supplies bounded PR and comment context as untrusted data, with pinned refs. The coordinator chooses a hosted review, another hosted task, or an explicit no-job answer. A review checks the real base and pinned head; a changed PR needs a new request. If the coordinator is missing, one pending notice remains for safe retry, not a detached fallback. Prompt acceptance does not earn a start reply: the poller observes the hosted job; its terminal reply follows the job's actual state. `done` is not approval. Merge remains human.

Ordinary work still runs as short jobs, each in an isolated worktree. Hosted spawn returns before agent readiness; a background supervisor owns startup and finish. If that supervisor dies, recovery watches a concretely live agent without starting another, fails confirmed ownerless work, and waits on uncertain evidence. Reviews use a fresh verdict; research starts only when you ask, quality reports after a run of landings, and this picture is rewritten only when a handoff names a changed shape.

## Where work stands

The mention front door (F732) and secure seat setup and diagnosis (F733) are proven. On Alice PR #10, an unavailable coordinator first produced one pending notice; after the seat policy repair the same request started one hosted review and produced one start and one terminal reply. Another poll did not duplicate them. The App key and accepted claims stayed with the isolated poller; the worker account had no sudo. Integration tests exercised two project roots sharing a coordinator, not two live seats.

The GitHub doorbell (F014) remains active: second-seat ownership and routing have not been proved live. The seat bell that should notify once per real finish or stall (F731) is also active. Planned quality follow-ups cover hosted OMP liveness when Herdr loses classification (F728), continuation publication against concurrent prune (F729), and engine-accurate job guidance (F730). Exact-route refusal remains parked without a Pi probe that proves the route (F081); the larger background field-guide proposal is parked (F050). Optional speech was removed at the owner's request (F046); the proposed second handoff rule was dropped because the register already has one home (F724).

## Decision waiting on you

A second live seat is the missing proof before the doorbell can close: register a different repository with its own App identity, show its mention reaches its own coordinator, and show a Mac clone consumes neither seat's commands. Until that trial is authorized and observed, keep the doorbell active; do not promote Alice's single-seat proof into a multi-seat guarantee.
