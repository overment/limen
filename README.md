# limen

`limen` is a small CLI for one person working with several coding sessions at once.

You stay in one coordinator conversation. When something needs a focused implementer or a fresh reviewer, you start a job. That job is a real [`pi`](https://pi.dev) process in its own Git worktree. When it finishes, you still have the branch, the log, and the session — not a hidden transcript.

It does not decide what to build, whether a review is enough, or what should merge. Those stay in prompts, tickets, and ordinary Git.

![How limen works: you talk only to the coordinator; each job is a fresh pi process in its own worktree; review is a fresh process at the candidate tip; merging is ordinary Git](https://raw.githubusercontent.com/overment/limen/main/docs/limen.gif)

> **Experimental.** This project is in an early phase. Expect bugs, rough edges, and changes to commands and prompts.

Requires macOS or Linux, Node.js 24+, Git, and `pi` on `PATH`. Windows is unsupported.

## Trust

`limen spawn` runs `pi --approve` as you. Isolation is a process tree and a worktree, not a sandbox. The worker can do anything you can. Review diffs before you merge. See [SECURITY.md](SECURITY.md).

## Install

```bash
git clone https://github.com/overment/limen.git
cd limen
npm install
npm link
cd /path/to/your-project
limen init
```

`npm install -g @overment/limen` is the same binary once published.

`limen init` only creates files that are missing. Existing `AGENTS.md`, preambles, and specs are left untouched. If the shop manual in this repo has changed, copy it by hand. Restart the coordinator or `/reload` so project-local Pi extensions load.

### Migrate from Control

Run `limen migrate` with no arguments in an initialized legacy project. Do not run `limen init`: it refuses legacy artifacts and directs you to migration so duplicate extensions cannot be created.

Migration performs a complete read-only preflight, refuses active or handshaking legacy jobs and path conflicts, then moves `.control` to `.limen` and `.agents/control` to `.agents/limen`. It preserves the whole agent directory, replaces installed legacy extension pairs with the packaged Limen extensions, narrowly patches an existing `AGENTS.md`, and updates legacy `.control` entries in an existing `.gitignore`. It creates neither missing prompts nor missing extension pairs. Re-running it is safe and prints no-op/kept actions.

Git branches and registered worktrees are intentionally untouched. Historical branches and paths remain valid; resume one with `limen spawn --branch control/<id>`. Newly created jobs use `limen/<id>` and sibling `.<repo>-limen-worktrees`. Historical `[control ...]` log terminal lines remain readable. Restart the coordinator or run `/reload` after migration.

## Roles

These are conventions and birth text, not stored identity. `limen` does not remember who is who.

| Role | Who | What they do |
|---|---|---|
| Coordinator | The session talking to you | Reads the board, writes tickets, starts and stops jobs, inspects diffs, merges or resumes. Full Git authority. |
| Worker | `limen spawn` | Implements one short instruction in an isolated worktree. |
| Reviewer | `limen spawn --review` | Fresh process at the candidate tip. Reads, runs checks, writes a verdict. Does not rewrite the candidate. |

You talk only to the coordinator. Workers and reviewers never join that conversation.

## What `init` puts in the project

### Specs

A filing cabinet. Nothing in `limen` parses or gates these paths.

```text
spec/
  vision.md                 why the project exists (human-owned)
  build.md                  TRACK / NOW / NEXT / PROVEN board
  features/
    _template/              ticket.md and outcome.md
    planned/FNNN-slug/      accepted backlog
    active/FNNN-slug/       work being pursued
    done/YYYY-MM/FNNN-slug/ landed, with outcome.md
    dropped/YYYY-MM/FNNN-slug/
```

Allocate the next `FNNN` and never reuse it. Status marks on the board and ticket (🔴 PLANNED · 🟠 ACTIVE · 🟢 PROVEN · ⚪ DROPPED) are prose. The usual loop is: write a ticket, spawn a short instruction, inspect, review, merge or resume, update the board.

### Prompts

```text
AGENTS.md                              shop manual for the coordinator
.agents/limen/worker.md              birth text for spawn
.agents/limen/reviewer.md            birth text for spawn --review
.agents/limen/communication.md       how every session should write
.pi/extensions/limen-wake.ts         footer, start notice, completion wake
.pi/extensions/limen-communication.ts injects communication.md into the coordinator
```

`worker.md` and `reviewer.md` are appended as the job’s system prompt. `AGENTS.md` loads in the coordinator (and in workers, now that spawn no longer passes `--no-context-files`). `communication.md` is injected only into the coordinator thread; workers skip it. Edit those files to change behavior. `init` will not overwrite them.

## How a job starts

Give the worker a short instruction and a pointer to the ticket. Do not dump the ticket as the prompt.

```bash
limen spawn --label "F001 auth implementation" \
  "Implement F001: users can sign in. Start by writing the session handler. Ticket: spec/features/active/F001-auth/ticket.md"
# started F001 auth implementation
# 2026-08-13-f001-auth-implementation-7a2f
```

The last line is the durable id. `jobs`, `wait`, and `stop` also accept a unique suffix (`7a2f`) or the label.

### Model policy

Set routine stage defaults in the coordinator environment — for example, an `.envrc`:

```bash
export LIMEN_WORKER_MODEL="your-worker-model"
export LIMEN_REVIEWER_MODEL="your-reviewer-model"
```

Ordinary jobs use `LIMEN_WORKER_MODEL`; `spawn --review` uses `LIMEN_REVIEWER_MODEL`. An explicit `--model MODEL` always wins for that job. With neither a stage default nor `--model`, limen leaves model selection to Pi. This is local policy, not a Limen recommendation: a different reviewer model may give genuinely independent priors, while a particular risky ticket may warrant your strongest model.

That spawn creates branch `limen/<id>` and a worktree next to the repo. Commit the feature folder first, or the worktree will not see it. Several jobs may run at once; a note on the second start is not a cap.

```text
limen init
limen spawn "Implement FNNN: <outcome>. Start by writing <slice>. Ticket: spec/features/active/FNNN-slug/ticket.md"
limen spawn --review --branch B --label L "Review the FNNN candidate against spec/features/active/FNNN-slug/ticket.md"
limen jobs
limen stop <id|suffix|label> [reason]
limen wait <id|suffix|label>    # scripts only
```

## While it runs

Stay in the coordinator. The footer and one completion wake are how you hear back. Do not `limen wait` in that session — it blocks conversation. Do not poll with `sleep`.

```bash
limen jobs                      # or !limen jobs inside Pi
tail -f .limen/jobs/<id>/log
git diff HEAD...<branch>
```

`limen jobs` lists running jobs first, then newest `started-at`. Pulse is observed, not stored: `starting`, `think`, `tool`, `wait`, `dead`. The log is tool names plus a path or command, then assistant text. The full transcript is `.limen/jobs/<id>/session/`.

`done` is `pi` exiting 0. Look at the branch before you treat the ticket as finished.

## Review, stop, resume

Review is the same kind of job, in a detached worktree at the candidate tip, with reviewer birth text. It can run tests. Nothing stores a reviewer identity. You merge with ordinary Git.

```bash
limen spawn --review --branch limen/<id> --label "F001 auth review" \
  "Review the F001 candidate against spec/features/active/F001-auth/ticket.md. Name the commit reviewed."

limen stop 7a2f "silent after investigation"
limen spawn --branch limen/<id> --label "F001 auth follow-up" \
  "Resume: the UUID helper is committed; add the registry op next. Do not remap."
```

Stop sends TERM, waits five seconds, then KILL if needed. Stopping a finished job is harmless. Resume reuses that branch’s worktree. A branch checked out in the primary tree, or already used by a live job, cannot be isolated.

`--timeout` uses the same stop and records `failed`.

## What a job leaves behind

```text
.limen/jobs/<id>/
  task.md        instruction text
  label          human-readable name
  state          running | done | failed | stopped
  pid            wrapper process group while running
  branch         worker branch (candidate, for review)
  started-at     ISO, written before launch
  finished-at    ISO, written before terminal state
  tool-calls     count of Pi tool-start events
  last-tool      latest tool name
  activity       think | tool | wait
  log            think/tool/wait, targets, assistant text
  session/       Pi session for this job
```

One fact per file. Mutable writes use a temp file and rename. Terminal `state` is written before `pid` is removed. After a crash, inspect or edit these files yourself. Worktrees stay until you `git worktree remove` and delete the branch.

The optional wake extension shows a footer (`⠹ limen 1 · F003 tool:bash`), one start notice, and one terminal message. If the coordinator is busy, that message is steered. Display is advisory. If you miss it, the job files and branch are still there.

The wake extension activates only in projects that contain `.agents/limen/`, so it may instead live globally at `~/.pi/agent/extensions/limen-wake.ts` and stay inert everywhere else. Keep one copy — global or project — or every wake arrives twice. `/limen off` mutes the conversation surface (footer, start notices, wake messages); `/limen on` resumes and delivers anything missed once; bare `/limen` toggles. Herdr's pane status and notifications are ambient rather than conversational, so they stay live while muted. `LIMEN_WAKE=0 pi` starts a session silent.

When the coordinator runs inside a [Herdr](https://herdr.dev) pane (`HERDR_ENV=1`), the same extension mirrors that footer as a `limen` status token on the pane and relabels the pane's idle state, so a backgrounded tab both names the running jobs and reads as busy, and raises one Herdr notification per terminal state (your Herdr notification settings decide whether it is shown). Set `LIMEN_HERDR=0` to opt out. Jobs are detached processes, not panes: spawn strips `HERDR_*` from the job environment so nothing inside a worker can misreport the coordinator's pane.

The optional communication extension injects `.agents/limen/communication.md` into the coordinator thread. Workers skip it. Edit or delete that file to change or disable it.

## When something goes wrong

| What happened | What to do |
|---|---|
| Quiet or rambling job | `limen jobs`, then the worktree. Stop on `dead`, or after you have looked. Resume with a sharper instruction. |
| Worker asked a real question | Read the file it wrote, answer, resume `--branch`. |
| Wrapper dead, `state` still `running` | `kill -0` the pid, edit `state`, resume. |
| Bad candidate | Do not merge. Remove the worktree and branch. |
| Missed wake or dead coordinator | Read `.limen/jobs/` and Git. |
| Bad merge or stale board | Ordinary `git`, or edit the Markdown. |

There is no channel into a running job. Stop it, change the instruction, resume the branch. There is no cleanup command.

## Develop

See [CONTRIBUTING.md](CONTRIBUTING.md). CI runs `npm run check` on Linux and macOS.

```bash
npm run typecheck
npm test
npm run check
```

Zero runtime dependencies. `src/` stays under 1100 lines. Change templates when behavior is wrong; do not add guards for judgment.
