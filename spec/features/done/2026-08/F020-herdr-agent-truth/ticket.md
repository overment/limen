# F020-herdr-agent-truth · The harness believes what Herdr actually answers about a hosted agent

[2026-08-19] [🟢] [PROVEN] [COORDINATOR] PROVEN · F020-herdr-agent-truth

## Outcome

Hosted status read from Herdr matches reality: a working agent reads `working`, not `unknown`; a transient CLI failure does not read as a vanished agent; and the fake Herdr in tests answers with the real envelope so this class of drift fails CI instead of production.

Observed cost today (2026-08-18 review, findings A1/S1): a live probe of `herdr agent get` (Herdr 0.8.0) returns `{"result":{"agent":{"agent_status":"working", …}}}`, but `hostedAgentStatus` in `src/herdr.ts` reads `result.agent_status` — always undefined — so every live agent reads `unknown`. The supervisor therefore stamps `wait` into `activity` every second, overwriting the truthful `think`/`tool` the in-pane `hook/hosted.ts` writes, and the `working → think` mapping is dead code. Separately, any CLI failure (Herdr restart, timeout) maps to `missing`, and one 1-second sample of `missing` finalizes the job `done: hosted agent ended` while pi still runs. The fixture in `test/hosted-spawn.test.ts` returns `agent_status` flat, so the suite is green while production misreads.

## Scope

- **Envelope.** `hostedAgentStatus` reads `result.agent.agent_status`, keeping the flat read as a fallback for older Herdr. `test/hosted-spawn.test.ts`'s fake answers `agent get` with the nested envelope Herdr 0.8.0 actually returns.
- **Error classification.** `call` failures carry Herdr's error code (`agent_not_found`, …). Only `agent_not_found` (and equivalent target-resolution failures) mean the agent is gone; any other failure means "Herdr unreachable — keep the last known status" and is logged once per transition, not per poll.
- **Missing debounce.** `runHostedSupervisor` in `src/proc.ts` finalizes on `missing` only after 3 consecutive samples (~3 s). `session-ended` stays immediate.
- **Activity truth.** With real statuses available, decide the writer: the supervisor stops stamping `activity` when the in-pane hook is alive (its writes are fresher), or maps `working → think` correctly. Either way, a hosted worker mid-edit must not display `wait`.
- **Probe hygiene.** `liveHostedTarget`'s last-resort process probe stops matching any name containing `"pi"`; exact names (`pi`, `node`) or argv inspection only.
- **Key-name probe.** While in a live Herdr session, verify which spelling `agent send-keys` accepts (`ctrl+c` per the Herdr skill vs `C-c` in `stopHostedAgent`), record the answer in this ticket's notes, and standardize the code on the accepted spelling. F021 consumes this.

## Out of scope

- Making `limen stop` actually end a hosted agent — F021.
- Any change to detached jobs, the wake, or prune.
- A Herdr version gate or capability negotiation — F026 records versions; nothing here branches on them.

## Acceptance

- A fake Herdr answering the nested 0.8.0 envelope produces `working`/`idle`/`blocked` in `hostedAgentStatus`; the flat legacy envelope still works.
- A supervisor fed one failed `agent get` between good samples does not finalize; three consecutive `agent_not_found` samples finalize `done: hosted agent ended`.
- A CLI failure that is not `agent_not_found` (nonzero exit, garbage output) never counts toward `missing`.
- A hosted job whose in-pane hook writes `tool` does not have `activity` overwritten to `wait` by the supervisor within the same second.
- The send-keys spelling is recorded in notes with the probe output, and `stopHostedAgent` uses it.
- `npm run check` green.

## Notes

Seams: `hostedAgentStatus`, `hostedAgentAlive`, `liveHostedTarget`, `call` in `src/herdr.ts`; `runHostedSupervisor` in `src/proc.ts`; the fake herdr script inside `test/hosted-spawn.test.ts`. Live probe evidence (2026-08-18): `result` top-level keys are `agent`, `type`; `result.agent_status` is absent; `result.agent.agent_status` = `working`. `agent list` rows carry `agent_status` flat per row — only `agent get` nests. Terminal detection currently survives by accident because `missing` is the only distinction used; do not lose that property while fixing the shape.
