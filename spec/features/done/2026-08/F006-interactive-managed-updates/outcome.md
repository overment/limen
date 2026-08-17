# Outcome

Landed. Package defaults inherit; leftover hook copies cannot load beside the stub.

- `limen init` plants vision, board, feature lanes, styleguide, and `.pi/extensions/limen.ts`. It does not copy role prompts or hook bodies.
- Effective file = project overlay if present, else the installed package.
- Leftover identical prompt copies are named; `limen init --drop-leftovers` deletes only those. Hook copies are always deleted.
- Independent review FAIL at `539e07a` (leftover `limen-*.ts` double-loaded next to the stub). Repair `236b8e7` reviewed PASS.

## Date

2026-08-17

## References

- `539e07a` inherit
- `236b8e7` drop leftover hook copies (reviewed PASS)
- Reviews: `2026-08-17-f006-review-19336200` FAIL, `2026-08-17-f006-repair-review-b4091dba` PASS
