# F023 review of `9f43458`

**PASS.** Candidate `9f43458cb8684768194c11a026d6d721c6e6878a` matches the checkout (`git rev-parse HEAD`). It does what `spec/features/active/F023-wake-quiet-fallback/ticket.md` asks: fallback disqualifies on any `delivered/` slot, a busy session, or mute *before* `notify/claims` is touched; watcher events under `notify/claims/` and `notify/delivered/` do not schedule a sweep; terminal Herdr toasts sit behind `muted`; `session_start` walks to the nearest `.agents/limen` and watches that root’s `.limen/jobs`. Claim protocol and wake text are unchanged.

Prior job `2026-08-19-f023-review-b129961b` wrote no findings file and no verdict (worktree pruned mid-review). This is a first review, not a re-check of earlier blockers.

## Findings

None blocking.

Non-blocking observation (not a ticket miss): `projectRoot` walks to the nearest ancestor `.agents/limen` and never calls git. `limenRoot` in `src/git.ts` is `workspaceRoot(cwd) ?? repoRoot(cwd)` and does not walk. They agree on the accepted case (`<root>/src` with `.agents/limen` at `<root>` of a git repo). They can disagree for a nested git child under a parent that also has `.agents/limen`. Ticket specified the walk and forbade git in the extension. `/Users/overment/.agents/limen` does not exist on this machine, so a home-directory attach was not demonstrated.

## Ticket seams vs diff

| Acceptance | What the candidate does | Evidence |
|---|---|---|
| Delivered foreign slot → zero `notify/claims` across sweeps | `sendCompletion` returns on `deliveredSlots(job).length > 0` before `claimDelivery` | `already-delivered jobs never re-enter the fallback claim path` passed (1618 ms watch) |
| Undelivered old job still falls back once | Existing F004 test untouched | `subscriptions scope wakes and one idle coordinator receives fallback` passed |
| Mute silences Herdr `notification show`; unmute delivers once | `observe` returns on `muted` before `notifyHerdr`; unmute `sweep()` delivers toast + wake | `herdr surfaces stay live while the conversation is muted` passed |
| Coordinator started in `<root>/src` still wakes | `projectRoot(context.cwd)` + `join(root, ".limen", "jobs")` | `wake finds the project root from a subdirectory` passed |
| Watcher ignores bookkeeping | `notifyBookkeeping` drops `notify/(claims\|delivered)` | No isolated unit test; loop is killed by the pre-claim filter; 500 ms timer still sweeps |

`hook/steering.ts` still keys off `LIMEN_CONTEXT_ROOT` only — correct per ticket.

## Checks run

| Check | Result |
|---|---|
| `git rev-parse HEAD` | `9f43458cb8684768194c11a026d6d721c6e6878a` (matches named candidate) |
| `git status --short` | clean |
| `node --test test/wake-hook.test.ts` | 14/14 pass |
| `tsc --noEmit --typeRoots <main-repo>/node_modules/@types` | pass (worktree has no `node_modules`; literal `tsc --noEmit` fails `TS2688` missing `@types/node`) |
| `biome check .` | pass (46 files) |
| `biome check hook/wake.ts test/wake-hook.test.ts` | pass |
| Full `node --test test/*.test.ts` with `LIMEN_JOB` / `LIMEN_CONTEXT_ROOT` unset | 101 pass, 1 fail |
| Same suite *with* this job’s env (`LIMEN_JOB=1`, `LIMEN_CONTEXT_ROOT=/Users/overment/.overment/limen`) | 93 pass, 9 fail — 8 are `communication-hook` reading the live cabinet; not a candidate defect |
| `sleeping descendant discovery delays timeout only through its short bound` (`test/stop-command.test.ts:228`) | fail twice (~3.0s, ~3.9s vs `< 2000ms`). Not in the F023 diff (`hook/wake.ts` + `test/wake-hook.test.ts` only). Sibling stop-bound test passed. |

Literal `npm run check` was not executed (`npm run check` = tsc + biome + tests; worktree has no `node_modules`). Equivalent pieces above. The stop timing failure is unrelated F007 load/flake on this seat, not an F023 regression.

Candidate commit: 9f43458cb8684768194c11a026d6d721c6e6878a.
