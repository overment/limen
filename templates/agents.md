# Agent shop manual

This repository uses plain specifications, Git, and `limen` to coordinate one human with several coding sessions.

## Durable intent

- `spec/vision.md` explains durable intent. It is human-owned: propose a change and ask before rewriting it. Keep compact, decision-useful bullets under **Product principles** and **Current direction**; the project-context extension supplies it to every role.
- `.agents/limen/styleguide.md` defines concise, durable coding practice. Keep it compact, bullet-led, and within its 1000-line injected limit; it governs how code is written and organized here, never product scope or speech.
- `.agents/limen/communication.md` defines human and agent registers. The project-context extension restacks it before every LLM call and names the audience for that reply.
- `spec/build.md` is the coordinator-maintained TRACK / NOW / NEXT / PROVEN board. Before selecting, starting, resuming, reviewing, merging, proving, or dropping work, reconcile it with the planned and active feature folders. Update it in the same coherent change that changes feature state. Each drift advisory never blocks work. Status marks are 🟠 ACTIVE, 🔴 PLANNED, 🟢 PROVEN, ⚪ DROPPED.
- `spec/features/` is a numbered filing cabinet:
  - `planned/FNNN-slug/` — accepted backlog
  - `active/FNNN-slug/` — work currently being pursued
  - `done/YYYY-MM/FNNN-slug/` — landed history, grouped by completion month
  - `dropped/YYYY-MM/FNNN-slug/` — deliberately stopped history, grouped by decision month
  - `_template/` — ticket and terminal-outcome templates
- A feature number is stable for life: allocate the next unused `FNNN`, keep it through every move, and never reuse it. The folder keeps its ticket, notes, questions, and review text. Terminal folders also keep `outcome.md` explaining what landed or why work was dropped.
- These lanes and dates organize human history only. Nothing parses them as workflow state, validates moves, or blocks work. `spec/build.md` is a concise TRACK / NOW / NEXT / PROVEN view, not an authoritative projection.

A useful ticket states the outcome, scope, out-of-scope work, and observable acceptance. Write enough context for one worker to execute without hand-holding. Escalate genuine product ambiguity to the human as a clear question; a blocked worker is not itself a product decision.

## Adjacent-repository workspace

When this non-Git coordinator directory was initialized with `limen workspace init`, `spec/workspace.md` is the human-owned map of its immediate child repositories. Read it to choose the correct target, then run every job from this parent with `--repo <directory>`. One job owns one Git child: branches, worktrees, review, and diffs stay in that repository. Keep the ticket under this parent’s `spec/`; Limen turns a conventional `Ticket: spec/...` pointer into an absolute path for the worker. Do not invent a repository registry or ask one job to coordinate multiple repositories.

## Jobs and Herdr

Herdr is the visible layout when it is running. Job files under `.limen/jobs/` and Git remain the source of truth. A closed tab can be reopened. A tab is not the job.

**Two spawn modes:**

| Mode | Command | What runs | Tab shows | When to use |
|---|---|---|---|---|
| **Hosted (interactive)** | `limen spawn --tab …` | Interactive `pi` **inside** the job tab | The worker itself — you can type | **Default whenever Herdr is available** (`HERDR_ENV=1`) |
| **Detached** | `limen spawn …` (no `--tab`) | Background `pi` (JSON stream, timeout, tool-call cap, process containment) | Live **log tail** only | Headless/no Herdr, scripts, or when the human asks for detached |

**When this coordinator is inside Herdr, always pass `--tab` on implementation spawns** unless the human asked for detached or Herdr is unavailable. `--tab` requires Herdr; without it the flag refuses cleanly — then spawn detached. Reviews stay detached (`--review` does not combine with `--tab` yet).

**Hosted weaker guarantees** (recorded in the job’s `hosted` file): no 90-minute timeout, no tool-call cap, no F007 process containment. Herdr owns that process tree. Closing the hosted tab ends the worker. After the tab is gone, `limen open <id>` reopens a **log** view only — it does not resurrect the agent; respawn for a new one. `--tab` does not support `--review` yet.

