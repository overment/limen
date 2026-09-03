PASS b220dcfc06826ae493427bae61612a012f1a1319

HEAD matched the candidate (`b220dcfc06826ae493427bae61612a012f1a1319`, `feat: hosted workers end with a finish tool`). No prior `review-<n>.md` bound this pass.

The four acceptance bullets hold in the code that landed:

- Hosted `finish` (`hook/hosted.ts`) writes `result` from `handoff` and calls `ctx.shutdown()`. Pi defers that until idle, then emits `session_shutdown`; the existing handler writes `session-ended`; the supervisor still finalizes `done` with `hosted session ended`. `writeHostedResult` keeps a tool-written result over later assistant text. `finalizeJob` still closes the tab via `settleJobTab`.
- `limen stop` with a reason beginning `done:` records `done` through `requestedTerminal`. The stopping session is marked delivered at `notify/delivered/<PI_SESSION_ID>` before finalize; `claimDelivery` in `hook/wake.ts` no-ops when that slot exists.
- `noteHostedIdle` returns `hosted session ended` when `last-turn-tools` is `0`, the worktree is clean, and idle is past the threshold; it writes no advisory. The supervisor loop uses that return as the finalize reason.
- `templates/worker.md` names `finish` and no longer contains `quit pi`; `templates/agents.md` no longer steers a hosted worker to quit.

**Notes**

- PLAUSIBLE — this repo’s overlay `.agents/limen/worker.md` still says “quit pi”. `spawn` prefers that file over `templates/worker.md`, so hosted workers started inside this repository are not told to call `finish`. The tool still registers; the idle backstop still applies. Outside the diff; not an acceptance miss (`templates/worker.md` is what the ticket named).
- UNVERIFIED — no single test drives finish → `done` + tab close + exactly one completion wake. The pieces are covered separately (hook unit, result-preserve unit, existing session-end hosted test, wake stop-silence test). Not a proven break.
- PLAUSIBLE — detached `limen stop … done:` can still land `stopped` if the wrapper finalizes first (`finalizeJob(..., "stopped", "process group interrupted")` on SIGTERM). Detached is out of scope; the passing detached test uses `stubbornPi`, so the wrapper never wins.
- PLAUSIBLE — `stop` mkdir’s the delivered slot before the agent is confirmed down. A failed hosted stop (`agent is still up`) would swallow that session’s later completion wake. The stubborn-stop test does not set `PI_SESSION_ID`.
- PLAUSIBLE — worker.md says only `finish` ends a hosted job; the idle backstop also does, including a text-only last turn with a clean worktree (a question with no edits). That matches the ticket, not the template sentence.

**Checks**

- `git rev-parse HEAD` → `b220dcfc06826ae493427bae61612a012f1a1319`
- `npm ci` from `package-lock.json` → 12 packages, 0 vulnerabilities
- `test/hosted-hook.test.ts` → pass (finish writes handoff, shutdown, `last-turn-tools` 0/1)
- `test/hosted-spawn.test.ts` → all pass, including result-preserve, idle backstop, `hosted stop with a done: reason records done`
- `test/wake-hook.test.ts` → 36 pass, including `a stop-marked session receives no completion wake`
- `test/structure.test.ts` → pass (`finish` present, no `quit pi`)
- `test/stop-command.test.ts --test-name-pattern 'stop with a done'` → pass
- `npx tsc --noEmit` → pass
- Packed `stop-command` run was cut off at 180s after an unrelated ✖ on `sleeping descendant discovery delays timeout only through its short bound` (timeout/exhaustion, not this diff). Not rerun. Unverified, not blocking.
