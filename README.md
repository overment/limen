# limen

One conversation, several focused [Pi](https://pi.dev) sessions. A coordinator starts workers and reviewers as real Pi processes in isolated Git worktrees. Each job leaves a branch, task, log, state, and session. Limen does not decide what to build or merge; tickets, review, and Git still do.

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

`npm link` puts that clone on `PATH`. The binary reads `hook/` and `templates/` next to itself. Projects do not copy those files. After `git pull` on the clone, `/reload` the coordinator.

`limen init` plants what the project owns (vision, board, feature lanes, styleguide) and a stub that loads package hooks. It never overwrites existing project files. It always deletes leftover `.pi/extensions/limen-*.ts` hook copies so they cannot load beside the stub. `limen init --drop-leftovers` deletes only prompt copies that still match the package.

## Workflow

Write a ticket under `spec/features/planned/`, move it to `active/` when work starts, and keep `spec/build.md` aligned. Commit the ticket before spawning so the worker’s worktree can see it.

```bash
limen spawn --label "F001 auth handler" \
  "Implement F001's session-handler slice. Start with the failing session test, then the smallest repair. One commit. Ticket: spec/features/active/F001-auth/ticket.md"
```

The last output line is the durable job ID. Keep the instruction short and point at the ticket; do not paste the ticket into the prompt. Name the first artifact so investigation does not become the job.

```bash
limen jobs                    # live snapshot
limen jobs <id|suffix|label>  # one job, recent log, and diffstat
git diff HEAD...<branch>      # inspect the candidate
```

`done` means Pi exited 0. It does not mean the ticket is finished or the branch is safe to merge. Do not run `limen wait` in an interactive coordinator; it blocks the conversation.

When the blast radius earns a fresh pair of eyes:

```bash
limen spawn --review --branch limen/<job-id> --label "F001 auth review" \
  "Review the F001 candidate against spec/features/active/F001-auth/ticket.md. Name the commit reviewed."
```

The reviewer reports a verdict; it does not rewrite the candidate. Resume the same branch to repair, then merge with ordinary Git. On completion, add `outcome.md`, move the feature folder to `done/YYYY-MM/`, and update `spec/build.md` in the same change.

## Steer, stop, resume

```bash
limen steer <id|suffix|label> "stay on the session test; do not widen"
limen stop <id|suffix|label> "reason"
limen spawn --branch limen/<job-id> "Focused resume instruction"
```

A running job picks up a steer between tool calls. Stop sends TERM, then escalates. Resume reuses the branch and its worktree, uncommitted files included. Inspect that state first.

Finished jobs keep their files under `.limen/jobs/`. Extra checkouts do not stay: the next `limen spawn` drops finished worktrees, and `limen prune` does the same on demand. Resume with `--branch` keeps that checkout.

A job is bounded by 90 minutes (`--timeout 20m`) and 900 tool-start events (`LIMEN_MAX_TOOL_CALLS`). A bound records `failed`; it does not finish the ticket.

## Models

```bash
export LIMEN_WORKER_MODEL="your-worker-model"
export LIMEN_REVIEWER_MODEL="your-reviewer-model"
```

`--model MODEL` overrides the stage default for one job. With no setting, Pi chooses as usual.

## Adjacent-repository workspaces

A non-Git parent can hold several independent Git children. Initialize the coordinator once at the parent (`limen workspace init`), map the children in `spec/workspace.md`, and pass exactly one `--repo` per job. Tickets stay under the parent; branches, worktrees, diffs, and review stay in the selected child.

```bash
limen spawn --repo api --label "F073 API slice" \
  "Implement F073's API slice. Ticket: spec/features/active/F073-checkout/ticket.md"
```

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

Optional overlays replace a package default for that file only: `AGENTS.md`, `.agents/limen/worker.md`, `.agents/limen/reviewer.md`, `.agents/limen/communication.md`. A file that still matches the package is a leftover copy; the coordinator names it. Different bytes are an overlay — keep, drop, or edit. Never overwrite an overlay.

The project-context extension attaches vision, board, and styleguide after each user message, and restacks the speech register (overlay or package) before every LLM call. Updating the clone updates every project on that machine.

## Recovery

| Symptom | Safe next step |
|---|---|
| Quiet or repetitive job | Inspect `limen jobs <id>`, its log, and worktree. Stop only on evidence, then resume narrower. |
| Worker has a real question | Read its durable note, answer it, and resume the branch. |
| Wrapper is dead but state says `running` | Verify the recorded PID, correct the plain `state` file, then resume. |
| Completion wake was missed | Inspect `.limen/jobs/` and Git. Job files remain canonical if a notification is missed. |

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
