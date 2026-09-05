# F078 · A picture is evidence only when someone looked at it

## Outcome

A worker or reviewer that cites a screenshot says it opened it and what it
showed, so a passing scenario can no longer stand in for a look. At Alice one
native run saved five frames of which four were byte-identical and the
conversation was empty, and the run reported passed; another saved five frames
for five different claimed states, all the same image. The owner opened those
PNGs by hand and steered three separate reviewers about them.

## Scope

- `templates/worker.md`: a visual claim is unproven until the frames were
  opened; frames that should differ and do not are a failed check, not evidence.
- `templates/reviewer.md`: a passing scenario flag is not visual acceptance;
  name what the frames showed or mark the acceptance unverified.
- One sentence each, inside the existing check budget and finding-label rules.

## Out of scope

- Any image comparison, hashing, or capture helper in the harness.
- A project's lab runner, scenario format, or capture timing.
- Making an unverified visual acceptance blocking; that stays the reviewer's
  existing rule.

## Acceptance

- Both templates contain their added sentence, asserted by phrase in the
  structure test.
- Each template stays under its current length plus ten percent.
- The structure test passes.

## Notes

Fixing the capture is project work. What limen owes is the rule that a machine
pass over the page is not a look at the picture.
