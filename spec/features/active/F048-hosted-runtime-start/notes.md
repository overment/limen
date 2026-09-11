# Hosted start: finish the existing ownership contract

The current main checkout already has the supervisor-first implementation described by the ticket. The ticket's opening incident explains the old failure, not the current code. Verify and finish the existing path; do not recreate it or manufacture an alternative start mechanism.

- `src/commands/spawn.ts:startHosted` plants hosted placement, role/agent identity and the durable environment contract, launches `launchHostedSupervisor`, and waits for its PID handshake. It does not call `startHostedPi` itself.
- `src/supervisor.ts:runHostedSupervisor` writes the handshake before entering the explicit `LIMEN_HOSTED_START` phase. Its `startHostedAgent` starts Pi, records the agent and uses recorded origin-tab truth for focus restoration.
- Hosted continuation now passes `--continue @<job>/continue`; fresh spawn passes `@task.md`. The transport-only repair landed as `a3872a6`, with installed Pi parser/file processing and quoted-multiline regression evidence under `/home/overment/limen/tmp/evidence/f081-3241d718/`.
- `test/hosted-spawn.test.ts` already exercises a busy start returning on the supervisor PID, stop during startup, asynchronous failures, pane-follow, focus restoration and continuation. Use the ticket's killed-caller falsifier to identify the actual remaining gap.

Deliver one coherent finish commit: the smallest necessary correction plus retained proof, or a proof map if the existing implementation satisfies every acceptance. No reaper adoption, route-probe machinery, worker-prompt rewrite, or changes to the parked wake candidate. The unresolved model-route refusal and completed bot-turn evidence are separate open work; neither authorizes weakening this ticket's startup checks.
