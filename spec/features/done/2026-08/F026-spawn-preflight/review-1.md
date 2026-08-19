Coordinator review of `206506c` (human instruction to skip independent review). Independent job `2026-08-19-f026-review-0006dad9` stopped mid-read.

**PASS.** Spawn fails before `planWorktree` when `pi` is not on `PATH`. `LIMEN_PREFLIGHT=auth` runs `pi auth check` and creates no record on failure. Versions are probed off the handshake path (1s kill) and printed by `limen jobs <id>`. `bin/limen` refuses Node &lt; 24 before importing TypeScript; `requireNodeMajor` is the testable copy. SECURITY.md names that Linux does not signal escaped descendants. README records last known-good pi 0.84.2 / Herdr 0.8.0. `docs/remote.md` names the 30s duplicate-wake window.

Merged onto F024; `jobs.ts` keeps both `stop-reason` and `versions`.
