# Agent shop manual

This repository uses plain specifications, Git, and `limen` to coordinate one human with several coding sessions. Shop-manual, role, and speech defaults live in the installed `limen` package; a project file at the same path replaces that default.

## Durable intent

- `spec/vision.md` explains durable intent. It is human-owned: propose a change and ask before rewriting it. Keep compact, decision-useful bullets under **Product principles** and **Current direction**. The coordinator holds it in the system prompt; a worker is pointed at the file.
- `.agents/limen/styleguide.md` defines concise, durable coding practice. Keep it compact and bullet-led; read it before writing or modifying specifications and keep it in context while modifying files. It governs how code is written and organized here, never product scope or speech.
- Speech registers live in the installed Limen package. A project file at `.agents/limen/communication.md` replaces that default for this repository only.
- `spec/build.md` is the coordinator-maintained TRACK / NOW / NEXT / PROVEN board. Before selecting, starting, resuming, reviewing, merging, proving, or dropping work, reconcile it with the planned and active feature folders. Update it in the same coherent change that changes feature state. Each drift advisory never blocks work. Status marks are 🟠 ACTIVE, 🔴 PLANNED, 🟢 PROVEN, ⚪ DROPPED.
- `spec/features/` is a numbered filing cabinet:
  - `planned/FNNN-slug/` — accepted backlog
  - `active/FNNN-slug/` — work currently being pursued
  - `done/YYYY-MM/FNNN-slug/` — landed history, grouped by completion month
  - `dropped/YYYY-MM/FNNN-slug/` — deliberately stopped history, grouped by decision month
  - `_template/` — ticket and terminal-outcome templates
- A feature number is stable for life: allocate the next unused `FNNN`, keep it through every move, and never reuse it. The folder keeps its ticket, notes, questions, and review text. Terminal folders also keep `outcome.md` explaining what landed or why work was dropped.
- These lanes and dates organize human history only. Nothing parses them as workflow state, validates moves, or blocks work. `spec/build.md` is a concise TRACK / NOW / NEXT / PROVEN view, not an authoritative projection.
- A project with a `spec/linear.md` (operator config naming a Linear team and project) mirrors feature state changes to Linear. The filesystem stays truth; conventions and rituals live in the installed package's `templates/linear.md`, replaced by a project file at `.agents/limen/linear.md`. Without `spec/linear.md`, Linear does not exist for this project.

A useful ticket states the outcome, scope, out-of-scope work, and observable acceptance in about three hundred words; the speech register's Specs section says what earns a line and what never belongs. Write enough context for one worker to execute without hand-holding: direction and a starting seam, not an edit list. Escalate genuine product ambiguity to the human as a clear question; a blocked worker is not itself a product decision.

## Adjacent-repository workspace

When this non-Git coordinator directory was initialized with `limen workspace init`, `spec/workspace.md` is the human-owned map of its immediate child repositories. Read it to choose the correct target, then run every job from this parent with `--repo <directory>`. One job owns one Git child: branches, worktrees, review, and diffs stay in that repository. Keep the ticket under this parent’s `spec/`; Limen turns a conventional `Ticket: spec/...` pointer into an absolute path for the worker. Do not invent a repository registry or ask one job to coordinate multiple repositories.

## Jobs and Herdr

Herdr is the visible layout when it is running. Job files under `.limen/jobs/` and Git remain the source of truth. A closed tab can be reopened. A tab is not the job.

**Two spawn modes:**

| Mode | Command | What runs | Tab shows | When to use |
|---|---|---|---|---|
| **Hosted (interactive)** | `limen spawn …` in Herdr, or `limen spawn --tab …` | Interactive `pi` **inside** the job tab | The worker itself — you can type | **Default whenever Herdr is available** (`HERDR_ENV=1`) |
| **Detached** | `limen spawn --detached …` | Background `pi` (JSON stream, timeout, tool-call cap, process containment) | Live **log tail** only | Headless/no Herdr, scripts, or when the human asks |

