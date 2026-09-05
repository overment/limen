PASS e3865917f4beb521d7082d8ce085aeaff1e3e60f

The spec-deduplication candidate at `e3865917f4beb521d7082d8ce085aeaff1e3e60f` (`feat: specs keep one rule and one check per line`) meets the three acceptance bullets on `spec/features/active/F083-spec-folder-says-one-thing-once/ticket.md`. HEAD in this worktree is that commit; the tree was clean. The NOW line for this work (`F083-spec-folder-says-one-thing-once`) owns the boundary: `templates/communication.md` and `templates/agents.md`, with no validator.

No blocking findings.

Proven
- Specs section of `templates/communication.md` contains the four required phrases (`a line holding several checks is several lines`, `a line a reviewer cannot cite whole is two lines`, `a handoff carries one constraint per line`, `its length ceiling stays as it is`). They sit between `## Specs` and `## Human`. Parent `05a0a03` does not have them.
- `templates/agents.md` now keeps `the ticket, the notes, the numbered reviews, and the outcome` and deletes a file that stops being true `in the change that supersedes it`. The old `notes, questions, and review text` clause is gone.
- `test/structure.test.ts` asserts those phrases (`specs keep one check per line and delete superseded feature files`). Ran here after `npm ci`: pass (0.57ms).
- Length vs parent plus ten percent: `templates/communication.md` 120→122 lines (cap 132), 12270→12447 bytes; `templates/agents.md` 151→151 lines (cap 166), 27678→27679 bytes. Ticket word-budget sentence (`three hundred` / `five hundred`) unchanged.
- No validator, linter, or structure check over `spec/features/`. Diff is the two templates, their `templates/.history/` fingerprints, and the phrase test.

Notes (not blocking)
- PLAUSIBLE: retained evidence at `/Users/overment/.overment/limen/tmp/evidence/F083/candidate` is for this same commit and a clean tree. Its remaining-suite run (`test-rest.txt`) failed five tests in `test/prune-command.test.ts`, `test/spawn-command.test.ts`, and `test/stop-command.test.ts` (timing, fake herdr, concurrent jobs). An earlier truncated glob also failed `a clean run writes no stop-reason`. None of those files are in this diff. Not re-run.
- PLAUSIBLE: `biome check .` in retained evidence exits 1 on pre-existing wrapping of the F084 identifier `assert.ok` at `test/structure.test.ts` lines 81–84. Same wrapping is on parent `05a0a03`. This commit does not touch that region. Not re-run.
- Note: `templates/.history/communication.md` and `templates/.history/agents.md` gained the new tip hashes. That is the existing shipping contract (`templates/.history/${name} must start with the current template hash`, and `shipped template history matches git log/show of this clone`), not a second product surface.

Checks run
- `git rev-parse HEAD` → `e3865917f4beb521d7082d8ce085aeaff1e3e60f` (matches the candidate).
- `git status --porcelain` → empty.
- `git show e386591` / `git diff-tree --name-only` → five files as above.
- SHA-256 of both templates matches the first hash in each history file.
- `npm ci` from `package-lock.json` → 12 packages, 0 vulnerabilities.
- `node --test --test-concurrency=1 --test-timeout=60000 test/structure.test.ts test/inherit.test.ts` → 24 pass, 0 fail, including `specs keep one check per line and delete superseded feature files` and `shipped template history matches git log/show of this clone`.

Not run here (retained evidence at this commit, treated as background not proof of this review): `tsc --noEmit` (evidence `tsc_exit:0`); `biome check .` (evidence exit 1, pre-existing); full `test/*.test.ts`.
