# Contributing

Mechanism stays small. Judgment stays in templates.

## Before a patch

```bash
npm run check
```

That is typecheck, Biome format check, and the real-Git test suite. Each test has a 30s timeout so a leaked watcher fails instead of hanging. CI runs the same command on Linux and macOS.

## What belongs in source

`src/` is capped at 1100 lines (`test/structure.test.ts`). Runtime dependencies must stay empty. Do not add `index.ts`, `types.ts`, `utils.ts`, barrels, enums, or a shared helper bag.

- Capability — start, wait, stop, observe — belongs in `src/`
- Operating advice belongs in `templates/`
- Behavior incidents should normally change templates, not add guards

Only impossible mechanics should error. Everything else informs. Migration is the exception where safety requires a complete read-only preflight: any legacy live job, handshake, type mismatch, or old/new path conflict must fail before the first write.

## Formatter

Biome formats. The linter preset stays `none` except `nursery.noFloatingPromises`. Do not enable a style pack to clean up the tree. `limen init` never overwrites existing project templates and refuses legacy artifacts; use `limen migrate` for Control projects. Copy `templates/` by hand when the shop manual or birth text changes.
