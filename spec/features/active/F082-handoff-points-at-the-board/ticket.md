# F082 · The handoff points at the board instead of repeating it

## Outcome

The board's boundary line is where a feature's file ownership lives, and a
handoff names it rather than restating it, so a running job cannot be governed
by a prompt that has drifted from the board. At Alice the board already carried
each feature's boundary while every prompt retyped it in its own words, and 7 of
33 steers in one day were the owner administering a shared native-test slot by
hand — taking it, releasing it, telling a worker not to force it. Candidates
finished with their proof pending and needed extra jobs; one feature took two.

## Scope

- `templates/agents.md`: the board line carries the boundary this job must not
  cross, and the handoff points at it.
- A boundary that changes is a board edit in the same coherent change, not a new
  prompt or a steer.
- A boundary a running job must learn about is a steer that names the board line,
  not a restatement of the rule.

## Out of scope

- Any lane, lock, slot, or reservation primitive in the harness.
- The board's format, marks, or compression (F059).
- Whether a project serializes a shared resource at all, which is project work.

## Acceptance

- `templates/agents.md` contains the added sentences, asserted by phrase in the
  structure test.
- The manual stays under its current length plus ten percent.
- The structure test passes.

## Notes

A lock primitive was considered and rejected: the resource being serialized is a
project's test runner, not a harness object. What is missing is a durable home
for the boundary, and the board is already it.
