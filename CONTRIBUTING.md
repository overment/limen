# Contributing

Mechanism stays small. Judgment stays in templates.

## Before a patch

```bash
npm run check
```

That is typecheck, Biome format and lint check, and the real-Git test suite. Each test has a 30s timeout so a leaked watcher fails instead of hanging. CI runs the same command on Linux and macOS.

## What belongs in source

Runtime dependencies must stay empty, and TypeScript basenames stay unique across the tree (`test/structure.test.ts`). Do not add `index.ts`, `types.ts`, `utils.ts`, barrels, enums, or a shared helper bag.

Where code lives:

- `src/main.ts` — CLI entry; `src/commands/` — one file per verb
- `src/job/` — the job record: its model, lookup, rendering, and `record.ts`, which owns state files and finalization
- `src/runtime/` — starting and supervising an engine: launch profiles, stream parsing, the detached runner, the hosted supervisor, process containment, stall detection, reaping, recovery
- `src/project/` — the project around jobs: Git and worktrees, template inheritance, the seat registry
- `src/integrations/` — systems outside files and Git: Herdr, the GitHub doorbell, finish webhooks and their receipts
- `hook/` — only the extensions Pi and OMP load by path (`wake`, `communication`, `steering`, `hosted`). Installed project stubs and job launches name these paths; do not move them

- Capability — start, wait, stop, observe — belongs in `src/`
- Operating advice belongs in `templates/`
- Behavior incidents should normally change templates, not add guards
- Project context belongs in the package communication hook: stable guidance (shop manual, speech register, the `jg` search rule when Jevgrep is installed, vision, styleguide, board digest) rides the system prompt; a short per-turn cue names the audience; tool results recall the rule that applies; inherit package defaults when project files are absent; bound injected text; leftover-copy drift stays an advisory

Only impossible mechanics should error. Everything else informs. Migration is the exception where safety requires a complete read-only preflight: any legacy live job, handshake, type mismatch, or old/new path conflict must fail before the first write.

## Formatter and linter

Biome formats and lints. The linter preset stays `none`: `biome.jsonc` names each rule with its reason, and a new rule lands with its existing sites fixed. Do not enable a preset or a style pack to clean up the tree. The override in `biome.jsonc` holds the files it lists to the target style (120 columns, braces on every body, no nested ternary, cognitive complexity at most 20). After `biome lint --write --unsafe`, run `npm run typecheck`: an unsafe fix can drop a needed `?.`. Regenerate shipped template history with `LIMEN_WRITE_HISTORY=1 node --test test/structure.test.ts`. `limen init` never overwrites existing project files and refuses leftover Control paths (rename or remove them by hand). Change `templates/` and `hook/` in this package; projects inherit them unless they overlay a file.
