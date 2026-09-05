PASS 85d57d24309fc4cf878f7875edb616dc7e941106

Reviewed `85d57d24309fc4cf878f7875edb616dc7e941106` (`feat: proof belongs to the commit it proves`) against `spec/features/active/F077-evidence-outlives-the-worktree/ticket.md`. `git rev-parse HEAD` matches. Worktree porcelain empty.

Retained evidence at `/Users/overment/.overment/limen/tmp/evidence/F077/candidate` is this commit (`HEAD` and `commit.txt`), `dirty: false`, empty `status.porcelain`. Did not rerun a JS lane.

**Acceptance**

- Phrases required by `test/structure.test.ts` (`proof belongs to the candidate and outlives the worktree`) are in `templates/worker.md`, `templates/agents.md`, and `templates/reviewer.md` (independent lowercase search). Proven.
- Length vs parent `e52b1a4` (Python char counts, same method as `length.txt`): `templates/worker.md` 4289 / 4186 (+2.5%, cap 4604); `templates/agents.md` 27503 / 27372 (+0.5%, cap 30109); `templates/reviewer.md` 2889 / 2762 (+4.6%, cap 3038). Byte counts also under +10%. Proven.
- Structure/inherit at this tree: retained `proof.txt` records `node --test test/structure.test.ts test/inherit.test.ts` → 23 pass, 0 fail, including the new proof test and `shipped template history matches git log/show of this clone`. Independently, SHA-256 of the three templates equals the first line of each `templates/.history/*` file. Proven via retained clean-tree proof plus hash check. Structure test not re-executed here.
- Board line (`F077-evidence-outlives-the-worktree`): diff is those three templates, their `.history` lines, and the structure phrases. No artifact store.

**Notes (not blocking)**

- Plausible: the `limen spawn --review` example in `templates/agents.md` still does not include a retained-evidence path. The added sentence obliges the handoff to carry it; a coordinator who pastes only the quoted command will not. This job’s task did carry `/Users/overment/.overment/limen/tmp/evidence/F077/candidate`.
- Plausible: `templates/worker.md` dropped “again only if that commit changed”. A follow-up commit after the post-commit lane is no longer told to re-prove.
- The reviewer phrase `"is unverified"` already existed; the new sentence is present as a whole (`different commit or a dirty tree` / `not a finding against the candidate`).
- Retained full lane (`npm run check` in `proof.txt`): tsc and biome pass; 267 tests, 265 pass, 2 fail in `test/continue-command.test.ts` and `test/finalize.test.ts` (running-job / `finished-at` races, not this diff). First attempt timed out at 600s; completed run ~1013s. Not re-run; those failures are not a finding against this candidate.

**Checks run**

- `git rev-parse HEAD` → `85d57d24309fc4cf878f7875edb616dc7e941106`
- Inspected retained evidence (HEAD, commit, stat, length, proof, porcelain)
- Independent phrase search on the three templates
- Independent char/byte lengths vs `e52b1a4`
- Independent SHA-256 vs `templates/.history` heads
- Not run: lockfile install, `node --test`, `npm run check`
