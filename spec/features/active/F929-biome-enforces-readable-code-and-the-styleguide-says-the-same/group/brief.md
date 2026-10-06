# F929 group brief · the whole tree follows the readable style that Biome checks

## Outcome

Adam picked all four code-quality steps on 2026-10-06 at 18:31: a 120-column reformat with braces, a complexity limit, Biome's recommended preset, and `parseArgs` for the command parsers. Each team turns one step into checked candidates. The lead lands each candidate on `main` as soon as it is green; nothing waits for the end. End state: `npm run check` green with all four in force, the styleguide saying the same, and still no runtime dependency.

## Already on main when the group starts

- The safe package: `biome.jsonc` names every lint rule with its reason (preset `none`); the keeper command (`src/commands/keeper.ts`) parses flags with `parseArgs` and keeps its old messages through a first pass over `parseArgs` tokens (`rejectBadFlags`); the styleguide and `CONTRIBUTING.md` state what Biome checks.
- The reformat: `lineWidth` 120 and `style/useBlockStatements` for the whole tree. It changed 104 files. Every changed script parses to the same program apart from added braces, parentheses and trailing commas. Lines: `src` 11,787 to 16,028, `hook` 1,617 to 2,219, `test` 2,648 to 3,225.
- Research in this folder: `notes.md` (rule hit counts, complexity spread, worst functions, flag-loop seams) and `patterns.md` (parsing, unions, transition tables, type guards; why not Effect, XState or Zod).

Rebase onto `main` before you start (worktrees share refs: `git rebase main`).

## Rules (Adam, binding)

1. No runtime dependency. No Effect, XState, Zod or any other package. Use `node:util` `parseArgs`, unions, transition tables and type guards.
2. Behavior stays the same. A command accepts, rejects and prints what it did before. A refactor that changes a message needs a reason in the candidate message.
3. After every `biome ... --write --unsafe`, run `npx tsc --noEmit`. Biome's unsafe `useOptionalChain` fix once dropped a needed `?.` in `src/job/group-cabinet.ts`.
4. `test/` holds at most 3,500 lines (`spec/vision.md`); it holds 3,225 now. New work replaces tests; it does not only add them. Put your test line count in every candidate.
5. TypeScript basenames stay unique across the repository (`test/structure.test.ts`). A split file needs a name no other file uses.
6. Each rule you add or change in `biome.jsonc` has a comment with its reason. Update `.agents/limen/styleguide.md` (at most 1,000 lines) and `CONTRIBUTING.md` in the same candidate. Edit only the lines about your rule.
7. Run `npx biome check --write <files>` on the files you touched before you commit; the formatter is the style.

## File ownership

Two teams in one function cause conflicts. Until a team publishes that it released a file, only its owner changes it beyond a one-line fix.

- Team 1 owns the shared flag module it creates first, the keeper command, and the smaller command parsers: `land.ts`, `picture.ts`, `ticket.ts`, `linear.ts`, `steer.ts`, `sweep.ts`, `init.ts`, `src/main.ts`.
- Team 2 owns `src/commands/github.ts`, `status.ts`, `jobs.ts`, `src/runtime/supervisor.ts`, and every function it splits.
- Team 3 owns `picture/` and `src/picture/`, and one-line recommended-rule fixes anywhere.
- Team 4 owns `src/commands/spawn.ts`, `continue.ts` and `group.ts` until it publishes `Released <file>`.

`biome.jsonc`, the styleguide and `CONTRIBUTING.md` are shared. Keep your edit there small and rebase often.

## Candidate hand-off

Members cannot land. Commit on your branch, rebase onto `main`, then run `npx tsc --noEmit`, `npx biome check .` and `npm test`. Publish to the lead:

`Candidate ready: <what>, branch <branch>, commit <sha>. Files: <n>. test/ lines: <n> (+a -d). Checks: <commands and results>. Behavior: <how you showed it did not change>.`

The lead merges the candidate onto `main` in a scratch tree, runs tsc, Biome, `npm test`, the ticket check and the strict picture build, lands it, pushes and publishes `Landed: <what> at <sha>`. Rebase before your next candidate. Small candidates land faster and conflict less.

## Lead

The lead lands, keeps `biome.jsonc` coherent, answers questions, and writes the status for Adam. Ask early; a blocked team costs more than a question.
