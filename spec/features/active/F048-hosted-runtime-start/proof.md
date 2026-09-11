# Hosted startup ownership proof

The supervisor-first runtime on base `21aa683` needs no startup correction. This finish candidate changes only `test/hosted-spawn.test.ts` and this proof map. The board boundary remains startup ownership: route refusal, bot-turn receipts, reaper adoption and the parked wake candidate are untouched.

## Acceptance map

- **Caller deadline and death:** `hosted spawn survives a killed caller while agent start exceeds its 20s deadline` runs the real CLI through an isolated shell-equivalent Node caller. That caller prints the CLI's successful output and stays alive until the test observes the ID and kills it with SIGKILL. A 30s fake Herdr start and a test-only 22s readiness timeout force startup beyond the 20s caller deadline. The test requires return within 6s, a live supervisor PID, no recorded agent yet, subsequent timeout recovery on the same pane, an idle advisory while running, and terminal `done`. The production readiness timeout remains 5s. This would reject the former inline start by missing the caller deadline.
- **Asynchronous failure and wake eligibility:** the two-pane-shell-failures test sees successful spawn, `running` and a live PID before the supervisor records `failed: hosted start failed: …`. It checks `finished-at`, the subscriber, `notify/ready`, no delivered claim, and exactly two start attempts. This proves eligibility, not wake transport or a receiver turn.
- **Stop throughout startup:** existing `hosted stop before pi starts…` and `hosted stop while agent start resolves…` tests exercise the real stop command, requested reasons, no later start in the first case, and two interrupts of the appeared agent in the second.
- **Synchronous refusal:** `hosted tab creation refusal…` refuses fake tab creation, requires exit 1 and a failed planted record, and observes no supervisor PID or agent start. Limen intentionally surfaces its existing `herdr skipped opening the hosted tab` error, not Herdr's raw error text. Existing retry and non-pane-error tests preserve the one-retry boundary.
- **Continuation after caller death:** `hosted continue survives a killed caller…` delays shell readiness, observes a live supervisor after killing the caller, then sees fake Herdr read the durable continuation file. It verifies the exact bytes, `--continue @…/continue`, no `@task.md`, and terminal `done`. Existing quoted-multiline and literal-flag tests cover fresh `@task.md` transport and provider/model/thinking parity.
- **Relocated semantics:** the new moved-pane test follows the named agent to another pane without a second start and finalizes after that tab closes. The human-focus test changes focus while start is busy and requires restoration to be skipped. Existing ordinary-hosted spawn checks focus-new/start/restore-workspace/restore-origin ordering; hosted stop, open, and continuation tests remain in the focused lane.

`src/commands/spawn.ts:startHosted`, `src/supervisor.ts:startHostedAgent` and `src/herdr.ts:startHostedPi` remain the single caller/owner/start chain. `templates/agents.md` already says spawn returns quickly and the runtime focuses, starts, then restores the recorded coordinator tab. No Pi provider was contacted and no live coordinator process was killed.

## Retained evidence

Artifacts live outside this worktree at `/home/overment/limen/tmp/evidence/f048-6f76b166/`.

- `killed-caller-probe.log`: initial falsifier passed, caller killed after ID at 1036ms.
- `startup-proof-probe.log`: five passed, one failed because the new refusal assertion expected the raw Herdr error. Only that assertion was corrected; runtime code was not changed.
- `focused.log`: 87 passed, zero failed across hosted-spawn, spawn-command, continue-command and open-command. Spawn caller killed at 886ms; continuation caller at 890ms. The >20s startup, advisory and finalization assertions passed.
- `scoped-static.log`: TypeScript and scoped Biome check passed. An earlier scoped Biome check reported formatting in the new caller helper; formatting only this test file fixed it. `git diff --check` also passed.
- `candidate.txt`, `native.log`, `native.exit` and `handoff.md`: identify the clean committed candidate and retain the single post-commit native lane result and final handoff. Consult those artifacts for that result rather than treating pre-commit focused evidence as a clean-candidate full-lane claim.

Focused command: `node --test --test-concurrency=1 --test-timeout=60000 test/hosted-spawn.test.ts test/spawn-command.test.ts test/continue-command.test.ts test/open-command.test.ts`.

Post-commit native command: `npm run check` (TypeScript, repository Biome check, then the complete serial native test suite). Do not repair unrelated failures or repeat the full lane in this finish job. Review remains coordinator-owned; this proof does not authorize a merge or board change.
