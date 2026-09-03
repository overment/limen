# Outcome

`limen diff <id|suffix|label>` opens the job's changeset in hunk when hunk is on PATH, in a named Herdr tab when Herdr hosts the session, and otherwise prints the exact `git diff <base>...<branch>` line. Hunk is an environment, not a dependency: `LIMEN_HUNK` overrides the binary, `LIMEN_HUNK=0` disables it, and nothing else in limen changes when it is absent. Fresh jobs record the hunk version beside pi and Herdr when the binary probes.

Landed `17012f8`. Review PASS of `0c8925e`. Live hunk UI was not re-probed on the review machine; the worker pinned hunk 0.21.0 invocations `hunk diff <base>...<branch>` and `hunk diff <base> --watch`.
