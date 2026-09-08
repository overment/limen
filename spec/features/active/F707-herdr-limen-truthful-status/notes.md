# Status boundaries

- Herdr `idle` and `done` describe the coordinator's input readiness/seen state, not completion of its jobs. Preserve that native lifecycle; overlay explicit Limen job facts rather than pretending the coordinator is thinking.
- `hook/wake.ts` already reports running-job metadata and origin-tab counts, but labels omit an explicit RUNNING distinction and mix watched with unwatched work. `hook/hosted.ts` reports only the worker role. Start the status slice at those seams.
- Unwatched means this session is not subscribed. Show visibility without claiming ownership or subscribing automatically. Silence and `wait` do not establish a human blocker; a clean run does not establish merge readiness.
- Per-project automatic finish delivery (F702) landed on main at `622d426a885aefecc78da8bf9a361bf0c8753a27`; finalizer/config seams are released. Consume the package helper and `docs/finish-webhooks.md`, not a second sender. No projects were globally opted in, and existing jobs without a config snapshot remain opted out.
- Automatic `finish-webhook` receipts report `attempting`, `accepted`, or `failed`; absence of `finish-webhook-env` means no selected config. An interrupted attempt is ambiguous, not safe to retry automatically. Coordinator notification delivery uses separate `notify/` records.
- Existing dirty `src/commands/jobs.ts`, `test/jobs-command.test.ts`, and `test/workspace-command.test.ts` change historical diff rendering. They are peer work, not this slice.
- Adam owns review. Status work uses Astra xhigh workers. No Alice changes or actions on protected `w98:t1`.
- Operator guidance must distinguish native pane state, durable job state, candidate/review judgment, coordinator-wake confirmation, and webhook acceptance. F702 acceptance records do not prove Tony observed a wake.
