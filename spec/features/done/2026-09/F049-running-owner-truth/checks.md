# Lost-supervisor recovery: landing evidence

Implementation `5754dad9c5f845a4d1466f328684c4417ff47b2f` and coordinator fixture correction `f30d9fb0c8eea02bb7579ca1b5fd6135f8f5dfff` landed as merge `6662bac4afad29c647f2d76ecf7e61247a892aeb`. Coordinator inspection covered all runtime/test changes, the job's terminal record and final session messages, native output and retained real-process fixtures. No independent reviewer or Adam candidate-review verdict is claimed.

Evidence root: `/home/overment/limen/tmp/evidence/f049-63cc811b/`.

- The worker's `candidate.patch` matches `git show --format=fuller 5754dad` byte-for-byte. Focused reaper/recovery/hosted/pulse/structure checks passed 103 (`focused-final.log`).
- One full native lane at `5754dad`: TypeScript/Biome passed; 385 passed, one failed, one cancelled, exit 1 (`native.log`). The wake fixture expected disabled Herdr to prove absence and a valid dead PID to receive startup grace. The dead-registry-lock test also timed out after 60 seconds.
- Coordinator reran the original wake case and reproduced its timeout (`coordinator-wake-before.log`). Correction `f30d9fb` changes only that test: the young record is PID-less, and an isolated fake Herdr provides concrete missing-agent evidence. Its original once-only wake and handoff assertions remain.
- At clean corrected candidate `f30d9fb`, coordinator typecheck plus `test/wake-hook.test.ts`, `test/reaper.test.ts` and `test/recovery.test.ts` passed 50/50 (`coordinator-wake-recovery.log`). Scoped Biome and `git diff --check` passed; `coordinator-correction.patch` preserves the correction.
- `coordinator-fixtures/` confirms competing sweeps and re-adoption produce one owning supervisor, dead claims recover, uncertainty waits, an absent agent's handoff is retained, no agent starts occur, and coordinator subscriptions remain unchanged.

Runtime files are identical between the implementation and corrected candidate. The original full native result is not rewritten as green, and no second full lane, real-seat/macOS adoption, production process kill, or live bot delivery was run. The registry-lock timeout remains unresolved. This open coordinator still requires `/reload`; no reload was performed during landing. The parked wake and unresolved route candidates remain unchanged.
