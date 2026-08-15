# F008-guidance-register-split · Separate coding practice from speech

[2026-08-15] [🟢] [PROVEN] [COORDINATOR] PROVEN · F008-guidance-register-split

## Outcome

A project states how its code should be written and how its agents should speak in two separate, project-owned files, and each arrives at the moment it governs. Coding practice is present when the agent decides how to write code. Speech guidance is present when the agent decides how to phrase a reply, including after a long tool run.

## Scope

- Redefine `.agents/limen/styleguide.md` as project coding practice, configurable per project like `spec/vision.md`.
- Restore `.agents/limen/communication.md` as speech guidance with a human register and an agent register.
- Attach the styleguide with vision and the board after each user message.
- Restack communication before every LLM call so it survives long tool runs, and name the audience for that reply.
- Ship both as templates that `limen init` copies without overwriting existing project files.

## Out of scope

- Rewriting worker or reviewer birth prompts.
- Changing what the wake extension notifies or displays.
- Enforcing any register after generation.

## Acceptance

- The project-context message carries vision, board, and styleguide, and does not carry communication.
- A `limen-communication` message is appended last on every LLM call, with exactly one copy present after restacking.
- The audience reads `human` for an interactive coordinator and `agent` when `LIMEN_JOB=1`.
- Communication is reread from disk on every LLM call and bounded at 1000 lines like other project files.
- A missing `communication.md` leaves the LLM context unmodified.
- `limen init` creates both files and preserves existing bytes on a second run.

## Notes

The two files were previously one, which conflated product-independent code taste with reply shape and left speech guidance stranded at the top of long tool runs. The human register targets a reader who owns the project but did not write the code; the agent register targets the next worker. Named failure modes — jargon fog, dead air, activity log, bullet shrapnel, prose diagram — carry most of the steering per token.

Restacking breaks the provider prompt cache at the point the previous copy occupied. The reprocessed span is small because the message sits at the tail. This is a deliberate trade of cache efficiency for steering that survives tool runs, and it worsens if the file grows past roughly a hundred lines.
