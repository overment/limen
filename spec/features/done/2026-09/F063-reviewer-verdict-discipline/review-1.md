PASS f556f14fe2d06e1ebc6da13b4e49aeb5188ed796

No blocking findings. The reviewer birth prompt now opens `PASS <sha>` or `FAIL <sha>`, blocks only a proven acceptance-bullet break, and installs from the lockfile instead of failing the environment. Structure-test phrases and both forbidden strings match; the implement session's probes produced the two required verdict shapes.

**Notes**

- Proven, non-blocking: this review worktree has no `node_modules`. `test/structure.test.ts` needs none. `tsc`, Biome, and the full suite were not run.
- Proven, non-blocking: the live fixture `/tmp/f063-env-probe` had no runtime packages, so `npm ci` was protocol rather than recovering a missing tree. The probe still installed from the lockfile, ran `node --test test.js` (1 pass), and returned PASS rather than FAIL.

**Checks**

- `git rev-parse HEAD`: `f556f14fe2d06e1ebc6da13b4e49aeb5188ed796` (matches the given candidate); worktree clean.
- Diff `0ca863a..HEAD`: `templates/reviewer.md`, `test/structure.test.ts`, `spec/features/active/F063-reviewer-verdict-discipline/notes.md`.
- Template contains each scoped rule (verdict on line one, one word with the sha, nothing before it, PASS carries notes, blocking = acceptance bullet, PLAUSIBLE never blocking, unverified never blocking, install from the lockfile, re-review bounded by the findings file, feature-folder files outside the diff, one full proof, transient failure reported as transient) and no longer contains `installing is not reviewing` or `only when no substantive finding remains`.
- `node --test test/structure.test.ts`: 5 pass, 0 fail (139ms).
- Model probes not re-run. Verified against implement job `2026-09-03-f063-reviewer-d0e441a9` session: isolated `pi -p --no-tools` with `templates/reviewer.md` appended → `FAIL 1111111111111111111111111111111111111111` with one blocking acceptance defect and one lint note; live `pi -p --tools read,bash` in `/tmp/f063-env-probe` → `npm ci` then `node --test test.js`, first line `PASS 43ba801d3e6f90419e05d3bc89f8afc9296766b8`.

Candidate commit: f556f14fe2d06e1ebc6da13b4e49aeb5188ed796.
