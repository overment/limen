# F006-interactive-managed-updates · Package defaults, project overlays

[2026-08-17] [🟠] [ACTIVE] [COORDINATOR] ACTIVE · F006-interactive-managed-updates

## Outcome

A project inherits shop-manual, role, speech, and hook defaults from the installed `limen`. Updating the package updates every project. A project file at the same path is a whole-file overlay. Leftover identical copies are named and can be deleted. Overlays are never overwritten.

## Scope

- Stop `limen init` from copying role prompts, speech, shop manual, or hook bodies.
- Resolve those files from the package when the project file is absent.
- Plant one stub so vanilla `pi` still loads package hooks. Delete leftover `limen-*.ts` hook copies so they cannot load beside the stub.
- Name leftover vs overlay drift on the coordinator; `limen init --drop-leftovers` deletes only leftovers.
- Pass package hooks into hosted and detached jobs (`--no-extensions` plus `--extension`).

## Out of scope

- Publishing to the npm registry.
- A home-directory overlay layer.
- Merging Markdown.
- Auto-applying overlays or fetching a new `limen`.

## Acceptance

- A new project after `limen init` has no `.agents/limen/{worker,reviewer,communication}.md` and no copied `hook/` bodies.
- Spawn uses package worker/reviewer text unless the project overlays that file.
- The communication hook inherits package speech when the project file is absent, and attaches a leftover/overlay advisory when copies exist.
- `limen init --drop-leftovers` deletes only byte-identical copies.
- Native checks pass.

## Notes

See `notes.md` for the ownership model. The previous design-only brief is replaced by this implementation.
