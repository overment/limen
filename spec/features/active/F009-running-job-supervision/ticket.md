# F009-running-job-supervision · Watch and redirect a job without restarting it

[2026-08-15] [🔴] [PLANNED] [COORDINATOR] PLANNED · F009-running-job-supervision

## Outcome

A coordinator can see what a running job is doing and redirect it in place. A worker that is widening past its slice, or heading at the wrong seam, receives a correction and continues — instead of being stopped, resharpened, and respawned with its context discarded.

The job model does not change. Jobs stay detached, keep their wrapper, and keep every durability and containment guarantee they have today.

## Scope

- A steer channel built from ordinary files: the coordinator writes a message into the job directory, and the running worker picks it up and acts on it.
- Worker-side delivery through the project extension that already loads inside every job worktree, using Pi's `sendUserMessage` with `deliverAs: "steer"` so the message lands between tool calls rather than mid-stream.
- Durable evidence: a delivered steer is visible afterwards in the job directory and named in the job log, so a later reader can tell what the worker was told and when.
- A way to open a terminal window onto a running job's log. Decide first whether this needs any Limen code at all — a coordinator holding Bash inside Herdr can already create a tab and tail the log, in which case this is one paragraph of operating advice in `templates/agents.md`, not a command.

## Out of scope

- Hosting the worker process itself in a pane or tab. That is F010 and carries a different cost.
- Any steering path that requires Herdr. The steer channel must work in a bare terminal.
- Two-way conversation with a running worker. This is a one-way correction, not a chat.
- Changing the wrapper's timeout, tool-call cap, or containment behavior.

## Acceptance

- `limen steer <id|suffix|label> "text"` reaches a running worker and visibly changes what it does next, demonstrated by a test that spawns a job, steers it, and asserts the worker acted on the message.
- A steer sent to a job that has already finished fails clearly and writes nothing.
- Each steer is delivered exactly once, survives the worker being mid-tool-call, and remains inspectable in `.limen/jobs/<id>/` after delivery.
- Several steers sent in sequence arrive in order.
- The worker names each received steer in its log so `limen jobs <id>` shows it.
- A job whose worktree predates this feature, or whose extension is missing, still runs normally and reports that steering is unavailable rather than failing.
- `hook/` growth is unconstrained, but any new `src/commands/` file must be reflected in `test/structure.test.ts:20`, which freezes that filename list.

## Notes

Workers run `pi` with the worktree as cwd, and the worktree carries the project's committed `.pi/extensions/`. Worker processes therefore already load Limen's own extensions — `hook/wake.ts` deliberately stays inert inside them by checking `LIMEN_JOB`. That is the seam: the same mechanism can watch the job directory instead.

`README.md:136` currently states that no channel exists for steering a running job. That line is the thing this feature deletes.

Open design questions for the worker, not decisions to escalate: whether a steer is a single file or a queue directory, how delivery is marked without a second source of truth, and whether the watcher polls or uses a filesystem watch. `notify/subscribers/` and `claimMarker` in `hook/wake.ts` are existing precedents for once-only delivery built from files.
