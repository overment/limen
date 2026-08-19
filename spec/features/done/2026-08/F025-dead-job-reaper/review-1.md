Coordinator review of `4edcba3` (same judgment as F021/F024/F026).

**PASS.** `reapDeadJobs` is the one helper: two dead observations `LIMEN_REAP_CONFIRM_MS` (default 10s) apart, after F022 startup grace, then `failed: process group gone` through F024 `finalizeJob`. `limen jobs` runs the same path via `confirmDeadJobs`. Handshake writes `pid` then `born`. A live group with mismatched `born` is dead; no `born` file keeps the group check. Hosted + live agent is not reaped. Reaped hosted jobs capture session jsonl first.

Did not re-run the full suite. Worker reported `test/reaper.test.ts` and `test/wake-hook.test.ts` green, including birth-mismatch on Darwin and the jobs→spawn→prune path.
