# F001-communication-guidance · Stable communication guidance

[2026-08-14] [🟠] [ACTIVE] [COORDINATOR] ACTIVE · F001-communication-guidance

## Outcome

Coordinators receive one clear project communication prompt in the Pi thread, while stable message history preserves provider prompt caching.

## Scope

- Keep the communication rules in a project-owned Markdown file.
- Install that file and its Pi extension with `limen init` without overwriting existing project copies.
- Inject the exact guidance as a hidden custom thread message, not as a system prompt.
- Guide coherent, contextual explanations for readers who know the project's broad purpose but not the current feature or its implementation details.
- Keep ordinary replies flexible while defining concise expectations for naming and durable feature cards, prompts, handoffs, commits, reviews, and HTML artifacts.

## Out of scope

- Rewriting assistant output after generation.
- Enforcing response length or a fixed presentation format.
- Applying coordinator-facing communication guidance to worker or reviewer jobs.

## Acceptance

- The default prompt asks for concise completeness, enough local context to make the result self-contained, and a coherent flow between related ideas.
- It assumes the reader knows the project's broad purpose but not the current feature, implementation details, or recent decisions.
- The prompt uses plain, principle-led guidance and names `artifacts/` as the only feature-local location for HTML explainers.
- A coordinator's active Pi context contains at most one exact current communication message during normal turns.
- The extension does not filter, remove, or reorder context messages.
- Reloading or resuming a session does not duplicate an exact active prompt.
- A changed prompt, or an active context where compaction or branching removed it, receives one new message.
- Worker and reviewer sessions receive no communication message.
- Tests cover installation, stable injection, compaction recovery, prompt changes, and worker exclusion.

## Notes

Pi's `before_agent_start` message return persists a custom message in the session and sends it to the model. `buildContextEntries()` provides the active, compaction-aware branch used to decide whether injection is needed.
