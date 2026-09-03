# F055 · A hosted worker ends its own job

## Outcome

A worker running inside a Herdr tab finishes its job by calling one tool after its handoff, and the job is recorded `done` with the handoff as its result. The coordinator receives one completion wake and no echo of its own stop. Today the worker prompt asks the worker to quit Pi, which it cannot do; every hosted job then costs an idle wake, often a futile "exit now" steer that restarts the worker for a full model call, a `limen stop`, a second wake, and a reply to the owner that says nothing. At Alice 151 of 174 hosted workers ended that way.

## Scope

- In `hook/hosted.ts`, register a `finish` tool for hosted jobs that takes the handoff text, writes it to the job's `result`, and calls Pi's `shutdown()`. Pi runs the shutdown once the turn settles; the existing `session_shutdown` handler and supervisor then record `done: hosted session ended`.
- The supervisor's result capture prefers a tool-written result over the last assistant text, so a trailing "Done." never replaces the handoff.
- `limen stop` with a reason beginning `done:` records `done`; the supervisor's finalize branch reads the reason, not only the presence of a stop request.
- Backstop in `src/supervisor.ts`: a hosted agent idle past the threshold whose last turn ended without a tool call and whose worktree is clean finalizes `done` instead of raising an advisory.
- In `hook/wake.ts`, a stop issued from a session marks that session's completion slot delivered, so no wake echoes back; the wake excerpt quotes the last substantive message.
- `templates/worker.md` names the tool and drops "exit the session"; `templates/agents.md` drops the advice to steer a worker to exit.

## Out of scope

- Detached jobs, which already end when Pi exits.
- Timeouts or tool-call caps for hosted jobs.
- Closing tabs the human opened by hand.

## Acceptance

- A hosted job whose worker calls `finish` records `done`, `result` equals the tool argument, the tab closes, and exactly one completion wake reaches the spawning session.
- `limen stop <id> "done: merged as abc123"` records `done` and the stopping session receives no wake for it.
- A hosted worker idle past the threshold after a turn with no tool call and a clean worktree records `done` with no advisory written.
- The worker template contains `finish` and no longer contains "quit pi"; the hosted and wake suites pass.

## Notes

The whole ending path already exists for a tab closed by hand. This ticket only adds the trigger and stops mislabelling a clean ending as stopped.
