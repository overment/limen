# F016 · How agents hand work to each other

Survey of coordinator ↔ worker ↔ reviewer handoffs against the code and role prompts, not hoped-for practice. Real spawn/wake example: job `2026-08-18-f015-steering-map-f4c8ed9c` (F015, hosted). Speech/system-prompt layers are F015; cited here only where a handoff uses them.

```
coordinator  -- limen spawn -->  .limen/jobs/<id>/task.md
                 |                 + worktree + preamble
                 v
              worker | reviewer   (pi @task.md + --append-system-prompt)
                 |
                 |  finalizeJob writes state / finished-at / log
                 v
              hook/wake.ts  -->  subscribed coordinator (toast + user message)
                 |
                 |  wake is a pointer, not the evidence
                 v
              coordinator inspects job files, branch, session
```

Each answer names the channel and whether the next agent is **given** the fact or must **rediscover** it.

---

## 1. How the coordinator spawns a worker and how the task reaches that worker

**Channel:** coordinator judgment in `templates/agents.md` (Default loop step 2) → `limen spawn` in `src/commands/spawn.ts`.

The shop manual tells the coordinator to send a short instruction plus a `Ticket:` pointer, not the ticket dump. Example shape (given to the coordinator, not auto-built):

`limen spawn --label "FNNN short name" "Implement FNNN: <one-sentence outcome>. Start by writing <first file or slice>. Ticket: spec/features/active/FNNN-slug/ticket.md"`

In Herdr (`HERDR_ENV=1`) that spawn is hosted unless `--detached`. Reviews stay detached (`--tab` + `--review` throws).

`spawnCommand` then:

1. Allocates `.limen/jobs/<id>/` and writes `task.md` (the spawn string, trimmed). Workspace spawn prefixes `Repository: <repo>. Work only in this repository.` and rewrites `Ticket: spec/…` to an absolute path (`workspaceTask`).
2. Creates the worktree (`limen/<id>` by default; `--branch` reuses).
3. Subscribes `PI_SESSION_ID` at `notify/subscribers/<session>` and writes `notify/ready`.
4. Resolves the role preamble: `.agents/limen/worker.md` if present, else package `templates/worker.md`.
5. Resolves the model (see Q5).
6. Starts pi with the task file as the first user turn:

| Mode | Launcher | How task.md arrives |
|---|---|---|
| Hosted | `startHosted` in `src/commands/spawn.ts` | `pi … --append-system-prompt <preamble> --extension hosted,steering,communication [--model] @<jobDir>/task.md` |
| Detached | env `LIMEN_TASK_FILE` / `LIMEN_PREAMBLE` / `LIMEN_MODEL` → `src/proc.ts` `runInternalJob` | same `@<taskFile>` + `--append-system-prompt`; extensions are `steering` + `communication` only |

The worker is **given** the spawn instruction as a Pi `@file` include of `task.md`. It is **not given** the ticket body unless the coordinator dumped it.

**F015 example.** `task.md` is exactly:

```
Survey F015: map how the harness currently steers agents. Write notes.md beside the ticket. No code. Start at hook/communication.ts, then spawn preamble and steer. Ticket: spec/features/active/F015-harness-steering-map/ticket.md
```

Session jsonl first user message is that file include. Job was hosted (`hosted` file present). Branch `limen/2026-08-18-f015-steering-map-f4c8ed9c`. Origin session `01a01417-262d-7a46-b351-6646b782ad4a` was auto-subscribed.

---

## 2. How much of the task the worker actually receives, and what it must still explore

**Given at birth**

| Fact | Channel | Given? |
|---|---|---|
| Spawn instruction text | `task.md` via `@file` | yes |
| Role rules | `--append-system-prompt` = `.agents/limen/worker.md` overlay (this repo) or `templates/worker.md` | yes, as preamble |
| Ticket path | only if the coordinator put `Ticket:` in the spawn string | path yes; body no |
| Starting seams | only if named in `task.md` | as leads, not a map |
| Handoff shape (slice / survey / finish / repair) | `templates/worker.md` says unstated means slice; coordinator should name it | only if the spawn text names it |
| Vision, board, styleguide | `hook/communication.ts` custom message `limen-project-context` each user turn | yes, hidden |
| Speech register, audience `agent` | same hook, `systemPrompt` append | yes |
| Workspace boundary | `workspaceTask` prefix | yes, when `--repo` |

