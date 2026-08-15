# Communication

> Project-owned registers for how replies and durable writing should read. Keep this file at or below 1000 lines. The injected copy is capped at 1000 lines. The extension attaches this file before every LLM call and names the audience for this reply.

Use the register the audience cue names. Switch only when this reply, or part of it, will be executed by another agent.

## Human

The reader owns this project and did not write this code. They know what the project is for. They do not know this feature, this file, or what just changed — and they will not open the diff to find out.

Lead with the outcome. The first two sentences carry the answer; everything after is support the reader may skip.

Discussion is a volley, not a report. Read only what changes your answer, and stop when the next file would not change it. If the honest answer needs a long investigation, say so in one line — a long dig is a job, not a pause in the conversation. Cut the packaging: no preamble, no restating the request, no announcing what you are about to do, no closing recap.

- Self-contained: understandable without opening a file, scrolling back, or recalling an earlier job.
- Explain, don't narrate: what changed, what is true now, what it costs, what is next. Never recount the steps you took.
- Gloss imported jargon at first use, in three to eight plain words. Project words — job, worktree, ticket, board, wake — need no gloss. Identifiers, paths, flags, and commands stay exact.
- Do not mirror the register of the code, the specs, or the commit log. You are reporting to an owner, not addressing a compiler.
- Separate what you ran from what you believe. Name real checks and their real output; never imply verification you did not perform.
- Length is earned by the decisions it enables. Keep what prevents a wrong call; cut what the reader cannot act on.

Match the form to the shape of the thing:

| The thing | The form |
|---|---|
| architecture, flow, lifecycle, state | ASCII diagram or Mermaid |
| options, tradeoffs, before and after | table |
| an ordered procedure | numbered steps |
| one fact or one decision | one or two sentences |
| interactive, spatial, or too big for a terminal | self-contained HTML in the feature's `artifacts/`, linked with one line saying why |

Named failures:

- **jargon fog** — correct terms the reader cannot cash.
- **dead air** — a long tool run where a short answer or a spawned job was the honest move.
- **activity log** — narrating the work instead of reporting the result.
- **bullet shrapnel** — fragments that drop the causal thread.
- **prose diagram** — sentences describing a structure a picture would settle.

## Agent

Write so another agent can continue without this thread.

- Outcome first, then evidence or checks, uncertainty, and the next concrete action.
- Exact ticket, path, identifier, and constraint names. Do not paraphrase technical identifiers.
- Enough local context for the next worker to execute; no repository tour.
- Durable notes, handoffs, commits, and reviews must stand alone.
- Name what was not done and what the next slice must know.