**Other job controls:**

- `limen steer <id|label> "correction"` — deliver one mid-flight correction between tool calls (works for detached workers with the steering extension; hosted tabs you can also type into directly).
- `limen open <id|label>` — focus the job’s Herdr tab, or recreate a log/watch place if it was closed.
- `limen close FNNN` — close leftover tabs for a feature already in `done/` or `dropped/`.
- `limen stop <id|label> [reason]` — stop a running job.
- `limen prune` — drop finished worktrees that no live job still needs.

## Default loop

Reconcile the board against the planned and active feature folders, then read the ticket and use judgment proportional to the stakes:

1. Choose or create the next numbered ticket under `planned/`, then move its whole folder to `active/` when work begins.
2. Start implementation with a short coordinator instruction, then a pointer to the ticket — do not dump the ticket as the whole prompt. **In Herdr, include `--tab`.** Example: `limen spawn --tab --label "FNNN short name" "Implement FNNN: <one-sentence outcome>. Start by writing <first file or slice>. Ticket: spec/features/active/FNNN-slug/ticket.md"`. Verify the `Ticket:` path exists before spawn — a wrong pointer sends the worker hunting. Commit the feature folder before spawn so the worktree can see it. Stay available to the human.
3. Before selecting or restarting work, glance at the footer or run `!limen jobs`. Its bounded default snapshot shows every live record; use `limen jobs --all` or `limen jobs <id>` only when you need historical or per-job detail. Pulse is observed, not guessed: `starting` (no pid yet), `think`, `tool`, `wait`, or `dead`. A long model turn can stay on `think`. Never poll with `sleep`. Do not `limen wait` in an interactive coordinator — that blocks conversation. Scripts may use `limen wait`.
4. When the completion wake arrives, inspect `.limen/jobs/<id>/` (log, session, commits) and `git diff HEAD...<branch>`. `done` means `pi` exited 0 (or a hosted agent ended), not that the ticket is finished. A job that only mapped seams or left uncommitted work still needs a resume.
5. After inspecting the candidate, decide whether it earns a review. Skip an independent reviewer when the complete diff is local and reversible, the coordinator already read it, native checks actually passed, and a mistake would be cheap to undo. Name that judgment in the conversation, then merge with ordinary Git. Spawn a fresh reviewer when the blast radius is process control, security, credentials, notification routing, role-prompt contracts, or any change whose failure is expensive or hard to see. Use a short instruction, not a ticket dump: `limen spawn --review --branch <branch> --label "FNNN review" "Review the FNNN candidate against spec/features/active/FNNN-slug/ticket.md. Name the commit reviewed."`. Stay free; use the wake.
6. Read the review and diff. Merge acceptable reviewed work with ordinary Git. A rejection is iteration input, not a reason to stop or ask permission: classify the findings, choose the smallest coherent correction, resume the branch with focused findings, and send the corrected commit through fresh review only if the repaired change still earns it. Repeat until the accepted ticket is proven or a genuine human decision is required.
7. On completion or abandonment, add `outcome.md`, move the whole folder to `done/YYYY-MM/` or `dropped/YYYY-MM/`, mark the ticket 🟢 PROVEN or ⚪ DROPPED, and update TRACK / NOW / NEXT / PROVEN on the board in that same coherent change. After a feature is terminal, `limen close FNNN` can sweep leftover Herdr tabs.

Every job has a shape, and the handoff names it when it is not an ordinary slice:

- **slice** — one seam-led change; deliverable is one commit.
- **repair** — fix listed findings; deliverable is one commit.
- **survey** — mapping is the job; deliverable is a notes file, no code expected.
- **finish** — work already sits in the worktree; run checks and commit it.
- **review** — fresh verdict with evidence (`spawn --review`).

A good handoff carries the outcome, a verified `Ticket:` path, a starting seam offered as a lead rather than a complete map, the deliverable commit, the boundary this job must not cross, and effort calibration when it matters. Direction belongs to the handoff; depth of investigation belongs to the worker. **In Herdr, the handoff is `spawn --tab` unless detached was requested.**

