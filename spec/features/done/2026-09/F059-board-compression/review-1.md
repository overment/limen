PASS 2e230531ecc8b7601b3d9fffa3e42ddc41921bf8

Reviewed `2e230531ecc8b7601b3d9fffa3e42ddc41921bf8` (`feat: fold older proven board entries into monthly highlights`) against `spec/features/active/F059-board-compression/ticket.md`. `git rev-parse HEAD` matched that sha.

No blocking findings. Every acceptance bullet holds.

**Acceptance (proven)**
- `templates/spec/build.md` states the ten-entry PROVEN window and shows one month line by example (`2026-08: 40 landed` plus three product highlights and `spec/features/done/2026-08/`).
- `templates/agents.md` step 7 names the fold, the ten-entry window, and “rewrite the month line, never append”.
- `test/communication-hook.test.ts` writes an 80-line board (no advisory) and a 130-line board (one per-turn line, not in the system prompt); that test passed.
- The month example is a single line, so forty landed features occupy one line when the template is followed.
- Structure and communication-hook suites passed (26 tests, 0 fail).

Out of scope was respected: no board-shape parser, project `spec/build.md` untouched, outcome files untouched. The F053 NOW/NEXT digest path is unchanged; the advisory is informational on the coordinator cue.

**Notes**
- PLAUSIBLE: `boardAdvisory` runs only on coordinator turns (`if (!job)`), same as drift. A worker never sees the fold hint. That matches “never edit the board”; the ticket’s 80/130 test is coordinator-only and passed.
- The `templates/.history/agents.md` hash bump is required by the structure suite after editing `templates/agents.md`.

**Checks**
- `git rev-parse HEAD` → `2e230531ecc8b7601b3d9fffa3e42ddc41921bf8` (matches the candidate).
- `npm ci` from `package-lock.json` → added 12 packages, 0 vulnerabilities.
- `node --test --test-concurrency=1 --test-timeout=60000 test/structure.test.ts test/communication-hook.test.ts` → 26 pass, 0 fail.
- Not run: `tsc`, biome, the rest of `test/*.test.ts` (unverified, not blocking).
