# F016-agent-handoff-map · How agents hand work to each other

[2026-08-18] [🟢] [PROVEN] [COORDINATOR] PROVEN · F016-agent-handoff-map

Status marks are prose: 🔴 PLANNED · 🟠 ACTIVE · 🟢 PROVEN · ⚪ DROPPED. Update the line when the folder moves. Nothing in `limen` parses it.

## Outcome

One notes file that answers, with paths and a real example where one exists, how work moves between coordinator, worker, and reviewer — and where the next agent is under-informed.

## Scope

- Survey only. Deliverable is `notes.md` in this folder. No product code.
- Answer these six questions against the code and the role prompts, not against hoped-for practice:

  1. How the coordinator spawns a worker and how the task reaches that worker.
  2. How much of the task the worker actually receives, and what it must still explore.
  3. How a reviewer is told what to review and what was already reviewed.
  4. How the coordinator is told that a worker or reviewer finished, and what evidence it is handed.
  5. How the coordinator picks a model; what list exists; what reasoning/thinking settings exist.
  6. How the coordinator is told when to continue alone and when to ask the human.

- Use one real job record if it exists (F015 `2026-08-18-f015-steering-map-f4c8ed9c` is on disk) as the spawn/wake example.

## Out of scope

- Changing spawn, prompts, wakes, or model policy.
- F011 / F013 / F014 work.
- Re-mapping F015's speech/system-prompt layers except where a handoff uses them.

## Acceptance

- `notes.md` answers all six questions. Each answer names the file or channel, and states whether the next agent is given the fact or must rediscover it.
- Model question names the exact flags/env vars and states whether a model list or reasoning setting exists in Limen.
- One concrete gap is named, or the notes say the path is complete.

## Notes

Starting seams, not a complete map: `src/commands/spawn.ts` (`task.md`, preamble, `--model`), `templates/worker.md`, `templates/reviewer.md`, `templates/agents.md` (default loop, handoff shape, ask-the-human rule), `hook/wake.ts`, `src/commands/jobs.ts`, F002 outcome. Shape: survey. Write `notes.md` as soon as the six answers exist; do not keep reading.
