# F006 · Package defaults, project overlays, leftover drift

## Model

```
installed limen (clone on PATH)     project
hook/  templates/                   spec/, styleguide
                                    optional overlay at the same path

effective(name) = project file if present, else package
```

No merge. A project file, if it exists, is the whole answer for that name.

| File | Package default | Project file means |
|---|---|---|
| `hook/*.ts` | yes | leftover or mistaken overlay; never a supported fork |
| `worker.md` `reviewer.md` `communication.md` | yes | overlay |
| shop manual (`templates/agents.md`) | yes | `AGENTS.md` overlay |
| `styleguide.md` `vision.md` `build.md` tickets | no | project-owned; not drift |

## Three states

- absent → inherit; say nothing
- bytes == package → leftover; ask to delete (`limen init --drop-leftovers`)
- bytes != package → overlay; ask keep / drop / edit; never overwrite

No sidecar hash. Old unmodified stock looks like leftover. Customized stock looks like overlay.

## Commands

- `limen init` plants project-owned empties and `.pi/extensions/limen.ts` (loads package hooks). Does not copy role prompts or hook bodies.
- `limen init --drop-leftovers` deletes only leftover (byte-identical) files.
- Updating the tool is `git pull` on the linked clone. Next spawn and `/reload` see new defaults.

## Agent brief

The communication hook attaches a Guidance-drift block when leftovers or overlays exist. The coordinator asks. Nothing is applied until the human says.

## What the agent may do alone

- Report drift.
- Run `limen init --drop-leftovers` after the human says to drop leftovers.

## What it must ask

- Whether an overlay stays.
- Whether to delete a leftover (unless the human already said drop leftovers).
