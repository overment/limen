# F015 · How the harness currently steers agents

Speech is no longer a restacked last message. Since `75490ec` it is appended to the system prompt at the start of each user turn. The installed `limen` binary is this checkout; source and install match.

```
user turn
  hook/communication.ts  before_agent_start
       ├─ custom message  vision + board + styleguide
       │                  + shop manual (coordinator, no AGENTS.md)
       │                  + leftover/overlay advisory
       └─ systemPrompt   speech register + audience cue
            │
            ▼
       agent loop (system prompt stays for the whole turn)
            │
            ├─ tool calls
            └─ between tools: hook/steering.ts may inject limen steer
```

Session start, workers only: `src/commands/spawn.ts` passes `--append-system-prompt` with `templates/worker.md` or `templates/reviewer.md` (project overlay at `.agents/limen/<role>.md` wins). Hosted jobs also load `hook/hosted.ts`.

## Layers

| Layer | Source | Injector | Trigger | Who | In the thread? |
|---|---|---|---|---|---|
| Birth preamble | `templates/worker.md` / `templates/reviewer.md`, or `.agents/limen/<role>.md` | `spawn` `--append-system-prompt` | session start | worker / reviewer | no |
| Project context | `spec/vision.md`, `spec/build.md`, `.agents/limen/styleguide.md` | `hook/communication.ts` `before_agent_start` → custom message `limen-project-context` | each user turn | coordinator and job | yes, hidden |
| Shop manual | `AGENTS.md` or package `templates/agents.md` | same message | each user turn | coordinator only, and only if no project `AGENTS.md` | yes, hidden |
| Guidance drift | leftover vs overlay vs package | same message | each user turn | both | yes, hidden |
| Speech register | `.agents/limen/communication.md` or package `templates/communication.md` | `before_agent_start` → `systemPrompt` append | each user turn, not each LLM call | `human`, or `agent` when `LIMEN_JOB=1` | no |
| Mid-flight steer | `.limen/jobs/<id>/steer/inbox/<seq>` | `limen steer` writes; `hook/steering.ts` delivers `deliverAs: "steer"` | between tool calls, job sessions only | worker | yes |
| Hosted typing | human in the job tab | ordinary pi input | whenever they type | hosted worker | yes |

Missing `communication.md` inherits the package register. A project copy wins. Both are capped at 1000 lines. `LIMEN_CONTEXT_ROOT` is the workspace/repo root so a job worktree still reads the parent's files.

Steer is one-way. `src/commands/steer.ts` refuses a job that is not `running`, waits up to 2s for `steer/ready`, then writes the next `0001`-style inbox file. Delivery is claim-then-rename into `steer/delivered/`; a log line records a 120-character preview. Several steers stay ordered. A worktree whose extension never loaded reports "steering is unavailable" and writes nothing.

## F008 vs the code

F008's ticket and outcome still describe a `context` handler that strips prior `limen-communication` messages and appends a fresh copy last on every LLM call.

`75490ec` (`feat: drop finished job checkouts and hide speech from the thread`) deleted that path. Tests in `test/communication-hook.test.ts` only register `before_agent_start` and assert speech on `systemPrompt`.

What still holds: separate styleguide vs speech files; audience cue; 1000-line bound; inherit-or-overlay.

What does not: restack as the last thread message; "before every LLM call." The board's F008 PROVEN line and the first paragraph of `templates/communication.md` still say that.

Speech still survives a long tool run because the system prompt is present for the whole turn. It is no longer the last word the model sees.

## Install vs this tree

`which limen` → `/home/overment/limen/bin/limen`. The survey compared `/home/overment/limen/hook/communication.ts` to the worktree copy: identical. No leftover `limen-communication.ts` / `limen-steering.ts` hook copies beside the stub.

One overlay: `.agents/limen/worker.md` differs from `templates/worker.md` on how a hosted job should finish (idle-after-work vs quit pi).

A coordinator prompt that *looks* like a `<limen-communication>` message is the system-prompt append, not a restacked thread entry.

## Not done

No hook, template, or board wording was changed. Whether speech should stay in the system prompt (cache-friendly, not last) or return to a restacked last message is a product call, not implied by this map.
