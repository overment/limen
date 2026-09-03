# F065 · a clean finished worker cannot remain idle forever

## Outcome

A hosted worker that has delivered its final response and left a clean worktree reaches a terminal job state even if it forgot to call `finish`. The backstop covers ordinary implementation turns that used tools; it does not depend on a later text-only steer, and its recorded reason tells the truth that Limen closed a clean idle session.

## Scope

- Start in `src/supervisor.ts`, where `noteHostedIdle` currently requires a zero-tool turn.
- Use durable session and activity evidence to distinguish a completed assistant response from an agent still thinking or using tools.
- Preserve the existing bounded idle interval and the stall advisory for dirty or ambiguous work.
- Record an accurate terminal reason and keep result and commit capture intact.

## Out of scope

- Replacing the explicit hosted `finish` path.
- Changing detached job completion or process containment.
- Treating Herdr unseen-idle alone as proof of completion.

## Acceptance

- A normal hosted turn with tool calls, a final assistant response, `activity=wait`, and a clean worktree finalizes after the idle bound.
- Thinking, tool activity, a dirty worktree, a failed last response, or blocked state does not take the clean-idle completion path.
- The terminal reason does not claim the hosted session had already ended.
- Hosted supervisor tests prove both the ordinary-tool backstop and the false-positive boundaries.
