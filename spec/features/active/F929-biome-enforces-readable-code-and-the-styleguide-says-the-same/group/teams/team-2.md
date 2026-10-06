# Team 2 · a complexity limit that `npm run check` enforces

Test line budget: 40 lines.

## Numbers to start from (`notes.md`, measured before the reformat)

Cognitive complexity per function: 129 over 15, 80 over 20, 53 over 25, 46 over 30, 27 over 40, 17 over 50. Worst: `continue.ts:21` (139), `spawn.ts:84` (127), `github.ts:58` (117), `status.ts:24` (112), `spawn.ts:390` (96), `jobs.ts:118` (90), `src/runtime/supervisor.ts:48` (79), `group.ts:20` (77). Function length grew with the reformat; measure lines per function again on `main`.

## First candidate: the policy (land it within about an hour)

- Turn on `complexity/noExcessiveCognitiveComplexity` at `error` for the whole tree with one `maxAllowedComplexity`. Adam suggested 25 to 40. Pick the lowest value you can defend, and give the reason in the comment.
- Every function over the limit gets a `biome-ignore` comment on that function with a short reason, for example `split pending: flag parsing moves to parseArgs (Team 4)`. No file-wide or path-wide exemption: a new function over the limit must fail.
- Add `complexity/noExcessiveLinesPerFunction` the same way, if a limit exists that does not exempt most of the tree. If it does not, leave it out and say so in `notes.md`.
- Write the list of exempt functions, with their complexity, in `notes.md` under "Complexity exemptions". Each later candidate shortens it.

## Then the splits

- Your files: `src/commands/github.ts`, `status.ts`, `jobs.ts`, and `src/runtime/supervisor.ts`, including their flag parsing (use Team 1's shared flag module when it lands). Split each big function into named steps until it is under the limit and you can remove its suppression.
- `spawn.ts`, `continue.ts` and `group.ts` belong to Team 4 until it publishes that it released one. Their parser work removes much of their complexity; split what is left after that.
- A split keeps behavior: same output, same files written, same order of side effects. Name each step for what it does in Limen's words (job, worktree, wake, ticket, board).

## Done

The limit is on for the whole tree, and the exemption list in `notes.md` is as short as you could make it without a rewrite of a whole command.
