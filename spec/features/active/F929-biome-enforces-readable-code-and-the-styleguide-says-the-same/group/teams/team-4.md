# Team 4 · `spawn`, `continue` and `group start` parse flags with `parseArgs`

Test line budget: 100 lines.

## Your files

`src/commands/spawn.ts` (17 flag compares), `continue.ts` (10) and `group.ts` (6). They hold the worst functions in the repository (`notes.md`: `continue.ts:21` 139, `spawn.ts:84` 127, `spawn.ts:390` 96, `group.ts:20` 77). Team 2 splits what remains after you release a file; publish `Released <file>` when your last candidate for it lands.

## Shared flag module

Team 1 builds it first and publishes its API before landing. Answer that publication quickly with what your three commands need: repeated flags, list values (`--team-extension`, `--team-model team-N=provider/model`), a value that starts with `-`, booleans, and each command's own messages. Do not build a second module.

## Work while the module lands

- Write down the exact parse behavior of each command before you change it: every flag, its value form, what a repeat does, every error message. Probe the real CLI on `main`; error paths throw before any job exists.
- Move each flag loop out of its big function into a named parse function that returns a typed options object. This is a pure move; it lands on its own and already lowers complexity.

## Then the swap

- Replace each loop with the shared module, one command per candidate: `group start`, then `continue`, then `spawn`.
- Keep every message and every accepted form. `parseArgs` also accepts `--flag=value`; accepting that form is fine, rejecting input that worked before is not.
- Show it: run the same argument list through the command on `main` and on your branch, and diff the results. A throwaway script outside the repository is enough. Add a test only for an edge the existing tests miss, inside your budget.

## Done

No hand-written `--flag` comparison loop is left in your three files, and each is released to Team 2.
