# limen

You talk to one [Pi](https://pi.dev) coordinator. It starts workers and reviewers as real Pi processes in isolated Git worktrees. Each job leaves a branch, task, log, state, and session. You decide what to build and what to merge. The coordinator runs the harness.

![A coordinator starts workers and reviewers in isolated worktrees, then merges with ordinary Git](https://raw.githubusercontent.com/overment/limen/main/docs/limen.gif)

> **Experimental.** Commands, prompts, and project files may still change.

Requires macOS or Linux, Node.js 24+, Git, and `pi` on `PATH`. Windows is unsupported.

Jobs can live on an always-on **seat** (a VPS on Tailscale) while your laptop is only a window. See [docs/remote.md](docs/remote.md). The walkthrough we actually ran is [docs/vps.md](docs/vps.md).

## Trust boundary

A spawned job runs `pi --approve` as you. A worktree and process group provide separation, not a security sandbox. A worker can do anything your account can do. Look at the branch before you merge. See [SECURITY.md](SECURITY.md).

## Install

This part is yours. Once:

```bash
git clone https://github.com/overment/limen.git
cd limen
npm install
npm link
```

`npm link` puts that clone on `PATH`. The binary reads `hook/` and `templates/` next to itself. Projects do not copy those files. After `git pull` on the clone, `/reload` the coordinator.

Then in each project:

```bash
cd /path/to/your-project
limen init
pi
```

`limen init` plants what the project owns (vision, board, feature lanes, styleguide) and a stub that loads package hooks. It never overwrites existing project files. It always deletes leftover `.pi/extensions/limen-*.ts` hook copies so they cannot load beside the stub. `limen init --drop-leftovers` deletes only prompt copies that still match the package.

`pi` in that directory is the coordinator. From here you talk. You do not drive the job CLI.

## How you work

Tell the coordinator the outcome you want. It writes or moves the ticket, keeps `spec/build.md` aligned, commits the ticket so the worker can see it, and starts a job. Stay in that conversation. A wake arrives when a job finishes. Ask only when something looks wrong, or when the coordinator asks you — product ambiguity, a real tradeoff, credentials, or a merge.

A useful ask names the outcome and the first artifact, not a tour of the repo. The coordinator turns that into a short spawn plus a `Ticket:` pointer. It does not paste the ticket into the prompt.

`done` on a job means that Pi exited 0. It does not mean the ticket is finished or the branch is safe to merge. The coordinator inspects the record, the diff, and the checks, then either merges, resumes a repair, or asks you.

When the blast radius earns a second pair of eyes, the coordinator starts a fresh reviewer against the candidate. The reviewer reports a verdict; it does not rewrite the branch. You still merge.

## What the coordinator runs

These commands are the harness. The coordinator types them. They are here so you can recognize a job ID, a wake, or a recovery step — not as a daily script.

```bash
limen spawn --label "F001 auth handler" \
  "Implement F001's session-handler slice. Start with the failing session test. One commit. Ticket: spec/features/active/F001-auth/ticket.md"

limen jobs
limen jobs <id|suffix|label>
git diff HEAD...<branch>

limen spawn --review --branch limen/<job-id> --label "F001 auth review" \
  "Review the F001 candidate against spec/features/active/F001-auth/ticket.md. Name the commit reviewed."

limen steer <id> "stay on the session test; do not widen"
limen stop <id> "reason"
limen spawn --branch limen/<job-id> "Focused resume instruction"
```

The last line of `spawn` is the durable job ID. A running job picks up a steer between tool calls. Stop sends TERM, then escalates. Resume reuses the branch and its worktree, uncommitted files included. The coordinator inspects that state first.

Finished jobs keep their files under `.limen/jobs/`. Extra checkouts do not stay: the next spawn drops finished worktrees, and `limen prune` does the same on demand. Resume with `--branch` keeps that checkout.

A job is bounded by 90 minutes (`--timeout 20m`) and 900 tool-start events (`LIMEN_MAX_TOOL_CALLS`). A bound records `failed`; it does not finish the ticket. Do not run `limen wait` in the coordinator conversation — it blocks you.

## Models

Set these in the environment that starts the coordinator:

```bash
export LIMEN_WORKER_MODEL="your-worker-model"
export LIMEN_REVIEWER_MODEL="your-reviewer-model"
```

`--model MODEL` on one spawn overrides the stage default. With no setting, Pi chooses as usual.

## Adjacent-repository workspaces

A non-Git parent can hold several independent Git children. You initialize once at the parent (`limen workspace init`) and map the children in `spec/workspace.md`. After that, tell the coordinator which repo the work belongs in. It passes exactly one `--repo` per job. Tickets stay under the parent; branches, worktrees, diffs, and review stay in the selected child.

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

The coordinator does this. You only need it if you are looking at a stuck tab yourself.

| Symptom | Safe next step |
|---|---|
| Quiet or repetitive job | `limen jobs <id>`, the log, and the worktree. Stop only on evidence, then resume narrower. |
| Worker has a real question | Read its durable note, answer it, resume the branch. |
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
