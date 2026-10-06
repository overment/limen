# F929 lead notes

- Lead job: `2026-10-06-f929-implement-group-lead-684a332e` (wrapper pid 65328). It is a Limen job, so `group start` refuses it under `LIMEN_JOB=1` (same workaround as F925 and F927). `/tmp/f929-lead/heartbeat.sh` refreshes `.limen/group-leads/f929-lead-684a332e` every 10 seconds while pid 65328 lives. Every lead group command runs through `/tmp/f929-lead/lg`, which unsets the job env and sets `PI_SESSION_ID=f929-lead-684a332e`.
- Stage 0: the safe package landed from the earlier F928 lead job at `7294398`. The lead then ran the reformat itself (lines at most 120, braces everywhere) and landed it with this packet at `a34d21d`, so no team rebases across 104 reformatted files. Team 1 took the shared flag module and the smaller parsers instead.
- Group id: `4d25b7d3-7d94-45ff-bcca-4a400e8adba7`, started 18:45 CEST, 5 h, workers 3 h. Coordinators: team-1 `…-eb133d62`, team-2 `…-33a7f92d`, team-3 `…-8e0a7e13`, team-4 `…-0cc83596`.
- Lead scripts: `/tmp/f929-lead/check.sh <ref>...` merges one or more candidates onto `main` in a scratch worktree and runs tsc, `biome check --error-on-warnings`, `npm test` (skipped with `SKIP_TEST=1` for a comment-only or CSS-only diff), the ticket check and the strict picture build; `/tmp/f929-lead/land.sh <ref> <message>` merges with `--no-ff` into the plant checkout and pushes; `/tmp/f929-lead/next.sh N` waits up to N minutes for a candidate or question; `/tmp/f929-lead/same-ast.mjs <repo> <ref>` compares changed scripts token by token after normalizing braces, parentheses and trailing commas.
- `limen ticket check` reads its target branch from `LIMEN_CONTEXT_ROOT` or the current checkout. In a scratch worktree it needs a named branch and `LIMEN_CONTEXT_ROOT` set to the plant; `check.sh` does both.

## Rulings

- One flag rule set for every command (`src/commands/flags.ts`). Input with one error keeps its exact message. Input with several errors may report a different one first. `--flag=value` is newly accepted; an inline empty value (`--model=`) now says `--model requires a value`. The keeper command went back to its pre-sample answers for `-j`, `--job -x` and `--bogus=1`.
- A command keeps a hand-written check when `parseFlags` would change what it accepts; `notes.md` names each one with its reason.
- Complexity suppressions use neutral reasons and never promise work by a named team.
- Land order: the complexity policy is generated from the tree, so it landed under a short freeze and every later candidate rebased onto it.
- No message-pinning tests: behavior was shown with throwaway main-versus-branch probes outside the repository. `test/` grew by one line (a suppression).

## Findings

- Under load 70 to 80 (eight agents plus checks), `npm test` took 136 to 435 s instead of about 80 s, and two tests failed now and then on `main` too: s8 "close refuses a member with uncommitted work" (`group stop` exits 1) and s3 "a job that ends done, failed or on a provider error" (180 s timeout). Both passed alone and on reruns. Candidates whose only failure was one of these landed with that stated in the merge message.
- Team 4's 148-case CLI probe (`/tmp/f929-team4/probe.mjs`) on `a34d21d` versus `69a6f36`: 8 cases differ, all `--flag=value` forms or an inline empty value.
- The built picture of this plant was byte-identical before and after the picture-code changes apart from the tip SHA; the viewer CSS reorder left computed styles identical for all 525 elements of the default view.
- Team 2's coordinator ended failed after its worker ended done. The seven committed splits through `c09c72c`, the clean group command split at `27b9e44`, and the worker's unfinished sweep edit (completed and committed as `ca77824`) landed together at `6d294d2`. The only merge conflict was the old exemption table from the group branch; the current table has 33 functions and 41 suppressions. The integration passed tsc, Biome with warnings as errors, `npm test` 68/68 in 206 seconds, ticket check and strict picture build. Main was pushed.
- An isolated sweep smoke used a fake Herdr binary, one old terminal job and one job with a delivered completion receipt. Two sweeps emitted exactly one notification, for the undelivered job. Group status ran with the new command split, then `limen group close` completed; status reports `Closed: yes` and all worktrees clean.
