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

## Avoid

- Abstracting a second example. Duplicating a short function is cheaper than a helper bag.
- New workflow state, registries, or parsers for Markdown the human already owns.
- Style-lint packs, comment banners, and defensive try/catch around impossible cases.
- Rewriting working code to match a model's default taste.
