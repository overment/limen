# F018-review-handoff · A reviewer knows the candidate commit and what was already found

[2026-08-18] [🔴] [PLANNED] [COORDINATOR] PLANNED · F018-review-handoff

## Outcome

A reviewer starts with the exact commit under review instead of discovering it, and a re-review starts with the prior findings instead of re-prosecuting the whole diff. The verdict survives in the ticket folder, not only in a session file.

Observed cost today (F016 notes, section 3): `spawn --review` checks out the branch detached but never tells the reviewer which commit that is; prior review findings exist nowhere the harness or the shop manual names, so a second reviewer either gets them pasted into the spawn text or proceeds blind.

## Scope

- **Candidate commit, mechanical.** In `src/commands/spawn.ts`, when `--review` resolves the candidate branch, record `git rev-parse <branch>` to `.limen/jobs/<id>/candidate` and append one line to the generated `task.md`: `Candidate commit: <sha>.` The reviewer already must name the commit reviewed (`templates/reviewer.md`); now the name it reports can be checked against the name it was given.
- **Verdict filing, convention.** Extend `templates/agents.md` steps 5–6: after reading a review, the coordinator saves the verdict text to the feature folder as `review-<n>.md` (first review `review-1.md`) in the same change that acts on it. Extend `templates/reviewer.md`: the final message is the complete verdict and should be written so it can be filed verbatim.
- **Re-review handoff, convention.** Extend the shop-manual resume/review guidance: a repair spawn names the findings file (`Fix the blocking findings in spec/features/active/FNNN-slug/review-1.md`), and a re-review spawn names both the new candidate commit and the prior findings file, scoping the reviewer to what changed plus what was previously blocking.
- **`limen jobs <id>`** prints the `candidate` line for review jobs (one line in `src/commands/jobs.ts`).

## Out of scope

- The harness writing `review-<n>.md` itself. The review worktree is a detached checkout of the candidate; the ticket folder lives on the coordinator's branch. Filing the verdict is coordinator work by design.
- A review-history registry, verdict parser, or PASS/FAIL state anywhere in `src/`. The verdict is prose the coordinator reads.
- Changing reviewer independence: no prior-review auto-attach into the reviewer's context. The re-review names the findings file; reading it is the reviewer's first tool call, and fresh eyes on the diff remain the point.
- `--tab` reviews (still refused).

## Acceptance

- `limen spawn --review --branch <b>` produces `.limen/jobs/<id>/candidate` containing exactly `git rev-parse <b>` at spawn time, and `task.md` whose last line is `Candidate commit: <sha>.` — covered by a fake-pi test asserting both files.
- A non-review spawn writes no `candidate` file.
- `templates/agents.md` names the `review-<n>.md` convention in the default loop, and `templates/reviewer.md` tells the reviewer its final message is filed verbatim.
- The shop manual's repair and re-review examples name a findings file and a candidate commit.
- `npm run check` green; `test/structure.test.ts` reflects any command-file change.

## Notes

Seams: `planWorktree` (`kind: "detach"`) and `task.md` assembly in `src/commands/spawn.ts`; `templates/reviewer.md`; `templates/agents.md` steps 5–6 and the resume guidance in Recovery. F016 notes section 3 is the map. The F009 review (`57f6c96`, filed in that feature's folder) is the informal precedent this makes a named convention.
