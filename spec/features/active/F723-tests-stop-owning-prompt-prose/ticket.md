# F723 · Tests stop owning prompt prose

## Outcome

Tests no longer inventory exact phrases from the shop manual, speech register, or role preambles. Structural checks still prove templates ship with current history hashes. Behavior checks still prove a named-role spawn loads the packaged preamble. Prompt wording lives in those Markdown files, not in a second owner.

## Scope

- Start at the phrase-matching inventories in `test/communication-hook.test.ts` and `test/structure.test.ts` that copy shop-manual, register, and role-preamble sentences.
- Delete those inventories. Keep hash-history checks and named-role spawn behavior.

## Out of scope

- Rewriting the shop manual, register, or role preambles.
- One-home for handoff policy (next slice).
- Changing what the communication hook injects at runtime.

## Acceptance

- No test asserts a unique sentence copied from `templates/agents.md`, `templates/communication.md`, or a role preamble solely to freeze wording.
- Template history hashes still match the shipped files.
- Named-role spawn still loads the packaged preamble (existing spawn tests).
- Remaining communication-hook tests still prove audience, bounds, overlay, and reminder behavior. Typecheck clean.

## Notes

Quality findings: seven landings had added exact-phrase checks that made tests a second owner of prose judgment.
