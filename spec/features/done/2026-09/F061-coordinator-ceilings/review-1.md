PASS 216115f346f762ce6666260e748babf59deaf8ca

The shop manual at `templates/agents.md` holds the F061 ceilings (owner-stated review appetite, second-FAIL stop including labelled-proven, steer-before-stop, clean merge checkout, short handoffs, sticky model). HEAD is `216115f346f762ce6666260e748babf59deaf8ca` (`feat: shop manual holds review and merge ceilings`). All three acceptance bullets hold.

**Proven (acceptance).**
- Structure test `shop manual holds review and merge ceilings` in `test/structure.test.ts` asserts each added sentence by phrase (29 phrases). All 29 are present in the candidate `templates/agents.md` and absent from the parent.
- Length: parent `templates/agents.md` 3289 words / 20871 bytes / 116 lines → candidate 3467 / 21788 / 116 (+5.4% words, under +10%).
- Each added sentence maps to a numbered 2026-09-03 Alice finding in `spec/features/active/F061-coordinator-ceilings/notes.md` (findings 1–16). F056 wake routing and F058 single-quote/`--task-file` were already in the manual and were not rewritten. `templates/.history/agents.md` first hash matches sha256 of current `templates/agents.md`.

**Notes (plausible, not blocking).**
- Recovery still says a re-review “names the new candidate commit and the prior findings file” (`templates/agents.md` resume bullet). Step 6 now forbids a hand-typed hash. A coordinator copying Recovery can still put a sha in the handoff.
- The step-6 re-review example names only the findings file. Prose requires naming the commit (via harness candidate, not a typed hash) and the one check that would prove the candidate wrong; a copied example omits both.

**Checks run.**
- `git rev-parse HEAD` = `216115f346f762ce6666260e748babf59deaf8ca` (matches the named candidate).
- `npm ci --prefer-offline` — 12 packages, 0 vulnerabilities.
- `node --test --test-concurrency=1 --test-timeout=60000 test/structure.test.ts` — 7 pass, 0 fail, including `shop manual holds review and merge ceilings`.
- Parent-vs-candidate `wc` on `templates/agents.md`; sha256 vs `templates/.history/agents.md`; phrase presence vs parent.

Not run: full `npm test`, `tsc`, biome. Unverified, not blocking.
