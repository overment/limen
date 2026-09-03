# F057 notes

## Seams

- `hook/communication.ts` — `message_end` keeps the last assistant `error`/`aborted` text; the next `before_agent_start` cue is one line.
- `templates/communication.md` — Human clock-stopped bullet: first line after a failed turn says it failed and what is being redone.
- `src/supervisor.ts` — `noteHostedIdle` reads the last hosted assistant; `error` past the idle window writes `advisory` beginning `errored:` and stamps via `reportHostedStall`. Cleared when status is `working`.
- `hook/wake.ts` — an `errored:` advisory toast/wake says the last turn failed, not idle.

## Decisions

- Cue covers `error` and `aborted`. Hosted advisory is `error` / `error: …` only, not `aborted`.
- One errored hosted turn does not record the job `failed`.

## Checks

- `test/communication-hook.test.ts`, `test/hosted-spawn.test.ts`, `test/wake-hook.test.ts`, `test/structure.test.ts`, `test/inherit.test.ts`, `test/stream.test.ts` passed.
- `tsc` / `biome` / `npm run check` not run: this worktree has no `node_modules`.
