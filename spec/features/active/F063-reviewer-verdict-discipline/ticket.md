# F063 · Reviews open with the verdict, block only on acceptance, never on the environment

## Outcome

A review's first line is `PASS` or `FAIL` with the commit; a blocking finding is one that breaks the ticket's acceptance; a plausible race, a lint bypass, or a hardening idea is a note; a check that could not run is reported unverified and never blocks; dependencies are installed from the lockfile before the first JavaScript check; a re-review verifies the prior findings file and the delta and files anything else as a note; one full proof at most. At Alice three of four delivered verdicts were FAIL, 42 of 81 reviews lost checks to missing dependencies and two failed with no defect, verdicts used ten first-line formats, and a 145-word PASS took 52 minutes of reruns.

## Scope

- `templates/reviewer.md`: verdict on line one, one word with the sha, nothing before it; PASS carries notes; blocking limited to the acceptance bullets; PLAUSIBLE never under blocking; unverified never blocking; install from the lockfile, replacing "installing is not reviewing"; re-review bounded by the findings file; the feature folder's own review, notes, and outcome files and pre-existing formatting are outside the diff; one full proof, a transient failure reported as transient.
- The coordinator's filing step strips trailing whitespace from `review-N.md` (F061), so the next reviewer has nothing to report on it.

## Out of scope

- Any verdict parser; the coordinator reads the line.
- The review spawn prompt (F061).
- Project overlays of the reviewer prompt (F054 names them).

## Acceptance

- The reviewer template contains each rule, asserted by phrase in the structure test, and no longer contains "installing is not reviewing" or "only when no substantive finding remains".
- A probe review against a candidate with one acceptance defect and one lint bypass returns FAIL with one blocking finding and one note, checked by the model-probe method.
- A probe review in a worktree without dependencies installs and runs the checks rather than returning FAIL on the environment.

## Notes

The package already narrowed "blocking" on 2026-09-01; this ticket finishes the shape and makes the verdict line unambiguous.
