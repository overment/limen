---
touches:
  - limen.plant
  - limen.commands
opened: 2026-10-06
---

# F929 · Biome enforces readable code and the styleguide says the same

## Outcome

Adam judges the code dense: flag chains, brace-less nested guards, lines up to 180 columns. After this work, `npm run check` fails on the dense patterns that can be fixed today without a mass rewrite. The styleguide states the same rules in words. One command file shows the target style under the stricter rules. One page tells Adam which bigger steps wait on his pick, with numbers: a repo-wide reformat, Biome's recommended preset, and Effect, XState or Zod.

## Scope

- Biome configuration: the formatter and named lint rules, each with its reason next to it.
- The few existing sites that the new rules flag.
- The project styleguide and the contributing guide, where they describe lint and code shape.
- One sample refactor: the keeper command and its flag parser (`src/commands/keeper.ts`), held to the target rules.
- A brief for Adam outside the repository, and the research notes in this folder.

## Out of scope

- A repo-wide reformat or a brace rewrite of `src/`. Adam picks when.
- New runtime packages (Effect, XState, Zod or other). Adam picks.
- The other command parsers, and the nested ternaries and dense conditions that the styleguide scan already specified (F773, specs 18 and 36).
- `templates/styleguide.md`, the blank template for other projects.

## Acceptance

- `npx biome check .` exits 0, and every enabled lint rule in the Biome config has a comment that gives its reason.
- An assignment inside an expression, such as `String((seq += 1))`, fails `npx biome check`.
- In the keeper command file, a brace-less `if`, a nested ternary, or a line wider than 120 columns fails `npx biome check`.
- `limen keeper` rejects an unknown flag, a flag without a value, and a missing route flag with the same messages as before.
- `.agents/limen/styleguide.md` names the rules that Biome enforces and stays under 1,000 lines.
- `~/Downloads/limen-code-quality.html` gives a yes or no for Effect, XState and Zod, and lists the picks that wait on Adam.

## Notes

- `CONTRIBUTING.md` said the lint preset stays `none` and forbade a style pack. This work keeps the preset `none` and names each rule, so it adds no pack. The recommended preset is a pick for Adam.
