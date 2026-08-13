# Agent shop manual

This repository uses plain specifications, Git, and `control` to coordinate one human with several coding sessions.

## Durable intent

- `spec/vision.md` explains why the project exists. It is human-owned: propose a change and ask before rewriting it.
- `spec/build.md` is the coordinator-maintained Now / Next / Done board. Keep it useful, but stale prose never blocks work.
- `spec/features/<name>/` is a filing cabinet. A feature folder may contain a ticket, implementation notes, questions, and review text. Nothing parses these folders as workflow state.

A useful ticket states the outcome, scope, out-of-scope work, and observable acceptance. Write enough context for one worker to execute without hand-holding. Escalate genuine product ambiguity to the human as a clear question; a blocked worker is not itself a product decision.

## Default loop

Read the board and ticket, then use judgment proportional to the stakes:

1. Start substantive implementation with `control spawn "$(cat spec/features/<name>/ticket.md)"`.
2. Inspect `.control/jobs/<id>/`, its worktree, commits, and `git diff HEAD...<branch>`.
3. Start a fresh reviewer with `control spawn --review --branch <branch> "Review <ticket> and the candidate diff. Name the commit reviewed."`.
4. Read the review and diff. Merge acceptable reviewed work with ordinary Git, or resume the branch with focused findings.
5. Update the board and feature notes.

This is craft, not a gate. The coordinator is the human's single point of conversation and has full hands: edit small fixes, write or drop tickets, start or stop jobs, run checks, merge reviewed work, revert mistakes, and clean up worktrees. A typo need not perform a ceremony; substantive work normally earns fresh eyes.

Run the repository's own tests, lint, and build commands. Raw output and the live diff inform review; there is no configured check registry. A reviewer is independent because it is a fresh session, not because identity records say so.

## Recovery

All runtime truth is inspectable under `.control/jobs/` and in Git.

- Silent or rambling job: `tail .control/jobs/<id>/log`, then `control stop <id> <reason>`; inspect the worktree and resume with `control spawn --branch <branch> "sharper task"`.
- Genuine ambiguity: the worker commits useful partial work, writes a plain question in its worktree, and exits. Answer it, then resume the branch.
- Dead wrapper: check the recorded PID with `kill -0`, correct the plain `state` file if needed, and resume. The branch and worktree survive.
- Bad candidate: do not merge; remove its worktree and branch with Git.
- Conflict or moved base: rebase, or start again from current HEAD.
- Bad merge: use `git log` and `git reflog` like any other Git recovery.
- Missed completion message or dead coordinator: read `.control/jobs/` next time. Notifications are only a convenience.

No harness rule owns these files. If state is messy, inspect and edit it; hygiene never latches the session.
