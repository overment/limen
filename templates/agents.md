# Agent shop manual

This repository uses plain specifications, Git, and `control` to coordinate one human with several coding sessions.

## Durable intent

- `spec/vision.md` explains why the project exists. It is human-owned: propose a change and ask before rewriting it.
- `spec/build.md` is the coordinator-maintained Now / Next / Done board. Keep it useful, but stale prose never blocks work.
- `spec/features/` is a numbered filing cabinet:
  - `planned/FNNN-slug/` — accepted backlog
  - `active/FNNN-slug/` — work currently being pursued
  - `done/YYYY-MM/FNNN-slug/` — landed history, grouped by completion month
  - `dropped/YYYY-MM/FNNN-slug/` — deliberately stopped history, grouped by decision month
  - `_template/` — ticket and terminal-outcome templates
- A feature number is stable for life: allocate the next unused `FNNN`, keep it through every move, and never reuse it. The folder keeps its ticket, notes, questions, and review text. Terminal folders also keep `outcome.md` explaining what landed or why work was dropped.
- These lanes and dates organize human history only. Nothing parses them as workflow state, validates moves, or blocks work. `spec/build.md` is a concise Now / Next / Done view, not an authoritative projection.

A useful ticket states the outcome, scope, out-of-scope work, and observable acceptance. Write enough context for one worker to execute without hand-holding. Escalate genuine product ambiguity to the human as a clear question; a blocked worker is not itself a product decision.

## Default loop

Read the board and ticket, then use judgment proportional to the stakes:

1. Choose or create the next numbered ticket under `planned/`, then move its whole folder to `active/` when work begins.
2. Start substantive implementation with `control spawn --label "FNNN short name" "$(cat spec/features/active/FNNN-slug/ticket.md)"`.
3. Use `control wait <id>` when the next action depends on that job. Never poll with repeated `sleep`; the wait is filesystem-driven and returns on any terminal state.
4. Inspect `.control/jobs/<id>/`, its worktree, commits, and `git diff HEAD...<branch>`.
5. Start a fresh reviewer with `control spawn --review --branch <branch> --label "FNNN review" "Review spec/features/active/FNNN-slug/ticket.md and the candidate diff. Name the commit reviewed."`, then wait the same way.
6. Read the review and diff. Merge acceptable reviewed work with ordinary Git, or resume the branch with focused findings.
7. On completion or abandonment, add `outcome.md`, move the whole folder to `done/YYYY-MM/` or `dropped/YYYY-MM/`, and update `spec/build.md`.

`spawn` prints the durable job ID on its last line. Labels are for readable output and notifications; use IDs for `wait` and `stop`. The optional Pi extension shows a start notice and steers one terminal message into a busy coordinator, but job files remain canonical if a notice is missed.

This is craft, not a gate. The coordinator is the human's single point of conversation and has full hands: edit small fixes, write or drop tickets, start or stop jobs, run checks, merge reviewed work, revert mistakes, and clean up worktrees. A typo need not perform a ceremony; substantive work normally earns fresh eyes.

Run the repository's own tests, lint, and build commands. Raw output and the live diff inform review; there is no configured check registry. A reviewer is independent because it is a fresh session, not because identity records say so.

## Recovery

All runtime truth is inspectable under `.control/jobs/` and in Git.

- Silent or rambling job: inspect `control jobs`, the PID, and `tail .control/jobs/<id>/log` before deciding to stop. Pi text mode normally writes its final answer only at exit, so an empty live log alone does not prove a hang. If intervention is warranted, run `control stop <id> <reason>`, inspect the worktree, and resume with `control spawn --branch <branch> --label "readable name" "sharper task"`.
- Genuine ambiguity: the worker commits useful partial work, writes a plain question in its worktree, and exits. Answer it, then resume the branch.
- Dead wrapper: check the recorded PID with `kill -0`, correct the plain `state` file if needed, and resume. The branch and worktree survive.
- Bad candidate: do not merge; remove its worktree and branch with Git.
- Conflict or moved base: rebase, or start again from current HEAD.
- Bad merge: use `git log` and `git reflog` like any other Git recovery.
- Missed completion message or dead coordinator: read `.control/jobs/` next time. Notifications are only a convenience.

No harness rule owns these files. If state is messy, inspect and edit it; hygiene never latches the session.
