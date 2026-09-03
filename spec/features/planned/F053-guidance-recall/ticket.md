# F053 · Guidance is present once and recalled at the moment of use

## Outcome

The coordinator and every worker hold the vision, the styleguide, the shop manual, and the speech register on every model call without those texts piling up in the conversation, and each is reminded of the rule that applies at the moment it matters: the styleguide when it edits code, the spec rules when it writes under `spec/`, the vision when it chooses or starts work. Today the per-turn note is replayed on every call until a compaction and was 22 percent of everything the Alice coordinator sent, and the model still forgot the rules. Stable guidance moves to the system prompt, sent once and cached; the per-turn note becomes a short cue about what just happened.

## Scope

- In `hook/communication.ts`, build the system prompt in this order: Pi's own prompt, the shop manual (inherited when the project has no `AGENTS.md`), the speech register, `spec/vision.md`, `.agents/limen/styleguide.md`, then a board digest last (NOW and NEXT lines only). Stable text first so the cached prefix survives a board change.
- Bytes identical on wake turns and human turns; the wake cue moves into the per-turn note.
- The per-turn note shrinks to a situational cue under one kilobyte: the audience, the three reply rules broken most (first line is the answer, no identifier without its meaning, size to the question), and one line naming what the last turn touched and the rule that governs it.
- Moment-of-use recall through Pi's `tool_result` event: a write or edit under `spec/` gets the Specs rules appended to its result; a write or edit of a code file gets a styleguide reminder; a `limen spawn`, a merge, or a new planned folder gets a vision reminder.
- Workers get the same shape with their own contents: ticket path, styleguide, speech register with both audiences; vision by reference; board read-only.
- Each body capped at the existing thousand-line limit with a notice.

## Out of scope

- Blocking or gating any tool call; the hook informs.
- Compressing the board itself (F059) and naming stale overlays (F054).
- Changing what wakes say.

## Acceptance

- Two consecutive human turns with unchanged files produce byte-identical system prompts; a wake turn matches a human turn.
- The system prompt contains the four bodies in the stated order and the digest last; the per-turn custom message is under one kilobyte.
- After `write` to `spec/features/planned/F999-x/ticket.md`, that tool result ends with the Specs reminder; after `edit` of `src/x.ts`, with the styleguide reminder; after a bash call containing `limen spawn`, with the vision reminder.
- A hosted worker's system prompt holds the styleguide and both register audiences and no board body.
- Over fifty simulated turns the session file gains under fifty kilobytes of custom messages.
- The hook suite and structure test pass.

## Notes

F052 moved the bodies out of the per-turn note because copies accumulated. This ticket puts them where they are sent once. At Alice the stable prefix is about 19k tokens, cached, against roughly 100 KB of stale copies per call today.
