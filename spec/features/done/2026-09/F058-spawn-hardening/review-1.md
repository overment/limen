PASS 17fee8db5377764d1311f26d0ddc28aa18e2a0f3

No blocking acceptance break. `git rev-parse HEAD` is `17fee8db5377764d1311f26d0ddc28aa18e2a0f3`, matching the candidate. Against `spec/features/active/F058-spawn-hardening/ticket.md`, `--task-file`/`-` writes `task.md` bytes untouched, git is retried once on `ENOENT` then falls back to an absolute path before `mkdir` of the job dir, `LIMEN_PREPARE`/`--prepare` runs in the worktree before Pi and is logged without failing spawn, `limen jobs` names a stateless dir `ORPHAN`, and `limen prune` deletes it.

**Checks run**
- `git rev-parse HEAD` → `17fee8db5377764d1311f26d0ddc28aa18e2a0f3` (matches candidate)
- `npm ci` from `package-lock.json` → added 12 packages, 0 vulnerabilities
- `node --test --test-concurrency=1 --test-timeout=60000 test/spawn-command.test.ts test/prune-command.test.ts test/jobs-command.test.ts` → 33 pass, 0 fail, 87660ms

Not run (unverified, not blocking): full `npm test`, `tsc --noEmit`, biome.

**Notes (plausible, not blocking)**
- `src/git.ts` `git()` treats any spawn `ENOENT` (including a missing `cwd`) as missing git, and once `gitBin` is cached as `"git"` a later PATH miss will not try `/usr/bin/git` and friends.
- `--review --task-file` keeps `task.md` byte-identical, so it does not append `Candidate commit:`; `.limen/jobs/<id>/candidate` is still written.
- `limen prune` counts deleted orphan job dirs in `pruned N finished worktree(s)`.
- Concurrent `limen prune` between `mkdir(jobDir)` and `atomicWrite(state)` can delete an in-flight spawn; the try/catch only wraps the writes and prepare.
