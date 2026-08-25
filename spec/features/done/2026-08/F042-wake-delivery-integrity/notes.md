# Pi 0.84.2 wake-delivery semantics

Verified against the installed `@earendil-works/pi-coding-agent` 0.84.2 docs, types, and `dist/core/agent-session.js` before implementing F042:

- Extension `pi.sendUserMessage()` returns `void`. The runtime starts the async session call and catches its rejection internally, so API return/Promise resolution cannot confirm either queue entry or a completed turn. The hook keeps compatibility with promise-returning test/API shims only to retain immediate rejection recovery.
- While streaming, `deliverAs: "followUp"` appends to in-memory session and agent queues. The API returns after queueing; these queues are not persisted for process restart.
- A queued user message emits `message_start` when it actually enters the agent loop. Assistant `message_end` exposes `stopReason`; immediate provider failures end with `error`. `agent_settled` fires only after retries, compaction recovery, and queued follow-ups are exhausted, including after an errored run.

Therefore acceptance is not confirmation. The wake hook holds an accepted claim until the exact injected user text enters the loop, a non-error/non-aborted assistant message follows it, and `agent_settled` confirms no automatic continuation remains. A settled run without that sequence is unconfirmed and releases the first claim for retry.
