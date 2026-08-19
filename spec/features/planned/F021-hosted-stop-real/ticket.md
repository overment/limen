# F021-hosted-stop-real · Stopping a hosted job actually ends the agent, or says it could not

[2026-08-19] [🔴] [PLANNED] [COORDINATOR] PLANNED · F021-hosted-stop-real

## Outcome

`limen stop` on a hosted job either ends the pi session and records `stopped`, or truthfully reports that the agent is still up and leaves the record `running`. A job record never says `stopped` while a live agent keeps committing to the branch. Hosted agent names never collide because a long label swallowed the random suffix.

Observed cost today (2026-08-18 review, findings C3/S5/M5): `stopCommand` sends a single `C-c`, SIGTERMs the supervisor, waits 50 ms, and finalizes `stopped`. Pi's keybinding for `ctrl+c` is "Clear editor (first) / exit (second)" — one press never exits, so the agent lives on with no supervisor watching, and the now-terminal record makes the next spawn's prune eligible to remove the worktree under it. The test fake models `send-keys` as ending the agent, validating the optimistic story. Separately, `hostedAgentName` slices `limen-<id>` to 32 chars, so a label slug ≥18 chars starts truncating the 8-hex suffix and ≥26 erases it; on collision, `agent start` fails and the recovery probe latches the new job's supervisor onto the *old* live agent by name.

## Scope

- **Stop is a request, not a verdict.** `stopCommand`'s hosted path writes the reason durably (e.g. `.limen/jobs/<id>/stop-requested`), sends the interrupt twice with a short gap (spelling per F020's probe; two presses because pi exits on the second), and does not SIGTERM the supervisor and does not finalize on a timer.
- **The supervisor finalizes from observation.** `runHostedSupervisor` keeps polling; when the agent goes `missing` (debounced per F020) or `session-ended` appears, it finalizes `stopped: <requested reason>` when `stop-requested` exists, `done` otherwise.
- **Truthful failure.** If the agent is still alive ~15 s after the request, the CLI prints that the agent did not exit and that closing the tab ends it; state stays `running`. No fabricated `stopped`.
- **Supervisor-dead fallback.** If the supervisor process is gone (crash, reboot), `stop` may finalize directly — after confirming the agent target is `missing` — so a genuinely dead hosted job can still be closed out by hand.
- **Name entropy.** `hostedAgentName` becomes `limen-<slug sliced to 17>-<hex8>`: the slug is what truncates, never the suffix. `startHostedPi`'s failure recovery must not adopt an agent whose name matches but whose pane differs from the one just created.
- **Timeout honesty.** `--tab` (or an implied hosted spawn) combined with `--timeout` is an error naming the fact hosted jobs have no timeout, instead of silently ignoring the flag.

## Out of scope

- Herdr envelope parsing, missing-debounce policy, key-name probing — F020, which lands first.
- Force-killing the pane or its process tree through Herdr; the tab remains the human's surface.
- Detached stop semantics (see F024 for finalize idempotence).
- Any timeout or tool-call cap for hosted jobs.

## Acceptance

- Against a fake Herdr whose agent exits only after two interrupts: `limen stop` ends with the supervisor recording `stopped: <reason>`; the record never passes through a premature `stopped` while the fake agent is alive.
- Against a fake agent that ignores interrupts: `stop` reports the agent is still up, exits nonzero or with a clear message, and the record stays `running` with `stop-requested` and the log line present.
- With the supervisor process killed and the agent absent, `stop` finalizes `stopped` directly.
- Two hosted spawns whose labels share a ≥26-char slug produce distinct agent names; the second `agent start` does not collide, and no supervisor ever records another job's agent as its target.
- `limen spawn --tab --timeout 20m …` errors before creating any job record.
- `npm run check` green.

## Notes

Seams: `stopCommand` hosted branch in `src/commands/stop.ts`; `stopHostedAgent`, `startHostedPi`, `liveHostedTarget`, `hostedAgentName` in `src/herdr.ts` and `src/commands/spawn.ts`; `runHostedSupervisor` in `src/proc.ts`; the fake herdr in `test/hosted-spawn.test.ts` (its `send-keys` handler currently flips the agent to `done` on one press — model the two-press reality instead). Pi keybinding evidence: `docs/keybindings.md` in the pi package, `app.clear`: "ctrl+c — Clear editor (first) / exit (second)". Depends on F020.
