Coordinator review of `4ce24b6` (human instruction to skip independent review). Independent job `2026-08-19-f024-review-bb4dea17` stopped mid-read.

**PASS.** Finalize writes `commits` / `finished-at` / `state` / drops `pid` before `renameJobTab` (now detached `spawn` + `unref`). Already-terminal `finalizeJob` is a no-op. Exhaustion SIGKILL timer is unref'd and always cleared after the child closes. Last assistant `error`/`aborted` becomes `stop-reason` for JSON streams and hosted session jsonl; job state stays `done` (F028). Unseen `steer/inbox` is counted in the log and wake. Tmp leftovers swept.

Did not re-run the full suite. Worker reported targeted finalize/stream/wake/hosted tests green; the F007 2s stop-bound flake is pre-existing.