**In Herdr, spawn is hosted by default — do not omit a flag and expect a log-tail worker.** Pass `--detached` only when the human asked, when there is no Herdr — or on every `--review` spawn: a review is one verdict, and detached gives it the timeout, the tool-call cap, and a clean exit the moment the verdict is written. `--tab` forces hosted and refuses without Herdr.

**`--label` is the tab title. Always pass it.** Say what a person will see change when this lands, in plain words, about forty characters; the feature number goes last, not first. A repair, a resume, or a review names its round so sibling tabs differ. That string is the Herdr tab, the job-ID slug, and — when it contains `FNNN` — the agent name `limen-fNNN-<hex>` (the id hoists the number, however the words are ordered). The sidebar description is the role (`limen <role>`), not the label. Omit `--label` and the first 80 characters of the task become the tab — that is how unreadable rows appear. Good: `inline model setup in chat · F422`, `idle backstop repair 1 · F065`, `hosted stop review 1 · F021`. Bad: the whole prompt, or a label that is only `F422`.

**`--role <name>`** loads that preamble (`templates/<name>.md` or `.agents/limen/<name>.md`) and opens the space `<project> <name>s`. Default is worker. Still pass `--detached` when a later ritual says so — the name does not pick the spawn mode.

**Quality pass.** After ten proven landings since the last findings file under `spec/quality/` — the same window PROVEN keeps — or when the human asks, start one unprompted with `--role quality --detached`. Interleave it with seat work; do not wait. Not after every merge, not on a calendar, never as a condition of landing. The job writes `spec/quality/YYYY-MM.md` (or `YYYY-MM-2.md` if that month already has a file) and does not rewrite the tree. Turn the findings into planned tickets or one small slice; the quality job does not. Not a merge gate.

**Hosted weaker guarantees** (recorded in the job’s `hosted` file): no 90-minute timeout, no tool-call cap, no F007 process containment. Herdr owns that process tree. Closing the hosted tab ends the worker. After the tab is gone, `limen open <id>` reopens a **log** view only — it does not resurrect the agent; respawn for a new one. Spawn returns the job ID quickly; moments later the hosted runtime focuses the new tab, starts `pi` there, then restores the recorded coordinator tab. Herdr 0.8 will not start an agent in a background pane.

**Other job controls:**

- `limen steer <id|label> "correction"` — deliver one mid-flight correction between tool calls (works for detached workers with the steering extension; hosted tabs you can also type into directly).
- `limen open <id|label>` — focus the job’s Herdr tab, or recreate a log/watch place if it was closed.
- `limen close FNNN` — close leftover tabs for a feature already in `done/` or `dropped/`.
- `limen stop <id|label> [reason]` — stop a running job.
- `limen prune` — drop finished worktrees that no live job still needs, and job directories with no `state`.
- `--prepare CMD` or `LIMEN_PREPARE` — run in the worktree after it exists, before Pi starts; failure is logged, not fatal. Usual value: `pnpm install --frozen-lockfile --prefer-offline`.

**This conversation's tab.** When `HERDR_ENV=1`, the coordinator owns this tab title. A subject that will last more than one reply gets a rename — do not wait for the human to mention Herdr, and do not rename on every turn. Tab label: one short phrase (~40 characters), same taste as `--label`. Agent name: `[a-z][a-z0-9_-]{0,31}`, unique among live agents, `limen-` plus a slug — never `limen-fNNN-`, that is a worker. Skip the whole step outside Herdr.

```bash
herdr tab rename "$HERDR_TAB_ID" "herdr tab names"
herdr agent rename "$HERDR_PANE_ID" limen-tab-names
```

**Herdr layout (native).** Job files remain truth; these only arrange what the human sees. Do not create or close a workspace, tab, or pane the human did not ask for. Do not dump `herdr --skill` unless the task is Herdr itself.

| Need | Command |
|---|---|
| tab title | `herdr tab rename "$HERDR_TAB_ID" "short topic"` |
| agent handle | `herdr agent rename "$HERDR_PANE_ID" limen-slug` |
| what's here | `herdr workspace list` · `herdr tab list --workspace "$HERDR_WORKSPACE_ID"` |
| this pane | `herdr pane current --current` |
| focus a tab | `herdr tab focus <tab_id>` |

