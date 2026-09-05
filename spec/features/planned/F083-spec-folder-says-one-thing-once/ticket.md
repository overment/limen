# F083 · The spec folder says one thing once

## Outcome

A worker reads one line per rule and one line per check, and every file in a
feature folder is still true. At Alice 89 of 107 handoffs were a single
paragraph carrying six to eight separate rules while only one exceeded the word
ceiling, so length was never the defect; acceptance lines averaged 22 words
fusing three or four checks, and one candidate failed on a single clause of a
four-clause line. One feature folder held seven files while its handoff named
two, with nothing marking the other five current or superseded, and nine
different filenames were invented across the active lane.

## Scope

- `templates/communication.md`, Specs: one observable check per acceptance line;
  a line holding several checks is several lines.
- The same section: a handoff carries one constraint per line, and its length
  ceiling stays as it is.
- `templates/agents.md`: a feature folder keeps the ticket, the notes, the
  numbered reviews, and the outcome; a file that stops being true is deleted in
  the change that supersedes it.

## Out of scope

- The ticket word budget and section list, which already hold.
- Research reports and judgments, which have their own filing rule.
- Any validator, linter, or structure check over a project's spec folder.

## Acceptance

- Both templates contain their added sentences, asserted by phrase in the
  structure test.
- Each template stays under its current length plus ten percent.
- The structure test passes.

## Notes

The register already says an acceptance bullet is one observable behavior. The
tickets have drifted off it, so this states the failure mode rather than adding
a rule: a line a reviewer cannot cite whole is two lines.
