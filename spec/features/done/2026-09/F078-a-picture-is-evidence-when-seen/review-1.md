PASS 5067c69d0ce8dd05434c5f5397ddea61c6d0c5ce

No blocking findings. Candidate `5067c69d0ce8dd05434c5f5397ddea61c6d0c5ce` (`feat: a picture is evidence only when someone looked at it`) matches `git rev-parse HEAD` on a clean tree. Board line `F078-a-picture-is-evidence-when-seen` owns the boundary: `templates/worker.md` and `templates/reviewer.md`, no capture or image-comparison helper.

Acceptance, independently confirmed:
- Worker check-budget bullet now contains one sentence: "A visual claim is unproven until the frames were opened; frames that should differ and do not are a failed check, not evidence." Reviewer finding-label bullet now contains one sentence: "A passing scenario flag is not visual acceptance; name what the frames showed or mark the acceptance unverified." `test/structure.test.ts` test `a picture is evidence only when someone looked at it` locks those phrases.
- Length vs parent (`HEAD~1`): `templates/worker.md` 4311 → 4439 bytes (+2.97%, cap 4742.1); `templates/reviewer.md` 2899 → 3012 bytes (+3.90%, cap 3188.9). Both under +10%. Line counts unchanged (29 / 20).
- Structure suite: retained evidence at matching clean HEAD, plus phrase presence verified by reading the files. Did not rerun.

Companion edits `templates/.history/worker.md` and `templates/.history/reviewer.md` prepend the current SHA-256 of each template (`28778363…` / `58437efc…`); independently hashed, they match. Required by the existing history invariant, not a helper.

Did not rerun a JS lane. Retained evidence at `/Users/overment/.overment/limen/.limen/jobs/2026-09-05-f078-opened-pictures-restart-1-05e26bd7/evidence` records `HEAD=5067c69d0ce8dd05434c5f5397ddea61c6d0c5ce` and `dirty=0`. `discriminating-structure-test.log`: pass 1 / fail 0 for the new test. `structure-and-inherit.log`: 24 pass / 0 fail, including the new test and history-hash match. That is the same commit and a clean tree, so it is not unverified. Phrase match has no regex metacharacters; reading the templates already rules out a miss.

Checks actually run here:
- `git rev-parse HEAD` → `5067c69d0ce8dd05434c5f5397ddea61c6d0c5ce` (matches the given candidate).
- `git status --porcelain` → empty.
- `git show` of `5067c69` → five files, templates plus history plus the phrase test; no capture/hash helper.
- Independent byte counts vs `HEAD~1`, SHA-256 of both templates vs `.history` heads, and substring presence of every locked phrase → all match.
- Inspected retained `head.txt`, `template-lengths.txt`, `discriminating-structure-test.log`, `structure-and-inherit.log`, `tsc.log`, `npm-run-check.log`, `npm-test.log`.

Not run here (and not used as proof): lockfile install, `node --test`, `npx tsc`, `npm run check`, `npm test`.

Notes, not blocking:
- `npm-run-check.log` EXIT 1 is biome format on the pre-existing identifier-rule `assert.ok` in `test/structure.test.ts` (same block on `HEAD~1`, outside this diff). Ticket acceptance is the structure test, not biome.
- `npm-test.log` TEST_EXIT 1 with 24 pass / 0 fail / 26 cancelled (`Promise resolution is still pending but the event loop has already resolved`). Transient; worker did not use it as proof. Not rerun.
- Length +10% is not locked by the new structure test; verified by measurement as the ticket allows.