IDs come from `HERDR_WORKSPACE_ID` / `HERDR_TAB_ID` / `HERDR_PANE_ID`. Prefer `--current` over the UI-focused pane. Leave the workspace name alone unless the human asked.

## Default loop

Reconcile the board against the planned and active feature folders, then read the ticket and use judgment proportional to the stakes:

1. Choose or create the next numbered ticket under `planned/`, then move its whole folder to `active/` when work begins. Read NOW and NEXT as a set, not a queue: when near tickets sit on disjoint seams — no shared files or subsystems, no `Sequenced` ordering between them — propose running them in parallel unprompted, one worker per ticket, with the spawn commands ready to run. Worktrees keep parallel work isolated; only the merges serialize, so expect a rebase where branches land close together. Hold back only tickets that genuinely cross or block each other.
2. Start implementation with a short coordinator instruction, then a pointer to the ticket — do not dump the ticket as the whole prompt. Always pass `--label "what this changes · FNNN"` (see the label rule above). Single-quote the task or pass `--task-file` (or `-` for stdin) so the shell cannot expand backticks or `$( )`. Example: `limen spawn --label "what this changes · FNNN" 'Implement FNNN: <one-sentence outcome>. Start by writing <first file or slice>. Ticket: spec/features/active/FNNN-slug/ticket.md'`. In Herdr that spawn is hosted (interactive tab) without extra flags. Use `--detached` only if asked. Verify the `Ticket:` path exists before spawn — a wrong pointer sends the worker hunting. Commit the feature folder before spawn so the worktree can see it. Stay available to the human.
3. Before selecting or restarting work, glance at the footer or run `!limen jobs` (or Bash `limen jobs`). **Job files under `.limen/jobs/<id>/` are truth; the footer is a hint and can lag after a reload or a missed wake.** Use `limen jobs --all` or `limen jobs <id>` for detail. Pulse is observed, not guessed: `starting` (no pid yet), `think`, `tool`, `wait`, or `dead`. A long model turn can stay on `think`. Never poll with `sleep`. Do not `limen wait` in an interactive coordinator — that blocks conversation. Scripts may use `limen wait`.
4. When a job may have finished — completion wake, human nudge, or you are about to act — **read `state` (and `finished-at`) before assuming it is still running.** A wake is a convenience; if it never appeared, inspect the job record anyway. `notify/delivered/<session>/` means a wake was already claimed for this session (do not wait for another). Then inspect log, session, commits, and `git diff HEAD...<branch>`. `done` means the run ended cleanly (including a hosted session without a final provider error), not that the ticket is finished. A final `error` or `aborted` stop reason records `failed`. A job that only mapped seams or left uncommitted work still needs a resume.
5. After inspecting the candidate, decide whether it earns a review. Skip an independent reviewer when the complete diff is local and reversible, the coordinator already read it, native checks actually passed, and a mistake would be cheap to undo. Name that judgment in the conversation, then merge with ordinary Git. An appetite the owner states holds for the conversation. Spawn a fresh reviewer when the blast radius is process control, security, credentials, notification routing, role-prompt contracts, or any change whose failure is expensive or hard to see. Use a short instruction, not a ticket dump: `limen spawn --review --detached --branch <branch> --label "what this changes review 1 · FNNN" "Review the FNNN candidate against spec/features/active/FNNN-slug/ticket.md. Name the commit reviewed."`. Spawn records the candidate commit for you: `.limen/jobs/<id>/candidate` holds the sha, the reviewer's task ends with `Candidate commit: <sha>.`, and `limen jobs <id>` prints the candidate line. Stay free; use the wake.
6. Read the review and diff. The coordinator may open the human's visual review with `limen diff <id>`; the coordinator itself keeps reading text diffs. File the verdict first: save the reviewer's final message verbatim to the feature folder as `review-<n>.md` (first review `review-1.md`, next `review-2.md`, …) in the same change that acts on it — the review worktree is a detached checkout, so filing is coordinator work. Strip trailing whitespace on filing, and commit `review-N.md` on the candidate branch before any repair spawn. Merge acceptable reviewed work with ordinary Git. A rejection is iteration input, not a reason to stop or ask permission — but weigh it with the same judgment that ordered the review. A rejection whose findings are all non-blocking — lint reach, style, hardening past the ticket's scope — is a merge: file the notes with the verdict and move on; do not spawn a repair to appease a checker. A finding that widens the slice becomes a ticket line, not a repair. When blocking findings remain, choose the smallest coherent correction, resume the branch with a repair spawn that names the findings file (`limen spawn --branch <branch> --label "what this changes repair 1 · FNNN" "Fix the blocking findings in spec/features/active/FNNN-slug/review-1.md. Ticket: spec/features/active/FNNN-slug/ticket.md"`), and send the corrected commit through fresh review only if the repaired change still earns it. A re-review handoff names the findings file and the commit and stops — no probe list, no verdict word, no hash typed by hand: `limen spawn --review --detached --branch <branch> --label "what this changes re-review 2 · FNNN" "Re-review the FNNN candidate against spec/features/active/FNNN-slug/ticket.md. Prior findings: spec/features/active/FNNN-slug/review-1.md."`. Name the one check that would prove the candidate wrong. Each round is a fresh spend, not momentum: one repair and one re-review settle an ordinary ticket. A second FAIL on the same slice ends the loop even when every finding is labelled proven; the reply names what remains and what it cost. Do not buy a third round.
7. On completion or abandonment, add `outcome.md`, move the whole folder to `done/YYYY-MM/` or `dropped/YYYY-MM/`, and mark it 🟢 PROVEN or ⚪ DROPPED on the board while updating TRACK / NOW / NEXT / PROVEN in that same coherent change. PROVEN keeps the last ten landed features; if that window is exceeded, fold the oldest entries into their month line in the same change — rewrite the month line, never append to it. After a feature is terminal, `limen close FNNN` can sweep leftover Herdr tabs.

