# Status boundaries

- Herdr `idle` and `done` describe the coordinator's input readiness/seen state, not completion of its jobs. Preserve that native lifecycle; overlay explicit Limen job facts rather than pretending the coordinator is thinking.
- `hook/wake.ts` already reports running-job metadata and origin-tab counts, but labels omit an explicit RUNNING distinction and mix watched with unwatched work. `hook/hosted.ts` reports only the worker role. Start the status slice at those seams.
- Unwatched means this session is not subscribed. Show visibility without claiming ownership or subscribing automatically. Silence and `wait` do not establish a human blocker; a clean run does not establish merge readiness.
- The F702 coordinator owns `src/wrapper.ts`, `src/finish-webhook.ts`, spawn/continue finish configuration, `docs/finish-webhooks.md`, and the helper until landing. Consume its landed commit; do not duplicate delivery or steer its worker.
- Existing dirty `src/commands/jobs.ts`, `test/jobs-command.test.ts`, and `test/workspace-command.test.ts` change historical diff rendering. They are peer work, not this slice.
- Adam owns review. Status work uses Astra xhigh workers. No Alice changes or actions on protected `w98:t1`.
- Operator guidance must distinguish native pane state, durable job state, candidate/review judgment, coordinator-wake confirmation, and webhook acceptance. F702 acceptance records do not prove Tony observed a wake.
