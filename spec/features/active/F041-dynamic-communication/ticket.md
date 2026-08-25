# F041-dynamic-communication · Make Limen concise without making every reply look the same

[2026-08-25] [🟠] [ACTIVE] [COORDINATOR] ACTIVE · F041-dynamic-communication

## Outcome

Limen chooses the shape, depth, and tone of each response from the question, evidence, and stakes. A human who knows the project's purpose but has not followed recent jobs can understand the current truth without reading a diff or reconstructing history.

Responses stay compact by default. Context earns space when it prevents misunderstanding. Every remaining sentence answers, orients, provides evidence, explains a consequence, or states what happens next.

## Scope

- Rewrite the package `templates/communication.md` instead of appending a long style blacklist.
- Keep separate human and agent registers while adding shared guidance for natural voice and prose written into project files.
- Replace the fixed format matrix with per-response judgment over prose, bullets, steps, tables, diagrams, headings, and code blocks.
- Fold the useful parts of the supplied Unslop guidance into a short final self-check: plain words, specific claims, natural rhythm, active voice, restrained formatting, and no chatbot filler or manufactured enthusiasm.
- Correct nearby documentation, comments, and test names that still claim the speech register is restacked before every model call. The mechanism remains a system-prompt append at the start of each user turn.

## Out of scope

- Changing `hook/communication.ts` injection timing or adding a second model pass.
- Runtime format selection, response linting, or model-output validation.
- Governing source-code style, which remains the job of `.agents/limen/styleguide.md`.
- Rewriting project overlays such as `.agents/limen/worker.md`.

## Acceptance

- The package prompt explicitly tells the model to choose the shortest clear response for a human who may not know recent work or current state.
- Format and tone are selected per response rather than imposed by a mandatory skeleton.
- The prompt distinguishes useful context from a project-history recap and keeps verified evidence separate from judgment.
- Tickets, notes, reviews, outcomes, and documentation are written for a future reader without turning into an activity log.
- The prompt itself remains compact and readable, with no full 30-rule blacklist.
- README, CONTRIBUTING, hook comments, and test names describe injection as once per user turn.
- `npm run check` passes.

## Notes

This changes a package-wide role prompt for every project without a `.agents/limen/communication.md` overlay. It therefore earns a fresh review even though the implementation is mostly Markdown.
