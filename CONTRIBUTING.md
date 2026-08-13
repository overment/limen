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

Only impossible mechanics should error. Everything else informs.

## Formatter

Biome formats; the linter preset is intentionally `none`. Do not enable a rule pack to clean up the tree.
