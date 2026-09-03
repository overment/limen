PASS 0ae402b921ec40b9fc28585d6746f7a60f9e8f09

HEAD matches the candidate (`0ae402b921ec40b9fc28585d6746f7a60f9e8f09`). No prior `review-*.md`. No blocking findings.

The third drift kind is `stale` on the four tracked overlays. Git history wins when the package root has `.git`; `templates/.history/<file>` wins when it does not. Leftover stays byte-identity with the current package file. `limen init --drop-leftovers` still deletes only leftovers. Drift text names both dates and that deleting inherits the package.

**Notes**

- PLAUSIBLE, not blocking: `revisionCache` is process-global mutable state (`hook/inherit.ts`). The ticket asked for a per-process cache; if the host reloads the hook module each turn the cache does not survive.
- PLAUSIBLE, not blocking: a dirty working tree whose disk template differs from HEAD can classify a copy of HEAD as `stale` with `matchedAt === changedAt`. Published packages without `.git` are unaffected.
- History regeneration is `LIMEN_WRITE_HISTORY=1` on `test/inherit.test.ts`, not a separate templates script. The same test asserts the shipped lists equal `git log`/`git show`; `test/structure.test.ts` only asserts the first hash equals the current file.

**Checks**

- `git rev-parse HEAD` → `0ae402b921ec40b9fc28585d6746f7a60f9e8f09`
- `npm ci` from `package-lock.json` → 12 packages, 0 vulnerabilities
- `node --test --test-concurrency=1 --test-timeout=60000 test/inherit.test.ts test/communication-hook.test.ts test/init-command.test.ts test/structure.test.ts` → 19 pass, 7 fail
  - Pass, F054 acceptance: git three-way classify; nongit hash-list three-way classify; shipped history matches this clone; stale line in the per-turn drift section; `limen init` names stale and `--drop-leftovers` leaves it; structure lists `templates/.history/{agents,communication,reviewer,worker}.md`
  - Fail, environment not candidate: 7 pre-existing tests in `test/communication-hook.test.ts` that do not clear `LIMEN_JOB` / `LIMEN_CONTEXT_ROOT`. This review job has both set; leftover drift named this worktree’s `.agents/limen/worker.md` overlay and the audience was `agent`. The new stale test clears those vars and passed. Not re-run.
- `npm pack --dry-run`: `templates/.history/{agents,communication,reviewer,worker}.md` are in the pack (57 files)
- Full `npm test` / typecheck / biome: not run
