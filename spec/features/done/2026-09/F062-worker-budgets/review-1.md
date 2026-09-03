PASS ab6331d9913d2d5f437f7615c6b121227e1449aa

F062 candidate `ab6331d9913d2d5f437f7615c6b121227e1449aa` (`feat: workers stay off the board and inside reading and check budgets`) meets the three acceptance bullets. `git rev-parse HEAD` matches that commit.

**Proven.** `templates/worker.md` has the board rule, reading budget, check budget, and question trigger; hosted ending is write the final summary as the last message, then call `finish`; `quit pi` and `as far as this slice earns` are gone. `test/structure.test.ts` (`worker stays off the board and inside reading and check budgets`) asserts those phrases and the two absences. `templates/.history/worker.md` first hash equals sha256 of current `templates/worker.md`.

**PLAUSIBLE (not blocking).** This repo’s overlay `.agents/limen/worker.md` still has the old preamble, including `quit pi` and `as far as this slice earns`. `inheritFile` in `hook/inherit.ts` prefers that overlay, so workers spawned inside this repository do not get the new budgets. Ticket scope named `templates/worker.md`; not an acceptance miss.

Checks run:
- `git rev-parse HEAD` → `ab6331d9913d2d5f437f7615c6b121227e1449aa` (matches candidate)
- sha256(`templates/worker.md`) matches first token of `templates/.history/worker.md`
- `npm ci` from `package-lock.json` → 12 packages, 0 vulnerabilities
- `node --test --test-timeout=60000 test/structure.test.ts` → 6 pass, 0 fail

Not run (unverified): full `npm test`, `tsc`, biome. This diff is package-template phrases; the structure test is the discriminating check.
