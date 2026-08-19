# F020 re-review · `2ef9f40`

Candidate commit: `2ef9f40ad6d6fc841101daf8497a793b9421c209`  
Checkout matches (`git rev-parse HEAD`). Prior job `2026-08-19-f020-review-8862aa28` exited 0 with no verdict and no `review-*.md`; nothing previously blocking to re-verify.

## Verdict

**PASS.** No substantive defect against `spec/features/active/F020-herdr-agent-truth/ticket.md`.

## Acceptance (proven)

| Requirement | Evidence |
|---|---|
| Nested 0.8.0 envelope → `working`/`idle`/`blocked`; flat fallback still works | `hostedAgentStatus` reads `asRecord(row.agent).agent_status ?? row.agent_status`. Isolated test passed. |
| One non-not-found `agent get` failure does not finalize | Supervisor only increments `missingStreak` on `"missing"`. Blip test still `running` after 4s. |
| Three consecutive `agent_not_found` finalize `done: hosted agent ended` | Vanish fixture: 1× `working` then `agent_not_found` forever. Existing spawn test finalized in 5.4s (fits 3-sample debounce). |
| Garbage / nonzero non-not-found never counts as `missing` | `call` attaches `error.code`; only `agent_not_found` / `target_not_found` → `missing`. Garbage + timeout tests stayed `running`. |
| Hook `tool` is not overwritten to `wait` | Supervisor no longer writes `activity`. Activity test still `tool` after 1.5s. |
| `ctrl+c` recorded and used | `notes.md` has the probe; `stopHostedAgent` sends `ctrl+c`; unit test asserts the argv. |
| Probe hygiene | `liveHostedTarget` matches exact `pi` / `node` only. |

Live Herdr 0.8.0 this session: `herdr agent get no-such-agent-f020-review` → stderr `{"error":{"code":"agent_not_found",...}}` exit 1. `call` reads stderr first, so the code survives.

## Findings

None blocking.

Non-blocking, not acceptance failures:

- **plausible, non-blocking.** `call` drops `error.code` when the parsed error has no `message` (`message` falls back to the raw JSON, the inner catch then swallows the coded throw). Herdr 0.8.0 always sends `message` (live probe). Fake fixtures do too.
- **unverified as a single script.** Worktree has no `node_modules`; `npm run check` was not run as one command. Equivalent pieces below are green. Full parallel `test/*.test.ts` not re-run (prior review; do not re-litigate timing under load).

## Checks

| Check | Result |
|---|---|
| `git rev-parse HEAD` | `2ef9f40ad6d6fc841101daf8497a793b9421c209` |
| `node --test test/hosted-spawn.test.ts` (LIMEN_*/HERDR_* unset) | 10/10 pass, 29.3s |
| `node --test test/structure.test.ts` (same clean env) | 4/4 pass, src line budget holds |
| `tsc --noEmit --typeRoots <main-repo>/node_modules/@types` | clean (worktree has no `@types/node`) |
| `biome check` on `src/herdr.ts` `src/proc.ts` `test/hosted-spawn.test.ts` | clean |
| Live `herdr agent get` missing target | stderr JSON, `code=agent_not_found`, exit 1 |
| Full `npm run check` | **unverified** (no worktree `node_modules`) |

Candidate commit: 2ef9f40ad6d6fc841101daf8497a793b9421c209.
