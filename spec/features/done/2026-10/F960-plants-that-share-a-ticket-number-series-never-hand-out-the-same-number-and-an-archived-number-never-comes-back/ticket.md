---
opened: 2026-10-31
landed: 2026-10-31
---

# F960 · Plants that share a ticket-number series never hand out the same number, and an archived number never comes back

## Outcome

Adam decided on 2026-10-31 that the alice and api plants share one ticket-number series. A coordinator in either plant runs `limen ticket new` and gets a number no other plant in the series has used, even when two coordinators run it at the same moment. When a plant moves closed tickets out of `spec/features/` into an archive and records them in `spec/features/archive.tsv`, their numbers still count, so no old number comes back. Today the next number is the highest F number in one plant's folders, branches and job labels, read and then created with no lock (`src/commands/ticket.ts:30-63`), and the `cancelled/` lane is skipped.

## Scope

- One series that two or more plants name, with a recorded high-water mark and a lock that `ticket new` holds from read to folder creation. Where the plants name their series and where the mark lives (seat-level state, not a tracked file in one repo) is the job's design; keep it to one source.
- The floor for a new number: the recorded mark, ticket folders in every lane of every plant in the series (`cancelled/` included), each plant's `spec/features/archive.tsv` rows and high-water line, `limen/*` branch names and job labels.
- The readers that need archived tickets: the land duplicate check (`src/commands/land.ts:316-338`), `limen close` (`src/job/job.ts:169-190`, `src/integrations/herdr.ts:670-680`) and board PROVEN (`src/project/lanes.ts:26-61`).
- `archive.tsv` columns as the alice plan names them: `path`, `number`, `title`, `close_month`, `archive_date`, `last_commit`, `manifest_digest`, plus one high-water row.

## Out of scope

- Moving any ticket folder or writing an archive: the plants' own coordinators do that.
- Renumbering the four numbers that both plants already use.
- Picture build: it keeps showing present tickets only.

## Acceptance

- A test starts two `ticket new` runs at once in two fixture plants of one series and gets two different numbers.
- A test archives a fixture plant's highest ticket into `archive.tsv` and then gets a higher number from `ticket new`.
- A test shows a `cancelled/` ticket number counted.
- A plant with no series and no `archive.tsv` numbers exactly as before.
- The land duplicate check refuses a new ticket whose number is in another plant of the series or in `archive.tsv`.
- `npm run check` passes.

## Notes

- Requested by the alice coordinator for the agreed alice and api target layout (alice ticket F1213, `org-spec-archive.md` and `org-synthesis.md` ruling 2). The alice archive sweep waits for this change.
