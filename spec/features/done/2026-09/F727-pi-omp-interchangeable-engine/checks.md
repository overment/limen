# Pi/OMP profile-table landing checks

Candidate: `0f7474883dfd74a8448bf2fefde225cbedd724b4` on `limen/2026-09-22-f727-pi-or-omp-jobs-5e3bd61b`.
Coordinator ran these in `/home/overment/.limen-limen-worktrees/2026-09-22-f727-pi-or-omp-jobs-5e3bd61b` before fast-forwarding main. Raw output is retained under `/home/overment/limen/tmp/evidence/f727-0f74748/`.

- `npm run typecheck`: exit 0 (`typecheck.log`).
- `./node_modules/.bin/biome check .`: exit 0, 85 files (`biome.log`).
- `node --test --test-concurrency=1 --test-timeout=60000 test/spawn-command.test.ts test/continue-command.test.ts test/engine.test.ts test/stream.test.ts test/structure.test.ts`: 57/57 (`focused.log`).
- `node --test --test-concurrency=1 --test-timeout=60000 --test-name-pattern 'hosted omp|literal Pi launch flags|spawn in Herdr is hosted|supervisor follows a moved pane|spawn --tab starts' test/hosted-spawn.test.ts`: 4/4 (`hosted.log`).
- `node --test --test-concurrency=1 --test-timeout=60000 test/inherit.test.ts test/finalize.test.ts`: 11/11 (`wrapper.log`).
- `git diff --check` against the candidate: clean. `src/stream.ts` has no change. The worktree was clean after checks.

The OMP launch tests use fake binaries and fake Herdr. They verify detached argv, hosted kind and omission of JSON mode, environment precedence, same-engine continuation, unsupported-engine refusal before publication, and PATH-only OMP preflight. The real-binary spike remains in `spike.md`; live hosted OMP and live OMP continuation remain unproved.

Worker `npm run check` passed TypeScript and Biome but hit a 600-second cap after the structure tests; its remaining test files passed 92/92 separately. An earlier hosted moved-pane test missed once and passed on retry, in the later worker pass, and in the coordinator's focused run. These are not a single full-suite exit 0. Worker tool output and final handoff are retained in `/home/overment/limen/.limen/jobs/2026-09-22-f727-pi-or-omp-jobs-5e3bd61b/session/`.

No independent reviewer was launched: Adam owns reviews and explicitly authorized focused tests plus typecheck as landing evidence. The coordinator read the complete diff before landing. Automatic finish-webhook transport was accepted; an owner bot turn was not observed, and no manual duplicate was sent.