This repo's overlay `.agents/limen/worker.md` is what spawn actually attaches (local file wins). It differs from package `templates/worker.md` on hosted finish: overlay says end the turn cleanly (idle-after-work completes the job); package template says quit pi. The worker is given whichever file was attached, not told that it is an overlay.

**Must rediscover**

- Ticket body and acceptance (shop manual forbids dumping it).
- Named seams and anything the ticket points at.
- Current worktree / branch state, existing notes, prior commits. Resume (`--branch`) reuses the checkout including uncommitted files; the worker is not told that unless the coordinator's task says so (`templates/agents.md` Recovery).
- Which checks to run; native suite names are not in the spawn.
- Whether a previous worker already wrote the deliverable.

`templates/worker.md` / overlay: the instruction is the job; the ticket is the source of truth; only commits, written files, and the final message survive. Exploration that is not written down is lost.

---

## 3. How a reviewer is told what to review and what was already reviewed

**Told what to review — same spawn path, `--review`.**

`src/commands/spawn.ts`:

- `--review` requires `--branch <candidate-branch>`; missing or unknown branch throws.
- Worktree plan is `detach` at that ref (fresh checkout, not the worker's dirty tree).
- Role preamble is `.agents/limen/reviewer.md` or `templates/reviewer.md`.
- Hosted/`--tab` is refused (`--tab does not support --review yet`). Review is detached.
- `task.md` is whatever the coordinator typed. Nothing else is copied in.

Shop-manual example (`templates/agents.md` step 5):

`limen spawn --review --branch <branch> --label "FNNN review" "Review the FNNN candidate against spec/features/active/FNNN-slug/ticket.md. Name the commit reviewed."`

`templates/reviewer.md` tells the reviewer to start at the diff, name `git rev-parse HEAD`, run discriminating checks, and return PASS only when no substantive finding remains. The candidate commit is **not** injected by the harness; the reviewer must run `git rev-parse HEAD` in the detached worktree.

**Already reviewed — no harness channel.**

There is no review-history file, no prior-verdict argument, and no automatic attach of `notes.md` / previous review text. If the coordinator does not paste prior findings and the commit-under-review into `task.md`, the reviewer must **rediscover** them from the ticket folder, git, or nothing.

No `--review` job exists on disk next to F015.

---

## 4. How the coordinator is told that a worker or reviewer finished, and what evidence it is handed

**Channels (in order of what actually fires)**

1. `src/proc.ts` `finalizeJob` writes `finished-at`, `state` (`done` | `failed` | `stopped`), a log line `[limen …] <state>: <detail>`, drops `pid`.
2. `hook/wake.ts` `sendCompletion` (subscribed session, or `_fallback` after 2s if no subscriber claimed it): toast `limen: <label> is <state> (<id>)` plus a user message (or `deliverAs: "followUp"` if the coordinator is mid-turn). Herdr notification if a pane is present.
3. Footer / `limen jobs` (`src/commands/jobs.ts`) — hint. `templates/agents.md` step 3: job files are truth; footer can lag.

**Evidence in the wake (given)**

From `hook/wake.ts`: label, state, id, branch, optional `in repository <repo>`, optional fallback sentence. Then a fixed instruction to inspect the job record, branch diff and commits, log/session, and checks, and to merge or resume.

**Not in the wake (must rediscover)**

Worker/reviewer final message, commit SHAs, notes path, check output, whether the ticket is finished, `hosted` vs detached, the `finalizeJob` detail string.

`done` means the process or hosted session was finalized, not that the ticket is done (`templates/agents.md` step 4; `templates/worker.md`).

**F015 example.** `state=done`, `finished-at=2026-08-18T09:01:31.190Z`. Log: `done: hosted idle 90s after tools`. Wake claimed at `notify/delivered/01a01417-262d-7a46-b351-6646b782ad4a/` (same as `origin-session`). `session-ended` is 2026-08-18T09:04:09.442Z — ~2.5 minutes later. The log after the done line still shows `read` / `bash` / `think`. Hosted supervisor (`HOSTED_IDLE_DONE_MS = 90_000` in `src/proc.ts`) finalized on unseen-idle after tools while the session was still working. The coordinator was handed `done` and had to open the job record to learn anything else.

Detached completion is process-exit of the wrapper. Hosted completion is session-ended, vanished agent, or 90s idle after tools — not “the worker said the ticket is finished.”

---

## 5. How the coordinator picks a model; what list exists; what reasoning/thinking settings exist

**Flags and env (exact)**

| Name | Where | Effect |
|---|---|---|
| `limen spawn --model <id>` | `src/commands/spawn.ts` `parseSpawnArgs` | Per-job. Always wins. |
| `LIMEN_WORKER_MODEL` | coordinator environment | Ordinary jobs when `--model` is absent. Trimmed; empty is ignored. |
| `LIMEN_REVIEWER_MODEL` | coordinator environment | `--review` jobs when `--model` is absent. |
| `LIMEN_MODEL` | internal, detached only | Spawn copies the resolved model into the wrapper env; `runInternalJob` passes `--model` to pi. Not a coordinator knob. |
| `LIMEN_PI` | `src/proc.ts` | Detached pi binary; default `pi`. Not a model. |

Resolution (`spawn.ts`): `options.model ?? env[review ? LIMEN_REVIEWER_MODEL : LIMEN_WORKER_MODEL]?.trim() || undefined`. Hosted: `pi --model` only if resolved. Detached: same, via `LIMEN_MODEL`. No resolved value → Pi gets no `--model` (F002 outcome; README Models).

Documented for the coordinator in `templates/agents.md` (paragraph after the default loop) and README. Cost and capability remain human judgment.

**No model list in Limen.** No catalog, picker, or validation of model ids. The string is forwarded to Pi.

**No reasoning / thinking setting in Limen.** There is no `--thinking`, `--reasoning`, or `LIMEN_*REASONING*` flag. `PI_REASONING_LEVEL` appears only on the detached child-env strip list in `src/proc.ts` (inherited coordinator value is deleted, not set). Pi may still emit `thinking_level_change` on its own.

**F015 example.** No `--model` recorded on the job. Session jsonl: `model_change` `xai` / `grok-4.6`, then `thinking_level_change` `high`. Both are Pi defaults, not Limen policy.

---

## 6. How the coordinator is told when to continue alone and when to ask the human

**Channel:** `templates/agents.md` (shop manual). Injected into the coordinator via `hook/communication.ts` only when the project has no `AGENTS.md` (F015). This repo has no project `AGENTS.md`, so the package shop manual is what the coordinator sees. Workers do not get the shop manual.

**Continue alone (given as policy, not a gate)**

- Reversible engineering decisions; advance accepted work without confirmation.
- Reviewer rejection, ordinary defects, test failures, choosing the next corrective slice.
- Skip independent review when the diff is local, reversible, already read, checks passed, and a mistake is cheap — then merge with ordinary Git.
- After a wake: inspect, then merge acceptable reviewed work or resume focused fixes.

**Ask the human**

- Genuine product ambiguity, conflicting acceptance, a meaningful scope / priority / risk tradeoff, credentials or external authority, or an irreversible action.
- Rewriting `spec/vision.md` (propose and ask).
- Taking an `unwatched` job (another coordinator likely owns it) unless the human asks this conversation to take it.

The completion wake restates the same ask-rule in one sentence. It does not classify the finished job.

Workers (`templates/worker.md` / overlay) escalate type-3 product decisions by committing partial work, writing a question file, and exiting. `templates/agents.md`: a blocked worker is not itself a product decision — the coordinator answers and resumes.

Nothing in the harness forces either path. Footer, wake, and `limen jobs` inform; they do not gate.

---

## Concrete gap

The path back to the coordinator is incomplete.

The wake is a pointer (label, state, id, branch). It does not carry the worker's final summary, commit, notes path, or whether the deliverable exists. Hosted jobs can mark `done` on 90s idle after tools while the session is still writing — F015 did exactly that (`done` at 09:01:31, `session-ended` at 09:04:09, more tool lines after the done log). The coordinator is then under-informed twice: the wake says finished, and it does not say what was produced.

A second missing fact on the review leg: prior review findings and the commit-under-review are not a harness artifact. If the coordinator's `task.md` omits them, the reviewer rediscovers or proceeds blind.

Everything else on the forward path (spawn → `task.md` → `@file` + preamble) is complete for whatever the coordinator typed, and incomplete for everything the shop manual tells the coordinator not to type (ticket body, prior reviews, resume context).