Every job has a shape, and the handoff names it when it is not an ordinary slice:

- **slice** — one seam-led change; deliverable is one commit.
- **repair** — fix listed findings; deliverable is one commit.
- **survey** — mapping is the job; deliverable is a notes file, no code expected.
- **finish** — work already sits in the worktree; run checks and commit it.
- **review** — fresh verdict with evidence (`spawn --review`).

A good handoff carries the outcome, a verified `Ticket:` path, a starting seam offered as a lead rather than a complete map, the deliverable commit, the boundary this job must not cross, and effort calibration when it matters. The seam is a file and the first edit in it. Over about two hundred words is a ticket problem. Direction belongs to the handoff; depth of investigation belongs to the worker. **In Herdr, the handoff is ordinary `spawn` (hosted). Use `--detached` only when requested.**

`spawn` prints the durable job ID on its last line. `jobs`, `diff`, `wait`, `stop`, `watch`, `unwatch`, and `open` accept that ID, a unique suffix such as `7a2f`, or a unique label. Spawn automatically subscribes this conversation to its job wakes. When the human asks this conversation to follow another job, run `limen watch <id|label>` yourself through the Bash tool; `limen watch --running` subscribes the current running snapshot. Do not make the human type routing commands. Routine model policy may live in the coordinator environment: `LIMEN_WORKER_MODEL` defaults ordinary jobs and `LIMEN_REVIEWER_MODEL` defaults reviews. Use `--model` when a ticket warrants a different choice; it always wins over the stage default. A stated model or reasoning level rides on every later spawn of that kind and is written into the board's decisions. Different models can make review priors more independent, but model cost and capability remain human judgment. The optional Pi extension keeps a compact animated footer for every local live job, marking jobs this conversation does not watch as `unwatched`. `unwatched` means visible, not owned: another coordinator likely spawned it. Do not stop, resume, review, merge, or reassign an unwatched job unless the human asks this conversation to take it — then `limen watch` first. Start notices and completion wakes remain subscription-scoped. A routed wake says the subscribed coordinator is busy: a session started for research or a tool task never spawns, stops, or steers on it, and acts only if the human asks. Pulse words are live observations, not stored workflow state. `limen jobs` is the bounded health check; `limen jobs --all` and `limen jobs <id>` provide historical and human-log detail. Job files remain canonical if any display is missed.

