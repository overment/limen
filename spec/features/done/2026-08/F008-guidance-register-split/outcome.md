# Outcome

## Result

Landed. `.agents/limen/styleguide.md` is now project coding practice and ships as a `Shape` / `Prefer` / `Avoid` stub; this repository's copy states Limen's own code law. `.agents/limen/communication.md` is new and holds a human register and an agent register in 48 lines.

`hook/communication.ts` keeps its `before_agent_start` handler for vision, board, and styleguide, and gains a `context` handler that strips any prior `limen-communication` message and appends a fresh copy last on every LLM call. The audience is `agent` when `LIMEN_JOB=1` and `human` otherwise. Workspace jobs resolve both files from `LIMEN_CONTEXT_ROOT`.

`limen init` copies `communication.md` alongside the other agent files, folded into the existing map so `src/` stayed inside its structure-test budget.

Checks: `tsc --noEmit` clean, `biome check` clean, 15/15 across `communication-hook`, `init-command`, and `structure`. The two `stop-command` failures in the full suite are pre-existing timing flakes in process-containment tests and unrelated.

## Date

2026-08-15

## References

- `hook/communication.ts` — `context` hook and audience cue
- `.agents/limen/communication.md`, `templates/communication.md`
- `.agents/limen/styleguide.md`, `templates/styleguide.md`
- `test/communication-hook.test.ts` — restacking, audience, bounding, no-op on missing file
- Supersedes the deleted F001 communication-guidance work, which injected speech once per session for coordinators only
