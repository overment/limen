# Vision

## Product principles

- One human; many focused Pi sessions; one coordinator conversation.
- Durable intent, job state, prompts, and decisions in ordinary files and Git.
- One short job; one isolated worktree; one explicit repository boundary.
- Fresh review before trust; evidence before claims of completion.
- Harness mechanisms inform and preserve judgment; no hidden workflow gate.
- Reversible local operations; small dependency-free implementation; inspectable recovery.
- Notifications reach subscribed coordinators without creating unsolicited ownership.
- Herdr is the visible layout for jobs when it is running; job files and Git remain the source of truth. A closed tab can be reopened. A tab is not the job.
- One seat owns the job cabinet; a laptop is a window. Closing the lid must not kill work.
- The board is the Git branch you checked out. `limen init` writes empty furniture; it is not the cabinet.
- GitHub is a doorbell, not the coordinator. Mention or label may start a job; merge stays human. Auto-claiming every PR is unsolicited ownership.

## Current direction

- Reliable completion: job files beat footer and missed wakes; hosted jobs end when the session ends, not when Herdr says unseen-idle `done`.
- The remote seat exists. Walkthrough: [docs/vps.md](../docs/vps.md). Next: lid-closed `--detached` job, Moshi rings, then live there. Coordinator stays on the laptop until that prove.
- After the seat is boring: an opt-in GitHub doorbell that spawns on that seat and comments back evidence.
