**PASS.** Candidate `afea1eba03412985032647174ae69fc22e4dd99c` meets F018. Checkout HEAD matches the given candidate commit. No blocking defect.

F018-review-handoff: `limen spawn --review --branch <b>` writes `.limen/jobs/<id>/candidate` (`git rev-parse refs/heads/<b>`, equivalent to the ticket’s `git rev-parse <b>` after `branchExists`) and appends `Candidate commit: <sha>.` as the last line of `task.md`. Non-review spawns write neither. `limen jobs <id>` prints `candidate <sha>`. Verdict filing and re-review remain convention in `templates/agents.md` steps 5–6 / Recovery and `templates/reviewer.md`; no harness write of `review-<n>.md`, no prior-review auto-attach.

Acceptance mapping:
- Mechanical candidate + last line of `task.md`: `src/commands/spawn.ts`, `src/git.ts` `branchCommit`.
- Non-review writes no `candidate`: same spawn path; asserted.
- `limen jobs <id>` candidate line: `src/commands/jobs.ts`.
- Shop-manual repair/re-review examples name a findings file and a commit; reviewer final message is filed verbatim.
- `--tab` + `--review` still refused (untouched).

Checks:
- `git rev-parse HEAD` = `afea1eba03412985032647174ae69fc22e4dd99c` (matches task `Candidate commit`).
- `node --test --test-timeout=30000 test/spawn-command.test.ts test/structure.test.ts test/workspace-command.test.ts` — 16/16 pass, including `review gets fresh detached worktree and reviewer birth text` (candidate file, exact `task.md`, no worker `candidate`, `jobs` line).
- `/home/overment/limen/node_modules/.bin/biome check .` — pass (46 files).
- `npm run check` — **unverified**. This worktree has no `node_modules`; `tsc` not on PATH (`sh: 1: tsc: not found`). Borrowed `tsc --noEmit` failed `TS2688` missing `@types/node` for the same reason.
- Full `node --test test/*.test.ts` — 87 pass, 9 fail. Eight `test/communication-hook.test.ts` failures are this review job’s `LIMEN_*` env leaking into hook tests; rerun with those vars unset: 11/11 pass. One `test/stop-command.test.ts` timeout bound (`sleeping descendant discovery delays timeout only through its short bound`) failed under the 170s suite; sibling stop-bound test passed. Not in the F018 blast radius.

Non-blocking: `test/structure.test.ts` src budget 2200→2250 though `src/` is 2162. Re-review example names `<prior-sha>` (old tip) plus findings file; the new sha is the harness last line, not the spawn sentence.

Ticket/board still ACTIVE — expected; not repaired.

Next: coordinator files this message as `spec/features/active/F018-review-handoff/review-1.md` and merges with ordinary Git if accepted. `npm run check` still needs a worktree with `node_modules`.
