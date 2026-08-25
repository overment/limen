# F040-retire-control-migrate · Drop the Control → Limen one-shot if no one still needs it

[2026-08-25] [🔴] [PLANNED] [COORDINATOR] PLANNED · F040-retire-control-migrate

**Decision ticket.** Do not activate without explicit human sign-off; if declined, move to `dropped/` with the reasoning in `outcome.md` and leave `limen migrate` as-is.

## Outcome

If no Control-era project remains, `limen migrate` and the `[control ` log-line compatibility go away. `src/` gets those ~125 lines back. `limen init` still refuses leftover `.control` paths, with a message that names the old product and points at history, not at a living command.

## The decision, honestly stated

`limen migrate` rewrites `.control` → `.limen`, deletes `control-*.ts` extensions, patches `AGENTS.md` / `.gitignore`, and plants the stub. It is complete, tested, and documented. It is also a one-shot from a rename that has already landed on this machine and in every current walkthrough. Keeping it costs ~5% of the `src/` budget and a whole test file, forever, for a command nobody should run twice.

The counterargument, also real: a forgotten clone or an old laptop still on `.control` would be stuck. `init` already refuses those trees and tells the operator to migrate. Deleting the command without a replacement path turns that refusal into a dead end.

Sign-off means: no known Control checkout still in use, or the operator accepts "read `git log` / do the rename by hand" as the recovery.

## Scope

- Remove `src/commands/migrate.ts`, its `main.ts` / help / README / CONTRIBUTING entries, and `test/migrate-command.test.ts`.
- `init` still errors on `.control`, `.agents/control`, and `control-*.ts` extensions. The message stops saying `run limen migrate instead` and instead says these are leftover Control paths and must be renamed or removed by hand.
- Stop treating `[control ` as a terminal log prefix in `src/commands/jobs.ts` and `src/commands/spawn.ts`. Drop the jobs test that plants a Control line.
- Structure-test command list and help-string `satisfies` stay in lockstep with `main.ts`.

## Out of scope

- Changing `limen init --drop-leftovers` (that is package-vs-project prompt copies, not Control).
- Rewriting live `.limen/` records.
- Any new migrator.

## Acceptance

If signed off:

- `limen migrate` is an unknown command.
- `limen init` in a tree that still has `.control` refuses, and the message does not name `migrate`.
- A job log whose last interesting line is only `[control …]` no longer becomes the `jobs` detail line.
- `npm run check` green. `src/` line count drops.

If declined: ticket dropped with one sentence naming who still needs migrate.

## Notes

Found in the 2026-08-25 source review. After F039 if both happen — do not spend a split on a file you are about to delete; migrate is its own file either way, so the order is only editorial.

Not a behavior change for anyone already on `.limen/`.