`spawn` prints the durable job ID on its last line. `jobs`, `wait`, `stop`, `watch`, `unwatch`, and `open` accept that ID, a unique suffix such as `7a2f`, or a unique label. Spawn automatically subscribes this conversation to its job wakes. When the human asks this conversation to follow another job, run `limen watch <id|label>` yourself through the Bash tool; `limen watch --running` subscribes the current running snapshot. Do not make the human type routing commands. Routine model policy may live in the coordinator environment: `LIMEN_WORKER_MODEL` defaults ordinary jobs and `LIMEN_REVIEWER_MODEL` defaults reviews. Use `--model` when a ticket warrants a different choice; it always wins over the stage default. Different models can make review priors more independent, but model cost and capability remain human judgment. The optional Pi extension keeps a compact animated footer for every local live job, marking jobs this conversation does not watch as `unwatched`. `unwatched` means visible, not owned: another coordinator likely spawned it. Do not stop, resume, review, merge, or reassign an unwatched job unless the human asks this conversation to take it — then `limen watch` first. Start notices and completion wakes remain subscription-scoped. Pulse words are live observations, not stored workflow state. `limen jobs` is the bounded health check; `limen jobs --all` and `limen jobs <id>` provide historical and human-log detail. Job files remain canonical if any display is missed.

This is craft, not a gate. The coordinator is the human's single point of conversation and has full hands: edit small fixes, write or drop tickets, start or stop jobs, run checks, merge reviewed work, revert mistakes, and clean up worktrees. Default to making reversible engineering decisions and advancing accepted work without asking for confirmation. Ask the human only when the evidence exposes genuine product ambiguity, conflicting acceptance, a meaningful scope/priority/risk tradeoff, credentials or external authority, or an irreversible action. Reviewer rejection, ordinary defects, test failures, and choosing the next corrective slice are coordinator decisions. A typo need not perform a ceremony. Review is a cost paid for expensive mistakes, not a default tax on every commit.

Run the repository's own tests, lint, and build commands. Raw output and the live diff inform review; there is no configured check registry. A reviewer is independent because it is a fresh session, not because identity records say so.

## Recovery

All runtime truth is inspectable under `.limen/jobs/` and in Git.

- Silent or rambling job: inspect `limen jobs <id>` and the log tail first. Inside Herdr, open the job tab with `limen open <id>` or a sibling pane and `tail -f .limen/jobs/<id>/log` — that is a window, not a command. `think`, `tool`, or `wait` with a live process is not a hang, and silent is not stuck — native builds and test suites run for minutes without output. Redirect a live detached worker that is widening or on the wrong seam with `limen steer <id> "correction"` instead of restarting it. On a hosted (`--tab`) job, type into the tab or steer; closing the tab ends the worker. Stop only on evidence (`dead` pulse, circular reads, a correction that cannot land) with `limen stop <id> <reason>`, and write that evidence into the reason — it becomes durable history. A nearly-done worker is usually a finish resume, not a discard.
- Resuming a branch: `limen spawn --branch <branch>` reuses that branch's existing worktree, uncommitted files included. Inspect that state first and state in the task whether it is the intended base (finish shape) or must be set aside. Add `--tab` again if the resume should be hosted.
- Genuine ambiguity: the worker commits useful partial work, writes a plain question in its worktree, and exits. Answer it, then resume the branch.
- Dead wrapper: check the recorded PID with `kill -0`, correct the plain `state` file if needed, and resume. The branch and worktree survive. Hosted jobs may have no useful containment story — inspect the tab and job log.
- Bad candidate: do not merge; remove its worktree and branch with Git.
- Conflict or moved base: rebase, or start again from current HEAD.
- Bad merge: use `git log` and `git reflog` like any other Git recovery.
- Missed completion message or dead coordinator: read `.limen/jobs/` next time. Notifications are only a convenience.

No harness rule owns these files. If state is messy, inspect and edit it; hygiene never latches the session.
