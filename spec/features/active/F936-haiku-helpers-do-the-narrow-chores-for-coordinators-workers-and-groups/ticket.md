---
touches:
  - limen.runtime.engine
  - limen.sessions.guidance
  - limen.cabinet.records
  - limen.commands
opened: 2026-10-10
needs-adam: Approve the Haiku pilot in pilot.md, and pick whether a group helper uses a team launch slot (recommended) or a separate helper allowance.
needs-adam-on: 2026-10-10
wrong: "--model pi-claude/claude-haiku-5-5 exits 0 but runs Haiku 4.5, because the OMP Claude bridge catalog has no Haiku 5.5 entry."
wrong-on: 2026-10-10
---

# F936 · Haiku helpers do the narrow chores for coordinators, workers and groups

## Outcome

A coordinator, a worker, or a group lead can give a narrow chore with a clear end to Claude Haiku 5.5 on Adam's Claude Max plan. Examples are a repository scout before a spawn, test-failure triage, a review pre-pass, and a digest of a group's findings. The helper returns a short evidence packet. The Opus or Sol lead reads it, decides, and makes the hard change. Each helper job's tokens show next to the lead's, so the pilot can show whether the helper saves enough to keep. Haiku 5.5 was released on 2026-10-07. `study.md` says where it fits and `pilot.md` says how to measure it.

## Scope

- A helper route `pi-claude/claude-haiku-5-5` on OMP that runs the model it names. The seam is the catalog of the local OMP Claude bridge.
- A read-only helper role (scout) with the evidence packet and verification rule from `study.md`. The packet is the job's final message.
- The helper model is a board choice, passed explicitly like every other role.
- `limen jobs <id>` shows the served model and the token usage from the session transcript.
- Group mode: a team scout before workers start, and a cabinet digest for the lead, within the allowance rule Adam picks.

## Out of scope

- Haiku as a lead, team coordinator, worker, reviewer of record, judge, or keeper.
- The `anthropic` API provider (a separate, rate-limited account), and Pi routes.
- Automatic routing or model fallback. The coordinator starts a helper on purpose.
- A change to the upstream bridge. The catalog fix stays in the local OMP port.

## Acceptance

- After the bridge fix, `omp --no-extensions --extension ~/.omp/local/pi-claude-bridge --model pi-claude/claude-haiku-5-5 -p "reply ok"` writes `claude-haiku-5-5` as `message.model` in the Claude Code transcript under `~/.claude/projects/`.
- When a job's served model is different from its requested model, `limen jobs <id>` shows both.
- `limen jobs <id>` shows the job's input, output, cache-read and cache-write tokens.
- A scout job's final message is a packet in the `study.md` format: at most five findings, each with a path, a line or symbol, and the word observed or guessed, and a `Verified:` line.
- A finished scout job has no commits and a clean worktree.
- The pilot results table in `pilot.md` has rows for at least three tasks before Haiku goes into the board's standing models.
