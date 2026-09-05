# Audit evidence

These files preserve raw output, not a claim that every probe is a production integration test. Research reports explain the fixture and limit attached to each result.

## Runtime report

`runtime/` holds the runtime researcher's original command outputs and probe sources. Source files have a `.txt` suffix so retained experiments are not compiled or formatted as Limen production code. The original executable probes are in `/tmp/limen-runtime-audit.s79R5Y/`.

To reconstruct the research layout in a new temporary directory, clone Limen into its `limen/` child and check out `5a00065c92d86cd2039149273095e4e470898418`. Copy the retained probe sources beside that clone and remove only the final `.txt` suffix. `reproduce.ts`, `reproduce-herdr.ts`, and `finalize-race.ts` import the pinned clone's existing scratch test helpers. They use fake Pi/Herdr adapters and isolated repositories. The installed CLI probe additionally contains the original scratch path; inspect and update that path before running it on a different machine. Do not point any fixture at a real job cabinet or Herdr socket.

The coordinator inspected the probe sources and reran `node /tmp/limen-runtime-audit.s79R5Y/reproduce.ts`. It exited 0 and reproduced four cases: two synchronized spawns lost both worktrees; two sequential continuations ran in the same checkout; a successful hosted transcript retained an earlier error/result; and stop killed a fixture process group whose recorded birth did not match. In this rerun, `liveJobBefore` was false, yet direct stop still signalled that fixture group. The researcher had observed true for that auxiliary liveness check; neither run observed natural OS PID recycling. Output: `runtime/coordinator-reprobe.txt`.

Other runtime findings were checked against their original raw outputs and cited source; the coordinator did not rerun every fixture. A fresh judge still needs to assess the findings' scope and conclusions.
