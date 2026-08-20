# F030 review · PASS

Candidate `4e211c93ce9645c392245aa023172da5198f74d8` implements `F030-hosted-stall-handoff` against `spec/features/active/F030-hosted-stall-handoff/ticket.md`. Checkout matches that SHA. No blocking defect found.

`noteHostedIdle` snapshots `result` + `commits` before writing `advisory`; `state` stays `running`; no `finished-at`. `sendAdvisory` appends `handoffExcerpt` and still leads with “still running”. Stall clock for Herdr `idle`/`done` runs only while `activity` is `wait`; `blocked` stays immediate; zero tools still do not advisory. Default `LIMEN_HOSTED_IDLE_MS` is 60s; env still overrides. Later `session-ended` still finalizes `done`; advisory claim does not block the completion wake.

## Findings

None blocking.

Non-blocking:

- **proven, non-blocking** — ticket still says `noteHostedIdle` snapshots *after* it writes `advisory` (`spec/features/active/F030-hosted-stall-handoff/ticket.md` Scope). Code in `src/proc.ts` writes `writeHostedResult` + `recordCommits` *before* `advisory`. That order is the one that makes the wake carry the excerpt (`hook/wake.ts` `sendAdvisory` reads files at claim time).
- **proven, non-blocking** — the same commit restates ticket scope/acceptance (“Wait means stall”, activity=`wait` on the idle acceptance line). Intent was already in the pre-candidate ticket (“Thinking is not idle”); not a scope change.
- **plausible, non-blocking** — snapshot and wake are proven on separate seams, not one live supervisor+hook loop. `test/hosted-spawn.test.ts` proves `advisory`+`result`+`commits` on a fake hosted agent; `test/wake-hook.test.ts` proves the excerpt by planting those files, then writing `advisory`.

## Checks

| Check | Result |
|---|---|
| `git rev-parse HEAD` | `4e211c93ce9645c392245aa023172da5198f74d8` (matches task) |
| `git status` | clean |
| `node --test --test-concurrency=1 --test-timeout=60000 test/hosted-spawn.test.ts test/wake-hook.test.ts` | 45/45 pass (idle default 60s; think/tool ignored; snapshot without finalize; supervisor advisory+result+commits+still running then session-end `done`; advisory wake carries excerpt and does not block completion) |
| `node --test … test/structure.test.ts` | 4/4 pass |
| `biome check` on `hook/wake.ts` `src/proc.ts` `test/hosted-spawn.test.ts` `test/wake-hook.test.ts` | clean (used main-repo biome binary) |
| `tsc --noEmit` / `npm run check` | **unverified** — worktree has no `node_modules`; `tsc` → `TS2688` missing `@types/node`. Not repaired. |

Acceptance mapped: idle after ≥1 tool past a short env bound while `activity` is `wait` → `result` last assistant jsonl text, `commits` branch-since-base, `advisory` written, wake includes excerpt, `state` running; think/tool idle does not advisory; `blocked` immediate even when `activity` is `tool`; `LIMEN_HOSTED_IDLE_MS=200` used by the supervisor test; session-end after advisory still `done`. No path marks the job terminal from stall.

## Next

Coordinator can file this as PASS and merge. Run `npm run check` where deps are installed if that gate matters before merge.

Candidate commit: 4e211c93ce9645c392245aa023172da5198f74d8.
