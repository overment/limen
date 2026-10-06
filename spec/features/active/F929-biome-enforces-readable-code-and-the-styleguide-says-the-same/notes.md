# Notes · Biome measurements at `19b0175`

Biome 2.5.8 from the lockfile. Paths: `src`, `hook`, `bin`, `test`, `picture`. Each probe replaced `linter.rules` in a scratch copy and ran `biome lint --reporter=json --max-diagnostics=none`.

## Rule hits today

| Rule | src, hook, bin, picture | test | Files |
| --- | ---: | ---: | ---: |
| `style/useBlockStatements` | 1,639 | 60 | 94 |
| `style/noTernary` | 908 | 22 | 78 |
| `complexity/noExcessiveCognitiveComplexity` (max 15) | 129 | 0 | 55 |
| `style/noNestedTernary` | 43 | 0 | 15 |
| `complexity/noExcessiveLinesPerFunction` (max 50) | 35 | 3 | 26 |
| `complexity/useMaxParams` (max 4) | 32 | 0 | 21 |
| `style/noNonNullAssertion` | 65 | 0 | 9 |
| `suspicious/noAssignInExpressions` | 8 | 0 | 4 |
| `complexity/useOptionalChain` | 8 | 0 | 7 |
| `style/useCollapsedIf` | 1 | 0 | 1 |
| `style/noUselessElse`, `style/useCollapsedElseIf` | 0 | 0 | 0 |
| `nursery/noMisusedPromises` | 1 | 0 | 1 |
| `nursery/useAwaitThenable`, `nursery/useExhaustiveSwitchCases` | 0 | 0 | 0 |

The `recommended` preset finds 107 diagnostics: 65 `noNonNullAssertion` (picture code), 9 `noDescendingSpecificity` (viewer CSS), and about 30 small sites in TS, the viewer JS and the viewer HTML template.

## Cognitive complexity spread

Functions over the limit: 129 over 15, 80 over 20, 53 over 25, 46 over 30, 27 over 40, 17 over 50.

Worst: `src/commands/continue.ts:21` (139), `src/commands/spawn.ts:84` (127), `src/commands/github.ts:58` (117), `src/commands/status.ts:24` (112), `src/commands/spawn.ts:390` (96), `src/commands/jobs.ts:118` (90), `src/runtime/supervisor.ts:48` (79), `src/commands/group.ts:20` (77).

Function length over 50 lines: 38; over 80: 23; over 100: 18.

## Line width and braces

Lines wider than N columns (tab counted as two columns) before and after `biome format` at that width:

| | Lines | > 100 | > 120 | > 140 |
| --- | ---: | ---: | ---: | ---: |
| `src` now (width 180) | 11,688 | 1,308 | 759 | 423 |
| `src` after width 120 | 13,754 | 926 | 208 | 109 |
| `src` after width 100 | 15,254 | 365 | 208 | 109 |

The lines that stay wide after the format are long string literals and template strings. The formatter does not split them.

File line counts (newline count) for the whole reformat:

| Step | `src` | `hook` | `test` | `picture` |
| --- | ---: | ---: | ---: | ---: |
| Now | 11,660 | 1,614 | 2,417 | 3,196 |
| Width 120 | 13,726 | 1,840 | 2,855 | 3,396 |
| Width 120 and braces | 15,933 | 2,216 | 2,951 | 3,673 |
| Width 100 | 15,226 | 2,043 | 3,195 | 3,541 |
| Width 100 and braces | 17,311 | 2,406 | 3,281 | 3,811 |

`useBlockStatements` has no options in Biome 2.5.8. It flags every brace-less `if`, also `if (!value) continue;`. Its fix is marked unsafe, so it runs only with `biome lint --write --unsafe`. The `test/` line cap (3,500) holds at both widths.

After merging main `8bacea1` (group extensions, which adds `test/group-extensions.test.ts`): now `src` 11,787, `hook` 1,617, `test` 2,648, `picture` 3,178. Width 120: 13,843, 1,843, 3,120, 3,378. Width 120 and braces: 16,028, 2,219, 3,225, 3,635. A reformat of `test/` would leave 275 lines under the cap with no new test.

Biome's unsafe `useOptionalChain` fix rewrote `!identity?.member || identity.member.role !== "coordinator"` in `src/job/group-cabinet.ts:213` to `identity.member?.role !== "coordinator"`, which throws when the job has no group. tsc caught it. Run the typecheck after every `--unsafe` pass.

## The reformat on `main`

Recipe, from the repository root after setting `lineWidth` 120 and `style/useBlockStatements` in `biome.jsonc`: `npx biome lint --write --unsafe --only=style/useBlockStatements .`, then `npx biome format --write .` twice (the first pass left `test/plant.ts` unstable). It changed 104 files: 8,386 lines in, 2,380 out. Line counts match the "Width 120 and braces" row above (`bin` 253 to 269).

Check: every changed `.ts`, `.js` and `.mjs` file was parsed before and after with TypeScript, normalized (a one-statement block body unwrapped, parentheses and trailing commas dropped, comments and whitespace ignored), and compared leaf token by leaf token: 102 files, 0 differ. tsc and Biome pass; `npm test` 68 of 68.

Lines still wider than 120 columns (tab as two): `src` 206, `hook` 14, `test` 66, `picture` 75, `bin` 10. They are long string and template literals, mostly agent prompts and error messages; the formatter does not split strings.

## Seams

- Flag loops: `src/commands/spawn.ts` (17 flag compares), `continue.ts` (10), `group.ts` (6), `keeper.ts` (4), `jobs.ts` (3), and one or two in `land.ts`, `picture.ts`, `sweep.ts`, `ticket.ts`, `init.ts`, `linear.ts`, `status.ts`, `steer.ts`, `src/main.ts`.
- `CONTRIBUTING.md:35` held the old rule: "The linter preset stays `none` except `nursery.noFloatingPromises`. Do not enable a style pack."
- `picture/viewer/*.js` is inlined into a classic `<script>` by `src/picture/html.ts:44`. Its `"use strict"` lines are not redundant there, although Biome reads the files as modules.
