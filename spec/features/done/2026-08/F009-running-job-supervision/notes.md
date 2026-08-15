# F009 notes

## Landed this slice

File channel plus worker-side watcher.

- Coordinator: `limen steer <id> "text"` writes `.limen/jobs/<id>/steer/inbox/NNNN` and refuses finished or extension-less jobs without writing.
- Worker: `hook/steering.ts` (copied by init to `.pi/extensions/limen-steering.ts`) watches that inbox when `LIMEN_JOB=1`, claims each file once, calls `sendUserMessage(..., { deliverAs: "steer" })`, moves the claim to `steer/delivered/NNNN/`, and appends `steered: …` to the job log.
- Ready marker is `steer/ready`. Missing marker is how a pre-feature worktree reports unavailable.
- Sequence is a zero-padded counter shared across inbox/claims/delivered. An unread empty inbox file blocks later numbers so order holds.

## Not done

- Log-watching tab / operating advice about tailing the job log. Ticket says decide whether that is code or a paragraph in `templates/agents.md`.
- Existing projects need `limen init` (fills the new extension) and a commit of `.pi/extensions/limen-steering.ts` before a new worktree can load it. Jobs already running stay on the old worktree and will report unavailable.

## Checks

This worktree has no `node_modules`. `tsc --noEmit` failed looking for `@types/node`. Targeted node:test run after the init-regex fix still needed.
