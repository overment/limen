---
touches:
  - limen.plant
  - limen.commands
  - limen.picture.viewer
opened: 2026-10-06
---

# F929 · Biome enforces readable code and the styleguide says the same

## Outcome

Adam judges the code dense: flag chains, brace-less nested guards, lines up to 180 columns, functions nobody can hold at once. On 2026-10-06 he picked all four steps from the code-quality brief. After this work, `npm run check` holds the whole tree to lines of at most 120 columns, braces on every control-flow body, a cognitive-complexity limit per function, and Biome's recommended rules, and the commands parse their flags with Node's `parseArgs` instead of hand-written loops. The styleguide states the same rules in words. Runtime dependencies stay empty.

## Scope

- Biome configuration: the formatter width, the recommended preset, and named rules, each with its reason next to it.
- One mechanical reformat and brace pass over the code that ships and the tests.
- Function splits where the complexity limit needs them, starting at the worst command functions.
- Command flag parsing with `node:util` `parseArgs`, after the pattern in the keeper command (`src/commands/keeper.ts`).
- The project styleguide and the contributing guide, where they describe lint and code shape; the notes and the brief in this folder.

## Out of scope

- New runtime packages: Effect, XState, Zod or other. Adam said no.
- Changes in what a command accepts, rejects or prints.
- The nested ternaries and dense conditions that the styleguide scan already specified (F773, specs 18 and 36).
- `templates/styleguide.md`, the blank template for other projects.

## Acceptance

- `biome.jsonc` sets `lineWidth` 120 and `style/useBlockStatements` for the whole tree, and `npx biome check .` exits 0.
- A function over the complexity limit in `biome.jsonc` fails `npx biome check`; each function exempt from the limit carries a suppression comment with its reason.
- `biome.jsonc` enables the recommended rules; every rule it turns off has a comment with its reason.
- `limen spawn`, `limen continue` and `limen group start` parse flags with `parseArgs`, and reject an unknown flag or a flag without a value with the same message as before.
- `package.json` lists no runtime dependency.
- `.agents/limen/styleguide.md` names the rules that Biome enforces and stays under 1,000 lines.

## Notes

- The keeper command was the first sample of the target style; its override in `biome.jsonc` stays stricter than the tree until the tree catches up.
- `~/Downloads/limen-code-quality.html` is the brief Adam picked from.
