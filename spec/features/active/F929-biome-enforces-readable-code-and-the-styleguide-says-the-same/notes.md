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

## Flag loops kept (team 1)

- `src/commands/steer.ts`: compares `args[0]` with `--running`; every later word is free message text. `parseFlags` would read message words such as `--force` as flags and reject them, and would reject a job id that starts with `--`.
- `src/commands/sweep.ts`: compares the single word with `--install` or `--uninstall`. `parseFlags` needs a repeated rule and a separate both-flags check to keep "sweep accepts no arguments, --install, or --uninstall" for `--install --uninstall`; three plain `if`s read better.
- `src/commands/init.ts`: compares the single word with `--drop-leftovers`. Same reason as sweep: one exact word, one message.
- `src/main.ts`: the dispatch scans the words before `--` for `--help` or `-h`, for every command, without knowing its flags. `parseFlags` needs the command's table, throws on flags it does not know, and treats `-h` as a positional.
- `src/commands/ticket.ts` `ticketCheck`: not a flag loop; it takes one branch name and rejects any word that starts with `-`. `parseFlags` would accept `-x` as a branch name.

## Complexity exemptions

`biome.jsonc` holds every function to cognitive complexity 25 (`complexity/noExcessiveCognitiveComplexity`) and 70 lines, blank lines and IIFEs not counted (`complexity/noExcessiveLinesPerFunction`). Each function below carries a `biome-ignore` comment for each limit it breaks, with its reason; no file or path is exempt, so a new function over a limit fails `npx biome check`. Each later candidate removes rows.

Why 25: it is the low end of the 25 to 40 range Adam set. On `main` at `a34d21d`, of 977 functions, 78 were over 20, 51 over 25, 44 over 30 and 26 over 40. The keeper override stays at 20.

Why 70 lines: on `main` at `a34d21d` the line limit flagged 58 functions at 50, 41 at 60, 26 at 70 and 24 at 80. At 70, 21 of the 26 were also over the complexity limit; the five others are three hook factories whose handlers share closure state, the coordinator signal factory, and one end-to-end test. At 60 it flagged eight more functions under the complexity limit, among them the keeper command's 63-line `keeperCommand`, the sample of the target style. `skipIifes` is on because the viewer scripts wrap their module in an IIFE (`src/picture/html.ts` inlines them into a classic script); without it, a whole viewer script counts as one function (`layers.js` as 506 lines).

On `main` at `76a2f6d`: 48 functions over the complexity limit and 22 over the line limit, 53 functions in all. "Split owner" follows the group brief: Team 2 splits its own files, and the rest of `spawn.ts`, `continue.ts` and `group.ts` after Team 4 releases them; Team 4 moves the flag loops of `spawn.ts`, `continue.ts` and `group.ts` to `parseArgs`. "—" means no F929 team owns the split.

| Function | Complexity | Lines | Split owner |
| --- | ---: | ---: | --- |
| `src/picture/tickets.ts` `parseTicket` | 68 | 156 | — |
| `picture/viewer/viewer.js` `lighting` | 67 | 72 | — |
| `src/picture/picture-model.ts` `readRecord` | 65 | 162 | — |
| `src/picture/picture-model.ts` `buildModel` | 58 | 198 | — |
| `src/commands/land.ts` `landTicketCheck` | 56 | 91 | — |
| `src/commands/github-doctor.ts` `githubDoctor` | 52 | 227 | — |
| `src/integrations/github-poller.ts` `request` | 52 | — | — |
| `src/commands/prune.ts` `pruneFinishedWorktrees` | 51 | — | — |
| `picture/viewer/viewer.js` `model.work` map callback | 49 | — | — |
| `picture/viewer/viewer.js` `drawWires` | 48 | — | — |
| `src/commands/sweep.ts` `sweepProject` | 45 | — | — |
| `src/job/group-cabinet.ts` `groupLock` | 45 | — | — |
| `src/runtime/reap.ts` `reapDeadJobs` | 44 | — | — |
| `picture/viewer/viewer.js` `adapt` | 43 | 211 | — |
| `src/integrations/github-poller.ts` `reconcile` | 43 | 114 | — |
| `src/integrations/finish-receipt.ts` `inspectFinishWebhook` | 40 | — | — |
| `src/picture/frontmatter.ts` `parseFrontmatter` | 39 | — | — |
| `picture/viewer/layers.js` `renderWork` | 38 | — | — |
| `hook/wake.ts` `observe` | 37 | — | — |
| `src/picture/markdown.ts` `renderInline` | 36 | — | — |
| `src/runtime/wrapper.ts` `runInternalJob` | 35 | 204 | — |
| `hook/wake.ts` `sendAdvisory` | 35 | 94 | — |
| `src/project/git.ts` `unlandedBranches` | 35 | — | — |
| `picture/viewer/viewer.js` `parse` | 34 | — | — |
| `src/picture/frontmatter.ts` `parseInlineList` | 34 | — | — |
| `src/runtime/engine.ts` `prepareSkillConfig` | 34 | — | — |
| `picture/viewer/viewer.js` `crumbs` | 33 | — | — |
| `hook/group-peer.ts` `message_end` handler | 31 | — | — |
| `src/integrations/herdr.ts` `locateHostedAgent` | 31 | — | — |
| `src/picture/frontmatter.ts` `parseBlock` | 31 | — | — |
| `hook/wake.ts` `finishSweep` | 30 | — | — |
| `src/commands/picture.ts` `pictureCommand` | 30 | — | — |
| `src/runtime/recovery.ts` `claimRecovery` | 30 | — | — |
| `picture/viewer/viewer.js` `work.sort` comparator | 29 | — | — |
| `src/commands/land.ts` `landCommand` | 29 | — | — |
| `src/job/group-events.ts` `eligibleEvents` | 26 | — | — |
| `hook/wake.ts` `limenWake` | — | 618 | — |
| `src/integrations/coordinator-signal.ts` `coordinatorSignals` | — | 172 | — |
| `hook/group-peer.ts` `groupPeer` | — | 156 | — |
| `hook/hosted.ts` `limenHosted` | — | 130 | — |
| `test/s10-doorbell.test.ts` S10 doorbell test body | — | 119 | — |

## Flag loops kept (team 2)

- `src/commands/status.ts` `parseStatusArgs` accepts no argument or a lone `--all` and has one message; a `parseFlags` table and rules would replace one comparison.
- `src/commands/jobs.ts` `parseJobsArgs` accepts `--label <prefix>` only as exactly two arguments, or one bare job id, suffix or label, or one of `--running`, `--active`, `--all`; `parseFlags` would also accept `--label=<prefix>` and other orders.
