# F722 · Record tests prove behavior

## Outcome

The structure suite still guards architecture: empty runtime dependencies, unique TypeScript basenames, no barrels, one pulse function, the `src/` line budget. It no longer fails because a command file stopped mentioning a job-file name while the records themselves still hold.

## Scope

- Start at the spawn/continue/jobs filename-`includes` table in `test/structure.test.ts`.
- Replace those selected assertions with equivalent coverage of real job records and jobs output. Spawn already writes a canonical record; extend that style rather than grepping command source.
- Leave watch and pulse-law checks intact. Keep the architecture guards, including that jobs must not treat Herdr `working` as pulse, and do not raise the 4160-line cap.

## Out of scope

- Runtime changes to what spawn, continue, or jobs write or read.
- Dropping pulse-law, command-list, template-history, or dependency guards.
- Deleting unread hook files or unifying hosted and detached writers.

## Acceptance

- Each removed filename assertion has corresponding record or command-output coverage; the handoff maps the old assertions to those checks.
- A spawned fixture exposes the canonical metadata required by the existing jobs reader, including review and subscription metadata where applicable.
- A continuation fixture preserves parent identity and hosted metadata in its on-disk record.
- Jobs output displays the tested record values, including a review candidate, rather than merely mentioning their filenames in source.
- Removing a required field or suppressing its output makes the relevant behavior check fail; retain the discriminating evidence.
- Existing architecture guards remain intact after the selected spawn/continue/jobs source-substring checks are removed.

## Notes

Source: the ceremony-test finding in `spec/research/code-clarity/judgment.md`. Retargeting is an explicit policy choice, not a cleanup inside another slice.
