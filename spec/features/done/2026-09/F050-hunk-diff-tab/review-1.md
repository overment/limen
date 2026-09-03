PASS. Candidate `0c8925eff435b92983687651c82281e54fdaf3da` meets F050. Checkout HEAD matches that sha and is clean. No blocking defect.

`limen diff <id|suffix|label>` resolves a job like `open`/`jobs`, then either opens hunk or prints a copy-pasteable `git diff <base>...<branch>` and exits 0. Hunk is detected like Herdr (`PATH`, `LIMEN_HUNK`, `LIMEN_HUNK=0`); nothing else gates on it. Herdr: named tab `<label> · diff` recorded under `herdr/diff/`, second call focuses, `limen close FNNN` sweeps it with the job tab. Live running job: `hunk diff <base> --watch` from the worktree. Finished/pruned: `hunk diff <base>...<branch>` from the job repo. No TTY and no Herdr: no TUI. Fresh `versions` records `hunk <version>` when the binary probes, omits it otherwise. `templates/agents.md` step 6 tells the coordinator it may open the human's review and must keep reading text diffs.

Acceptance mapping:
- Finished + Herdr tab, refocus, close: `src/commands/diff.ts`, `src/herdr.ts` `openDiffTab` / `closeFeatureTabs`; asserted in `test/diff-command.test.ts`.
- Running watch, job left `running`: same; asserted.
- Absent hunk / `LIMEN_HUNK=0` / no TTY without Herdr: fallback line, exit 0, hunk not spawned; asserted. Scratch tests now default `LIMEN_HUNK=0`, so spawn/jobs still see only `pi …` when hunk is off.
- Versions write-only as a gate: `capturedVersions` in `src/commands/spawn.ts`; `jobs` still only prints the file (F026 display, not a runtime check).
- Spawn/review/merge without hunk: no new call sites in those paths; spawn/continue/hosted/open/finalize suites still pass.

Findings:
- None blocking.
- Note, plausible: in-place TTY `spawnSync(hunk, …, {stdio:"inherit"})` is untested. Tests are all non-TTY; Herdr covers the coordinator path.
- Note, unverified: this machine has no `hunk` on PATH. The pinned invocations (`hunk diff <base>...<branch>`, `hunk diff <base> --watch` against 0.21.0) were not re-probed here.
- Note, non-blocking: PATH detection is untested (tests use `LIMEN_HUNK=` override or `0`). Workspace `--repo` cwd for `limen diff` is untested; code does call `workspaceRepository` when `repo` is recorded. A second `limen diff` focuses an existing tab even if hunk has already exited (literal ticket text; same as `limen open`).

Checks run (real results):
- `git rev-parse HEAD` = `0c8925eff435b92983687651c82281e54fdaf3da` (matches the given candidate). `git status --short` empty.
- `node --test --test-concurrency=1 --test-timeout=60000 test/diff-command.test.ts test/structure.test.ts` — 9/9 pass.
- `test/spawn-command.test.ts test/open-command.test.ts test/continue-command.test.ts` — 22/22 pass (includes versions `pi 0.0.0-test\n` with hunk disabled, Herdr close of leftover tabs).
- `test/hosted-spawn.test.ts test/jobs-command.test.ts` — 46/46 pass (`recordPlace`/`readPlace` default path still serves hosted/watch tabs).
- `test/finalize.test.ts` — 8/8 pass (`settleJobTab` still reads only the main place; diff tabs are not auto-closed at finalize).
- `hunk --version` — not found. Live hunk UI unverified.
- `tsc --noEmit` / `biome check` — unverified. Worktree has no `node_modules`; installing is not reviewing.
- Full `test/*.test.ts` — not run. Remaining files sit outside this blast radius.

Ticket/board still ACTIVE — expected; not repaired.

Candidate commit: 0c8925eff435b92983687651c82281e54fdaf3da.
