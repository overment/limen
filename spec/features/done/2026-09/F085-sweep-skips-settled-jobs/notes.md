# Settled-job sweep map

The wake hook keeps a session-local set of settled terminal jobs. A completion without a delivery, any outstanding claim (including blocked claims), and every running job remain observable. Legacy terminal records without `notify/ready` can be cached; adding readiness invalidates them.

The 500 ms sweep still lists job names to discover new records. It skips cached records before reading state and passes the same running candidates to status, tab counts, and `reapDeadJobs`. The reaper rechecks state and retains its existing grace, identity, and two-observation decisions; callers without a candidate list still scan normally.

Watcher events invalidate the affected job. Claim/delivery bookkeeping invalidates without scheduling a sweep, preserving manual delivery repair without self-triggered churn. Only direct `activity`, `changed-files`, and `last-tool` files are ignored. Subscription and ancestor-directory changes invalidate cached session ownership. A separate 30-second cache refresh recovers missed events and continues after watcher failure; pending fallback completions do not wait for that refresh.

`test/wake-sweep.test.ts` uses real job files, a controlled watcher and clock, and captured timer callbacks. It proves timer-only fallback across grace separately from busy follow-up confirmation. It also counts settled-record reads during a full 475-record warm sweep, including status and reaper work. `test/reaper.test.ts` checks the shared-candidate path without changing reaper decisions.

Candidate check logs and the real-Pi CPU sampler live outside the worktree under `/Users/overment/.overment/limen/.limen/jobs/2026-09-05-f085-coordinator-cpu-resume-2-a6845681/evidence/`. `sample-real-pi.py` exercises the actual Pi TUI with 475 settled records, then one controlled running record backed by another real Pi and synthetic progress writes. It makes no provider calls. The retained summary distinguishes this controlled local proof from an Alice production measurement; actual model-backed wake turns are not claimed by the lifecycle tests. Consult the retained check summary for candidate SHA and final results.
