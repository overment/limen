# Agent shop manual

This repository uses plain specifications, Git, and `control` to coordinate one human with several coding sessions.

## Durable intent

- `spec/vision.md` explains why the project exists. It is human-owned: propose a change and ask before rewriting it. Keep **Product principles** and **Current direction**.
- `spec/build.md` is the coordinator-maintained TRACK / NOW / NEXT / PROVEN board. Keep it useful, but stale prose never blocks work. Status marks are 🟠 ACTIVE, 🔴 PLANNED, 🟢 PROVEN, ⚪ DROPPED.
- `spec/features/` is a numbered filing cabinet:
  - `planned/FNNN-slug/` — accepted backlog
  - `active/FNNN-slug/` — work currently being pursued
  - `done/YYYY-MM/FNNN-slug/` — landed history, grouped by completion month
  - `dropped/YYYY-MM/FNNN-slug/` — deliberately stopped history, grouped by decision month
  - `_template/` — ticket and terminal-outcome templates
- A feature number is stable for life: allocate the next unused `FNNN`, keep it through every move, and never reuse it. The folder keeps its ticket, notes, questions, and review text. Terminal folders also keep `outcome.md` explaining what landed or why work was dropped.
- These lanes and dates organize human history only. Nothing parses them as workflow state, validates moves, or blocks work. `spec/build.md` is a concise TRACK / NOW / NEXT / PROVEN view, not an authoritative projection.

A useful ticket states the outcome, scope, out-of-scope work, and observable acceptance. Write enough context for one worker to execute without hand-holding. Escalate genuine product ambiguity to the human as a clear question; a blocked worker is not itself a product decision.

## Default loop

Read the board and ticket, then use judgment proportional to the stakes:

1. Choose or create the next numbered ticket under `planned/`, then move its whole folder to `active/` when work begins.
2. Start substantive implementation with `control spawn --label "FNNN short name" "$(cat spec/features/active/FNNN-slug/ticket.md)"`. Stay available to the human.
3. Glance at the footer or run `!control jobs` if you need a snapshot. Pulse is observed, not guessed: `starting` (no pid yet), `think`, `tool`, `wait`, or `dead`. A long model turn can stay on `think`. Never poll with `sleep`. Do not `control wait` in an interactive coordinator — that blocks conversation. Scripts may use `control wait`.
4. When the completion wake arrives, inspect `.control/jobs/<id>/`, its worktree, commits, and `git diff HEAD...<branch>`.
5. Start a fresh reviewer with `control spawn --review --branch <branch> --label "FNNN review" "Review spec/features/active/FNNN-slug/ticket.md and the candidate diff. Name the commit reviewed."`. Same rule: stay free, use the wake.
6. Read the review and diff. Merge acceptable reviewed work with ordinary Git, or resume the branch with focused findings.
7. On completion or abandonment, add `outcome.md`, move the whole folder to `done/YYYY-MM/` or `dropped/YYYY-MM/`, mark the ticket 🟢 PROVEN or ⚪ DROPPED, and update TRACK / NOW / NEXT / PROVEN on the board.

`spawn` prints the durable job ID on its last line. `jobs`, `wait`, and `stop` accept that ID, a unique suffix such as `7a2f`, or a unique label. The optional Pi extension keeps a compact animated footer such as `⠹ ctl 1 · F003 tool:bash`, shows a start notice, and steers one terminal message into a busy coordinator. Pulse words are live observations, not stored workflow state. `control jobs` is the health check: labels, elapsed time, pulse, last tool, tool-call counts, process facts, and the human log. The human can run it as `!control jobs`. Job files remain canonical if any display is missed.

This is craft, not a gate. The coordinator is the human's single point of conversation and has full hands: edit small fixes, write or drop tickets, start or stop jobs, run checks, merge reviewed work, revert mistakes, and clean up worktrees. A typo need not perform a ceremony; substantive work normally earns fresh eyes.

Run the repository's own tests, lint, and build commands. Raw output and the live diff inform review; there is no configured check registry. A reviewer is independent because it is a fresh session, not because identity records say so.

## Recovery

All runtime truth is inspectable under `.control/jobs/` and in Git.

- Silent or rambling job: inspect `control jobs` first. `think`, `tool`, or `wait` with a live process is not a hang. Stop on `dead`, or after you have also checked the worktree. Then `control stop <id> <reason>`, inspect, and resume with `control spawn --branch <branch> --label "readable name" "sharper task"`.
- Genuine ambiguity: the worker commits useful partial work, writes a plain question in its worktree, and exits. Answer it, then resume the branch.
- Dead wrapper: check the recorded PID with `kill -0`, correct the plain `state` file if needed, and resume. The branch and worktree survive.
- Bad candidate: do not merge; remove its worktree and branch with Git.
- Conflict or moved base: rebase, or start again from current HEAD.
- Bad merge: use `git log` and `git reflog` like any other Git recovery.
- Missed completion message or dead coordinator: read `.control/jobs/` next time. Notifications are only a convenience.

No harness rule owns these files. If state is messy, inspect and edit it; hygiene never latches the session.
