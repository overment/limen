# Native check did not complete

Command: `npm run check`, once on clean source candidate `cb3542a` (use `native-candidate.txt` for the full exact SHA and environment). The command runs TypeScript, Biome, then the serial Node test suite with its existing 60-second per-test timeout. The outer tool timed out after 1200 seconds; it killed the command before a final test summary or shell exit-code file was written. No numeric exit code is claimed.

TypeScript completed successfully. Biome reported `Checked 81 files in 70ms. No fixes applied.` The new `/speak` absence test passed within this run as well as the focused run.

Seven failure lines were emitted before interruption:

- `continue refuses a pruned checkout when its branch is missing without writing records`
- `hosted continue survives a killed caller and passes durable @continue, not @task`
- `prune keeps nested running jobs owned by another checkout`
- `spawn keeps nested running jobs owned by another checkout`
- `leftover sweep keeps a nested container with a locked registered child`
- `independent jobs can run concurrently and are merely announced`
- `sleeping descendant discovery delays stop only through its short bound`

The interrupted reporter did not print their assertion details. These tests are outside the audio diff; their causes were not diagnosed, baseline-tested, or repaired. Keep `native.log` as failed/incomplete evidence, never as a green suite.

After timeout, the Node test runner was gone but a test-only detached wrapper and fake Pi remained in process group 51961, using temporary fixture `limen-test-aQLqPn`. The wrapper path, child fixture command, group, and start time were verified before signaling. TERM did not finish them; KILL of the same verified group removed both PIDs (51961 and 52051). No real worker or other project was signaled.
