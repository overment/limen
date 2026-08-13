# control

A minimal harness for one human working through one coordinator with many coding sessions. It fills only the physical capability gap a model has: start a sibling session, wait for or observe it, interrupt its process tree, and receive best-effort start/completion notices.

Everything involving judgment—what to build, ticket quality, whether review is sufficient, what should merge, and whether a board is tidy—stays in prompts and plain specifications. The API is the filesystem, Git, and one small CLI. There are no registered model tools, configuration files, gates, receipts, role state, watchdogs, daemons, or runtime dependencies.

## Trust boundary

`control spawn` launches [`pi`](https://pi.dev) with `--approve` in a sibling worktree as the current user. Isolation is a process tree and a Git worktree, not a sandbox. Workers inherit your permissions, environment, and credentials. Review candidate diffs before merging. Use a real sandbox when executing untrusted code. PID and process-group control target POSIX systems; Windows is unsupported. See [SECURITY.md](SECURITY.md).

## Install

Requires macOS or Linux, Node.js 24+, Git, and the [`pi`](https://pi.dev) CLI on `PATH`.

```bash
git clone https://github.com/overment/control.git
cd control
npm install
npm link                 # exposes `control` on PATH
cd /path/to/your-project
control init
```

From a published release, `npm install -g @overment/control` is the same binary.

`control init` fills gaps only. It creates missing `AGENTS.md`, worker/reviewer preambles, the numbered `spec/` filing skeleton, optional Pi wake extension, and `.control/jobs/`; existing targets remain byte-for-byte untouched. It appends `/.control/` to `.gitignore` only when no equivalent line exists. If a project already has `AGENTS.md`, merge the shop-manual template manually if desired—the command will not guess.

Project-local Pi extensions load only for a trusted project. After init, restart the coordinator or `/reload` so the optional wake extension loads.

## Commands

```text
control init
control spawn "task text" [--label L] [--model X] [--branch B] [--timeout 500ms|90s|20m|2h]
control spawn --review --branch B --label L "review task"
control wait <id|suffix|label>
control stop <id|suffix|label> [reason]
control jobs
```

### Start implementation

```bash
control spawn --label "F001 auth implementation" \
  "$(cat spec/features/active/F001-auth/ticket.md)"
# → started F001 auth implementation
# → 2026-08-13-f001-auth-implementation-7a2f
```

A new launch creates branch `control/<job-id>` and an external linked worktree next to the primary repository. `--label` supplies readable status, notification, and Pi session names; the final output line remains the durable ID for scripts. Without it, the first task line becomes the label. The footer shortens feature labels to `FNNN` and other labels to their first word, then appends a live pulse (`starting`, `think`, `tool`, `wait`, or `dead`) and the latest tool when one exists. The wrapper invokes ephemeral Pi JSON mode, writes a human log plus `last-tool` as events arrive, and atomically changes `state` on exit. Multiple independent jobs run concurrently; an informational note never enforces a cap.

### Watch and inspect

```bash
control jobs                      # health check; or type !control jobs inside Pi
tail -f .control/jobs/<id>/log    # think / tool / wait lines plus assistant text
ls .control/jobs/*/state
git worktree list
git diff HEAD...<branch>
control wait 7a2f                 # scripts only; unique suffix, label, or full id
```

Stay available after `spawn`. The footer and one completion wake are the loop. `control jobs` is the health check: labels, elapsed time, pulse, last tool, liveness, silence, tail, and diffstat. It never stores “stalled” or repairs malformed records. Pulse is derived on read from pid liveness and the last observed activity: `starting`, `think`, `tool`, `wait`, or `dead`. There is no silence timer. A human can run `!control jobs` in interactive Pi.

Do not poll with `sleep`. Do not `control wait` in a coordinator session — that blocks conversation. Scripts may wait: it watches the job directory and keeps a one-second portable fallback check.

Worker logs are a thin human stream. The wrapper writes a start line, then think/wait as the pulse changes, each tool name as it starts, and final assistant text — not the raw JSON event dump.

### Review

```bash
control spawn --review --branch control/<job-id> --label "F001 auth review" \
  "Read spec/features/active/F001-auth/ticket.md; review the candidate and name the commit covered."
```

Review uses the exact same process and tools as implementation but starts fresh in a detached worktree at the candidate branch tip with reviewer birth text. It can run tests and is not fenced read-only. No role or reviewer identity is persisted. The coordinator reads the result and live diff, then lands acceptable work with ordinary Git.

### Stop and resume

```bash
control stop 7a2f "silent after investigation"
control spawn --branch control/<id> --label "F001 auth follow-up" \
  "Resume with this clarified requirement: ..."
```

Stop sends TERM to the recorded process group, waits five seconds, then uses KILL only if necessary. Stopping an already-terminal job is harmless. Resume reuses the branch's existing worktree when available, preserving committed and uncommitted work. A branch checked out in the primary tree or already used by a live job cannot be isolated, so spawn reports the mechanical impossibility.

`--timeout` uses the same process-tree mechanics and records `failed`; it does not depend on GNU `timeout`.

## Durable state

```text
.control/jobs/<id>/
  task.md        exact task text
  label          human-readable job name
  state          running | done | failed | stopped
  pid            wrapper process-group id while running
  branch         worker branch (candidate branch for review)
  started-at     ISO timestamp written before launch
  finished-at    ISO timestamp written before terminal state
  tool-calls     informational count from Pi tool-start events
  last-tool      latest tool name, if any
  activity       latest observed think/tool/wait hint
  log            append-only human worker and control output
```

One fact per file. Mutable state and PID writes use same-directory temporary files and atomic rename. Terminal state is written before PID removal. The records are not harness property: inspect or correct them with ordinary tools after a wrapper crash. Worktrees deliberately remain for inspection and resume; clean them with `git worktree remove`, `git worktree prune`, and normal branch deletion.

The optional `.pi/extensions/control-wake.ts` watches new state changes during a coordinator session. Its footer uses a small Braille spinner and short names for running jobs, for example `⠹ ctl 1 · F003 tool:bash`; animation stops and the footer clears when none remain. Pulse words are observations: `starting` (handshake), `think` (model), `tool` (executing), `wait` (between tools), `dead` (process gone). It also shows one start notice and sends one terminal message. When the coordinator is busy, terminal delivery uses Pi's `steer` queue so it is handled after the active tool call instead of waiting for the whole turn to end. Display and progress data are advisory. The extension stores no acknowledgement, enforces nothing, and performs no retry. If watching or delivery fails—or the coordinator is gone—the job state and branch still survive.

## Specs and operating model

- `spec/vision.md`: human-owned why; Product principles and Current direction. The coordinator proposes changes rather than inventing intent.
- `spec/build.md`: coordinator-maintained TRACK / NOW / NEXT / PROVEN narrative. Status marks 🟠🔴🟢⚪ are prose only.
- `spec/features/planned/FNNN-slug/`: accepted numbered backlog.
- `spec/features/active/FNNN-slug/`: numbered work currently being pursued.
- `spec/features/done/YYYY-MM/FNNN-slug/`: landed history with `outcome.md`.
- `spec/features/dropped/YYYY-MM/FNNN-slug/`: stopped history with `outcome.md`.
- `spec/features/_template/`: ticket and outcome templates.

Feature numbers are allocated in ascending order, stay attached for life, and are never reused. Month partitions keep terminal history bounded. These paths are a filing convention, not a state machine: no code parses, validates, or gates them. Moving a folder and updating the narrative board are ordinary file edits.

The standing `AGENTS.md` teaches the default loop: write/read a useful ticket → spawn isolated implementation → inspect → spawn a fresh reviewer → read review and diff → merge or resume with findings → update the board. It is a default, not a ritual. The coordinator remains the only session talking directly to the human and has full authority to merge, revert, stop, clean up, and make proportional small edits. Genuine product ambiguity is escalated distinctly from a process failure.

Checks are whatever the project itself defines. Review independence comes from a fresh process. Isolation comes from worktree birth. Git history is the audit trail. Cosmetic spec drift never blocks an action.

## Recovery

| Failure | Native recovery |
|---|---|
| silent or rambling job | inspect `control jobs` first; stop on `dead`, or after checking the worktree, then resume |
| worker asks a real question | read its committed partial work/question file, answer, resume `--branch` |
| dead wrapper with stale `running` | check PID, edit `state`, inspect branch/worktree, resume |
| junk candidate | do not merge; remove its worktree and branch |
| branch conflict | rebase it or start from fresh HEAD |
| coordinator died or wake was missed | start another coordinator; read `.control/jobs/` and Git |
| bad merge | use `git log`, `reflog`, revert/reset as appropriate |
| stale board | edit the Markdown; nothing latches |

There is deliberately no channel into a running job. Redirect by stop → amend task → resume branch. There is no destructive cleanup command, because Git already expresses cleanup and recovery transparently.

## Architecture and requirement trace

`src/job.ts` is the pure domain core and owns the sole discriminated union. `src/git.ts` and `src/proc.ts` are impure edges; `src/commands/*` only compose them, including the small filesystem-backed wait; `src/main.ts` is the only entry point and catch. Source uses erasable TypeScript, direct Node execution, semantic private helpers, checked tables, and no barrels, shared type pool, enums, namespaces, or parameter properties.

The twenty mover requirements map directly:

1–3. The coordinator convention, ambiguity signal, and human-owned vision are taught in `agents.md`.
4–6. Full coordinator Git authority, fresh-process review, and worktree isolation are construction plus prompt.
7–9. The loop, ticket craft, and project-native checks are prose rather than gates.
10–12. Init seeds the numbered planned/active/monthly-history filing convention non-destructively; folders and `ls` remain the index.
13–15. Job files, Git, independent concurrent worktrees, stop, and branch resume provide observation and recovery.
16–20. There is no hygiene block, stored identity, per-turn evaluator, policy refusal, or open-ended governance surface. Only impossible mechanics error; everything else informs.

## Develop

See [CONTRIBUTING.md](CONTRIBUTING.md) for the source budget and the capability/judgment line. CI runs `npm run check` on Linux and macOS.

```bash
npm run typecheck
npm test
npm run check
```

Tests use `node:test`, fake Pi executables, and real temporary Git repositories. Runtime dependencies are zero. The source budget is checked to keep mechanism small; behavior incidents should normally change templates, not add guards.
