# control

A minimal harness for one human working through one coordinator with many coding sessions. It fills only the physical capability gap a model has: start a sibling session, observe it, interrupt its process tree, and receive a best-effort completion wake.

Everything involving judgment—what to build, ticket quality, whether review is sufficient, what should merge, and whether a board is tidy—stays in prompts and plain specifications. The API is the filesystem, Git, and one small CLI. There are no registered model tools, configuration files, gates, receipts, role state, watchdogs, daemons, or runtime dependencies.

Requires macOS or Linux, Node.js 24+, Git, and the [`pi`](https://pi.dev) CLI on `PATH`.

## Install

```bash
cd ~/.overment/control
npm install
npm link                 # exposes `control` on PATH
cd /path/to/project
control init
```

`control init` fills gaps only. It creates missing `AGENTS.md`, worker/reviewer preambles, `spec/` skeleton, optional Pi wake extension, and `.control/jobs/`; existing targets remain byte-for-byte untouched. It appends `/.control/` to `.gitignore` only when no equivalent line exists. If a project already has `AGENTS.md`, merge the shop-manual template manually if desired—the command will not guess.

Project-local Pi extensions load only for a trusted project. `control` invokes spawned sessions with `--approve`; the coordinator should restart or `/reload` after init to load the optional wake extension.

## Commands

```text
control init
control spawn "task text" [--model X] [--branch B] [--timeout 500ms|90s|20m|2h]
control spawn --review --branch B "review task"
control stop <id> [reason]
control jobs
```

### Start implementation

```bash
control spawn "$(cat spec/features/auth/ticket.md)"
# → 2026-08-13-implement-auth-7a2f
```

A new launch creates branch `control/<job-id>` and an external linked worktree next to the primary repository. It writes the job record before detaching a wrapper process. The wrapper invokes ephemeral non-interactive Pi, appends stdout/stderr to `log`, and atomically changes `state` on exit. Multiple independent jobs run concurrently; an informational note never enforces a cap.

### Inspect

```bash
control jobs
ls .control/jobs/*/state
tail -f .control/jobs/<id>/log
git worktree list
git diff HEAD...<branch>
```

`control jobs` is convenience output. It derives elapsed time, silence, process liveness, log tail, and diffstat live; it never stores “stalled” or repairs malformed records.

### Review

```bash
control spawn --review --branch control/<job-id> \
  "Read spec/features/auth/ticket.md; review the complete candidate and name the commit covered."
```

Review uses the exact same process and tools as implementation but starts fresh in a detached worktree at the candidate branch tip with reviewer birth text. It can run tests and is not fenced read-only. No role or reviewer identity is persisted. The coordinator reads the result and live diff, then lands acceptable work with ordinary Git.

### Stop and resume

```bash
control stop <id> "silent after investigation"
control spawn --branch control/<id> "Resume with this clarified requirement: ..."
```

Stop sends TERM to the recorded process group, waits five seconds, then uses KILL only if necessary. Stopping an already-terminal job is harmless. Resume reuses the branch's existing worktree when available, preserving committed and uncommitted work. A branch checked out in the primary tree or already used by a live job cannot be isolated, so spawn reports the mechanical impossibility.

`--timeout` uses the same process-tree mechanics and records `failed`; it does not depend on GNU `timeout`.

## Durable state

```text
.control/jobs/<id>/
  task.md        exact task text
  state          running | done | failed | stopped
  pid            wrapper process-group id while running
  branch         worker branch (candidate branch for review)
  log            append-only combined worker and control output
```

One fact per file. Mutable state and PID writes use same-directory temporary files and atomic rename. Terminal state is written before PID removal. The records are not harness property: inspect or correct them with ordinary tools after a wrapper crash. Worktrees deliberately remain for inspection and resume; clean them with `git worktree remove`, `git worktree prune`, and normal branch deletion.

The optional `.pi/extensions/control-wake.ts` watches terminal state changes during a coordinator session and queues one in-memory-deduplicated follow-up. It registers no commands or tools, stores no acknowledgement, performs no retry, and does not scan old terminal jobs as new events. If watching or delivery fails—or the coordinator is gone—the job state and branch still survive.

## Specs and operating model

- `spec/vision.md`: human-owned why; the coordinator proposes changes rather than inventing intent.
- `spec/build.md`: coordinator-maintained Now / Next / Done narrative.
- `spec/features/<name>/`: plain ticket, notes, questions, and review text. `ls` is the index; no code parses it.

The standing `AGENTS.md` teaches the default loop: write/read a useful ticket → spawn isolated implementation → inspect → spawn a fresh reviewer → read review and diff → merge or resume with findings → update the board. It is a default, not a ritual. The coordinator remains the only session talking directly to the human and has full authority to merge, revert, stop, clean up, and make proportional small edits. Genuine product ambiguity is escalated distinctly from a process failure.

Checks are whatever the project itself defines. Review independence comes from a fresh process. Isolation comes from worktree birth. Git history is the audit trail. Cosmetic spec drift never blocks an action.

## Recovery

| Failure | Native recovery |
|---|---|
| silent or rambling job | inspect `log`, stop the process group, inspect the worktree, resume with a sharper task |
| worker asks a real question | read its committed partial work/question file, answer, resume `--branch` |
| dead wrapper with stale `running` | check PID, edit `state`, inspect branch/worktree, resume |
| junk candidate | do not merge; remove its worktree and branch |
| branch conflict | rebase it or start from fresh HEAD |
| coordinator died or wake was missed | start another coordinator; read `.control/jobs/` and Git |
| bad merge | use `git log`, `reflog`, revert/reset as appropriate |
| stale board | edit the Markdown; nothing latches |

There is deliberately no channel into a running job. Redirect by stop → amend task → resume branch. There is no destructive cleanup command, because Git already expresses cleanup and recovery transparently.

## Architecture and requirement trace

`src/job.ts` is the pure domain core and owns the sole discriminated union. `src/git.ts` and `src/proc.ts` are impure edges; `src/commands/*` only compose them; `src/main.ts` is the only entry point and catch. Source uses erasable TypeScript, direct Node execution, semantic private helpers, checked tables, and no barrels, shared type pool, enums, namespaces, or parameter properties.

The twenty mover requirements map directly:

1–3. The coordinator convention, ambiguity signal, and human-owned vision are taught in `agents.md`.
4–6. Full coordinator Git authority, fresh-process review, and worktree isolation are construction plus prompt.
7–9. The loop, ticket craft, and project-native checks are prose rather than gates.
10–12. Init seeds the three plain spec locations non-destructively; folders and `ls` remain the index.
13–15. Job files, Git, independent concurrent worktrees, stop, and branch resume provide observation and recovery.
16–20. There is no hygiene block, stored identity, per-turn evaluator, policy refusal, or open-ended governance surface. Only impossible mechanics error; everything else informs.

## Develop

```bash
npm run typecheck
npm test
npm run check
```

Tests use `node:test`, fake Pi executables, and real temporary Git repositories. Runtime dependencies are zero. The source budget is checked to keep mechanism small; behavior incidents should normally change templates, not add guards.

## Trust boundary

This is process/worktree isolation, not a hostile-code sandbox. Spawned agents run with the user's permissions. Review code and use a real sandbox when executing untrusted code. PID/process-group behavior targets POSIX systems; Windows is unsupported.
