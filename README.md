# limen

`limen` lets one person coordinate several focused [Pi](https://pi.dev) coding sessions without leaving one conversation.

A coordinator starts workers and fresh reviewers as real Pi processes in isolated Git worktrees. Every job leaves ordinary evidence behind: a branch, task, log, state, and Pi session. Limen does not decide what to build or what to merge; tickets, prompts, review, and Git remain the source of judgment.

![A coordinator starts workers and reviewers in isolated worktrees, then merges with ordinary Git](https://raw.githubusercontent.com/overment/limen/main/docs/limen.gif)

> **Experimental.** Commands, prompts, and project files may still change.

Requires macOS or Linux, Node.js 24+, Git, and `pi` on `PATH`. Windows is unsupported.

Jobs can live on an always-on **seat** (a VPS on Tailscale) while your laptop is only a window. See [docs/remote.md](docs/remote.md).

## Trust boundary

`limen spawn` runs `pi --approve` as you. A worktree and process group provide separation, not a security sandbox. A worker can do anything your account can do. Inspect its branch before merging. See [SECURITY.md](SECURITY.md).

## Install

```bash
git clone https://github.com/overment/limen.git
cd limen
npm install
npm link

cd /path/to/your-project
limen init
```

`npm link` (or later `npm install -g @overment/limen`) puts that clone on `PATH`. The binary reads `hook/` and `templates/` next to itself. Projects do not copy those files.

`limen init` plants project-owned empties (vision, board, feature lanes, styleguide) and one stub that loads package hooks. It never overwrites existing project files. `limen init --drop-leftovers` deletes only copies that still match the package.

## Five-minute workflow

### 1. Write and commit a ticket

Create a focused ticket under `spec/features/planned/`, move it to `active/` when work starts, and keep `spec/build.md` aligned. Commit the ticket before spawning so the worker’s worktree can see it.

A useful ticket names:

- the observable outcome;
- scope and exclusions;
- acceptance evidence;
- unresolved product questions.

### 2. Start one implementation slice

```bash
limen spawn --label "F001 auth handler" \
  "Implement F001's session-handler slice. Start with the failing session test, then the smallest repair. One commit. Ticket: spec/features/active/F001-auth/ticket.md"
```

The last output line is the durable job ID:

```text
2026-08-13-f001-auth-handler-3c8d7a2f
```

Use a short instruction plus a `Ticket:` pointer. Do not paste the ticket into the prompt. Name the first artifact—usually a failing test, code seam, or diagnostic note—so investigation does not become the job.

### 3. Stay in the coordinator

```bash
limen jobs                    # bounded snapshot of live work
limen jobs <id|suffix|label>  # one job, recent log, and diffstat
git diff HEAD...<branch>      # inspect the candidate
```

The optional wake extension shows live jobs and sends one completion handoff. Do not run `limen wait` in an interactive coordinator; it blocks the conversation. `wait` is for scripts.

Pulse describes observed activity: `starting`, `think`, `tool`, `wait`, or `dead`. Silence alone is not proof of a stuck worker. Inspect the log and worktree before stopping.

`done` means Pi exited successfully. It does **not** mean the ticket is complete or the branch is safe to merge.

### 4. Review when the risk earns it

```bash
limen spawn --review --branch limen/<job-id> --label "F001 auth review" \
  "Review the F001 candidate against spec/features/active/F001-auth/ticket.md. Name the commit reviewed."
```

A reviewer is a fresh Pi process at the candidate tip. It reports a verdict; it does not rewrite the candidate. Review is especially useful for process control, security, routing, prompts, migrations, and broad behavior changes.

If review finds a defect, resume the same branch with only the proven findings:

```bash
limen spawn --branch limen/<job-id> --label "F001 auth repair" \
  "Repair the rejected auth candidate: preserve the passing session test, fix the listed expiry race, and commit one repair. Ticket: spec/features/active/F001-auth/ticket.md"
```

Review the repair freshly, then merge with ordinary Git. On completion, add `outcome.md`, move the feature folder to `done/YYYY-MM/`, and update `spec/build.md` in the same change.

## Shape jobs for progress

A normal job is one short, coherent slice—not an open-ended request to understand the repository.

Good:

```text
Write the smallest failing test for direct ?topic= entry while auth is loading.
Then add the readiness gate. One commit.
```

Risky:

```text
Confirm the complete lifecycle before editing and solve all related cases.
```

Use an explicit shape when helpful:

- **slice** — one vertical implementation change; one commit;
- **repair** — fix named findings; one commit;
- **survey** — produce a durable design or diagnostic note; no code expected;
- **finish** — validate and commit work already in the worktree;
- **review** — inspect a named candidate and return evidence plus verdict.

If investigation cannot produce the first artifact, write the finding or question to the worktree and exit. Learning should survive the session.

## Stop, resume, and bounds

```bash
limen steer <id|suffix|label> "stay on the session test; do not widen"
limen stop <id|suffix|label> "reason"
limen spawn --branch limen/<job-id> "Focused resume instruction"
```

A running job picks a steer up between tool calls. Delivered steers stay in `.limen/jobs/<id>/steer/delivered/` and are named in the job log. A finished job, or a worker whose extension is missing, is refused and nothing is written.

Stop sends TERM, then escalates if needed. Resume reuses the branch and its existing worktree, including uncommitted files. Inspect that state before resuming. Stop and resume remain the path when the process itself must be replaced.

Finished jobs keep their files under `.limen/jobs/`. Their extra checkouts do not stay: the next `limen spawn` drops finished worktrees, and `limen prune` does the same on demand. Resume with `--branch` keeps that checkout.

Every job is bounded by:

- 90 minutes by default; override with `--timeout 20m`;
- 900 Pi tool-start events; override with `LIMEN_MAX_TOOL_CALLS`.

A bound records `failed` with its reason. It limits damage; it does not repair a vague handoff.

## Models

Set stage defaults in the coordinator environment:

```bash
export LIMEN_WORKER_MODEL="your-worker-model"
export LIMEN_REVIEWER_MODEL="your-reviewer-model"
```

`--model MODEL` overrides the stage default for one job. With no setting, Pi chooses as usual.

## Adjacent-repository workspaces

When a non-Git parent contains several independent Git repositories, initialize one coordinator at the parent:

```bash
cd ~/workspace
limen workspace init
```

Record each child repository’s purpose in the generated `spec/workspace.md`, then select exactly one immediate Git child per job:

```bash
limen spawn --repo api --label "F073 API slice" \
  "Implement F073's API slice. Ticket: spec/features/active/F073-checkout/ticket.md"
```

The ticket stays under the workspace parent. Branches, worktrees, diffs, and review stay inside the selected child repository. Split cross-repository work into separate jobs.

## Project files

The installed `limen` is the default shop manual, role prompts, speech register, and hooks. `limen init` only creates what the project owns:

```text
.agents/limen/styleguide.md           project coding practice
spec/vision.md                        durable product intent
spec/build.md                         TRACK / NOW / NEXT / PROVEN
spec/features/                        planned, active, done, and dropped work
.pi/extensions/limen.ts               stub: load hooks from the package
.limen/jobs/<id>/                     runtime evidence
```

Optional overlays replace a package default for that file only: `AGENTS.md`, `.agents/limen/worker.md`, `.agents/limen/reviewer.md`, `.agents/limen/communication.md`. A file that still matches the package is a leftover copy; the coordinator names it and `limen init --drop-leftovers` deletes only those. Different bytes are an overlay — keep, drop, or edit. Never overwrite an overlay.

The project-context extension attaches vision, board, and styleguide after each user message. Before every LLM call it restacks the speech register (project overlay or package default) and names the audience: human for coordinators, agent for spawned jobs. Updating `limen` updates every project on that machine. `/reload` after a pull. `limen migrate` handles legacy Control layouts; it is not a general updater.

## Visibility and ownership

The conversation that starts a job subscribes to its wake automatically. Another coordinator can subscribe explicitly:

```bash
limen watch <id|suffix|label>
limen watch --running
limen unwatch <id|suffix|label>
```

A visible `unwatched` job is presumed to belong to another coordinator. Do not stop, resume, review, or merge it unless ownership is explicitly transferred and this conversation watches it.

Job files and Git remain canonical if a notification is missed.

## Recovery

| Symptom | Safe next step |
|---|---|
| Quiet or repetitive job | Inspect `limen jobs <id>`, its log, and worktree. Stop only on evidence, then resume with a narrower artifact. |
| Worker has a real question | Read its durable note, answer it, and resume the branch. |
| Wrapper is dead but state says `running` | Verify the recorded PID, correct the plain `state` file, then resume. |
| Candidate is bad | Do not merge. Remove its worktree and branch with ordinary Git. |
| Completion wake was missed | Inspect `.limen/jobs/` and Git. |
| Merge or board is wrong | Repair it with ordinary Git and Markdown edits. |

## Command reference

```text
limen init
limen init --drop-leftovers
limen workspace init
limen migrate
limen spawn "instruction" [--label L] [--model M] [--branch B] [--timeout 20m]
limen spawn --repo R "instruction" [--label L] [--model M]
limen spawn --review --branch B --label L "instruction"
limen jobs [--running|--active|--all|<id|suffix|label>]
limen prune
limen steer <id|suffix|label> "correction"
limen stop <id|suffix|label> [reason]
limen wait <id|suffix|label>
limen watch <id|suffix|label> | --running
limen unwatch <id|suffix|label> | --all
limen open <id|suffix|label>
limen close <FNNN>
```

IDs, unique suffixes, and unique labels are interchangeable where shown.

## Develop

See [CONTRIBUTING.md](CONTRIBUTING.md). CI runs the same checks on Linux and macOS:

```bash
npm run check
```

Limen has zero runtime dependencies. Capability belongs in `src/`; operating judgment belongs in templates and project files.
