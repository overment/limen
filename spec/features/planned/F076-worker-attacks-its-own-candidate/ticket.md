# F076 · A worker tries to break its own candidate before it finishes

## Outcome

A worker names the acceptance line most likely to be false on its own branch,
writes the check that would catch it, and reports what that check did. The
reviewer stops being the first session to ask what would make the candidate
wrong. At Alice 10 of 21 verdicts in one day were FAIL, and in four of the six
failed reviews the blocking finding came from a throwaway probe the reviewer
wrote and the worker never did. Repair and re-review rounds took 35 jobs and
10.7 of 37 job-hours.

## Scope

- `templates/worker.md`: before the final commit, name the acceptance line most
  likely to be false and write the check that would catch it.
- Say what that check did in the final message, beside the checks already
  reported. A suite that only passes is not evidence.
- The instruction is one sentence in the existing check budget, not a new
  section and not a second pass over the diff.

## Out of scope

- The reviewer prompt, which already prosecutes the riskiest claim.
- The coordinator's re-review handoff, which already names that check (F061).
- Any harness check, counter, or gate on whether the worker did it.

## Acceptance

- `templates/worker.md` contains the falsifier sentence, asserted by phrase in
  the structure test.
- The template stays under its current length plus ten percent.
- The structure test passes.

## Notes

F061 already tells the coordinator to name that check when it sends a candidate
back for re-review. This moves the same demand to the first candidate, where it
costs one test instead of one round.
