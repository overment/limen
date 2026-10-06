# Styleguide

> Project-owned coding practice for every coordinator, worker, and reviewer turn. Keep this file at or below 1000 lines. The injected copy is capped at 1000 lines. This file governs how code is written and organized here, not product scope and not speech.

## Shape

- Small, direct TypeScript. Capability in `src/`; judgment in `templates/` and project Markdown.
- One file, one job. Do not add `index.ts`, `types.ts`, `utils.ts`, barrels, enums, or a shared helper bag.
- Prefer plain functions, union types, and early returns over classes and frameworks.
- Keep runtime dependencies empty. `src/` stays near the structure-test line budget.

## Prefer

- Exact names already used in the repo: job, worktree, pulse, wake, ticket, board.
- Readonly inputs. Local mutation is fine; shared mutable state is not.
- Inform, do not gate. Advisories and durable notes over new control flow.
- Tests that exercise real Git and real files. Assert observable behavior, not ceremony.

## Checked by Biome

`npm run check` fails on these. `biome.jsonc` names each rule with its reason.

- Lines at most 120 columns. The formatter wraps code; split a long string yourself when it holds two ideas.
- Braces on every `if`, `for`, `while`, and `else` body, also `if (!value) continue;`.
- One effect per statement. No assignment inside an expression: write `seq += 1;`, then `String(seq)`.
- Flat control flow. No `else` after `return`, `throw`, `break`, or `continue`. Join `if (a) { if (b) … }` into `if (a && b)`.
- Optional chains for guarded reads: `message?.role !== "user"`, not `!message || message.role !== "user"`.
- Every promise is awaited or returned. Do not pass an async function where the caller expects a plain return.
- A `switch` over a union handles every member or has a `default`.
- Every function holds cognitive complexity at most 25 and at most 70 lines, blank lines not counted. Split a longer function into named steps. A function still over a limit carries a `biome-ignore` comment with its reason; a new function over a limit fails the check.
- Files that the `biome.jsonc` override lists follow the target style: no nested ternary, and cognitive complexity at most 20 per function.

## Avoid

- Abstracting a second example. Duplicating a short function is cheaper than a helper bag.
- New workflow state, registries, or parsers for Markdown the human already owns.
- Lint presets and style packs. Name each rule in `biome.jsonc`.
- Comment banners and defensive try/catch around impossible cases.
- Rewriting working code to match a model's default taste.
