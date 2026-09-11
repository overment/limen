# Hosted startup: landing checks

Coordinator inspection covered the complete candidate diff, terminal job record, final session messages, `proof.md`, and retained focused/native logs. Candidate `d93b4110b52d2c9d4ee0b65c8810b25e6844118f` changed only the hosted-spawn tests and proof map. Runtime, prompts and provider configuration were unchanged. It landed as `c6d4d6c271ca5648789423ae75f0e13c02d57792`; no independent reviewer or Adam candidate-review verdict is claimed.

Evidence directory: `/home/overment/limen/tmp/evidence/f048-6f76b166/`.

- Worker focused lane: 87 passed (`focused.log`); the committed test bodies were also exercised in the clean-candidate native lane.
- Coordinator reran `node --test --test-concurrency=1 --test-timeout=60000 --test-name-pattern='killed caller|tab creation refusal' test/hosted-spawn.test.ts`: three passed at the clean candidate (`coordinator-startup.log`).
- Spawn's isolated caller returned and was killed at 939ms; continuation's at 897ms. The spawn supervisor remained alive through startup beyond 20 seconds, then wrote an advisory and finalized. Continuation's supervisor consumed its durable file after caller death and finalized.
- The test kills its isolated shell-equivalent caller after the real CLI returns, not a live coordinator or a provider session. The artificial 22-second readiness timeout is fixture-only; the production default is unchanged.
- One full `npm run check`: TypeScript/Biome passed; 381 passed, zero assertion failures, one cancellation, exit 1. The dead-registry-lock test at `test/sweep-command.test.ts:50` exceeded 60 seconds; its cause remains unproven and the full lane is not green.
- `candidate.patch` retains the exact binary candidate diff. No full rerun, unrelated repair, model turn, live Herdr action, or manual finish ping was performed by the coordinator.

The receipt and route-refusal gaps remain separately active. The next worker owns watch-only supervisor recovery, never a new agent or transfer of coordinator ownership. The initial finish instructions in `notes.md` are superseded by this landed evidence and `proof.md`.