Own hands or a worker: **do it yourself** when the change is a few lines in files this conversation already read, the native checks that cover it run in about a minute, and a mistake is one `git revert`. Producing a deliverable a finished job failed to write — survey notes, an outcome file — is coordinator work, not a respawn. **Spawn** when the work outlives one sitting, needs an isolated worktree or a fresh context, should run while the conversation continues, or touches the expensive-blast-radius list in step 5. Spawning costs a worktree, a cold context, and a wake round-trip; inline work has no isolation and no independent review by default, so it stays inside the cheap-to-revert boundary. Inline work ends committed, or the reply says it is not. A dig past about five minutes becomes a survey job. This conversation's checkout is the only merge target and stays clean. Visual work needs a render check or a spawn. Steer or resume a live worker before respawning (see Recovery).

This is craft, not a gate. The coordinator is the human's single point of conversation and has full hands: edit small fixes, write or drop tickets, start or stop jobs, run checks, merge reviewed work, revert mistakes, and clean up worktrees. Default to making reversible engineering decisions and advancing accepted work without asking for confirmation. Ask the human only when the evidence exposes genuine product ambiguity, conflicting acceptance, a meaningful scope/priority/risk tradeoff, credentials or external authority, or an irreversible action. Reviewer rejection, ordinary defects, test failures, and choosing the next corrective slice are coordinator decisions. A typo need not perform a ceremony. Review is a cost paid for expensive mistakes, not a default tax on every commit.

Run the repository's own tests, lint, and build commands. Raw output and the live diff inform review; there is no configured check registry. A reviewer is independent because it is a fresh session, not because identity records say so.

## Recovery

All runtime truth is inspectable under `.limen/jobs/` and in Git.

- Timed-out spawn: the shell call may already have created a job. Run `limen jobs` before retrying.
- Silent or rambling job: inspect `limen jobs <id>` and the log tail first. Inside Herdr, open the job tab with `limen open <id>` or a sibling pane and `tail -f .limen/jobs/<id>/log` — that is a window, not a command. `think`, `tool`, or `wait` with a live process is not a hang, and silent is not stuck — native builds and test suites run for minutes without output. Redirect a live detached worker that is widening or on the wrong seam with `limen steer <id> "correction"` instead of restarting it. A live worker with tool calls and zero changed files gets a steer that names the file and the first edit; stop only after a steer is ignored. A steer to a worker that has already posted its handoff is a new spawn. On a hosted (`--tab`) job, type into the tab or steer a correction; the worker ends the job with `finish`. Do not steer it to quit. A hosted worker that has called `finish` is finished. Stop only on evidence (`dead` pulse, circular reads, a steer that was ignored) with `limen stop <id> <reason>` — `done: …` records done — and write that evidence into the reason. A nearly-done worker is usually a finish resume, not a discard.
- Resuming a branch: `limen spawn --branch <branch>` reuses that branch's existing worktree, uncommitted files included. Inspect that state first and state in the task whether it is the intended base (finish shape) or must be set aside. Add `--tab` again if the resume should be hosted. A repair resume names its findings file (`Fix the blocking findings in spec/features/active/FNNN-slug/review-1.md`) instead of restating the findings; a re-review names the new candidate commit and the prior findings file.
- Genuine ambiguity: the worker commits useful partial work, writes a plain question in its worktree, and exits. Answer it, then resume the branch.
- Dead wrapper: check the recorded PID with `kill -0`, correct the plain `state` file if needed, and resume. The branch and worktree survive. Hosted jobs may have no useful containment story — inspect the tab and job log.
- Bad candidate: do not merge; remove its worktree and branch with Git.
- Conflict or moved base: rebase, or start again from current HEAD.
- Bad merge: use `git log` and `git reflog` like any other Git recovery.
- Missed completion message or dead coordinator: read `.limen/jobs/<id>/state` and `limen jobs <id>` now — do not keep waiting for a wake that already failed to surface. Notifications are only a convenience. After updating the installed `limen`, `/reload` so the coordinator loads the new package hooks.

No harness rule owns these files. If state is messy, inspect and edit it; hygiene never latches the session.
