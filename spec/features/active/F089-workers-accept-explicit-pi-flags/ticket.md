# F089 · Workers receive explicit Pi provider and thinking flags

## Outcome

An operator can launch a Pi worker with `limen spawn --provider openai-codex --model gpt-6-astra --thinking high`, and the worker receives those separate arguments literally. Adam requires this explicit launch for transcript-settlement regression and repair; the combined selector is not a substitute for this assignment.

## Scope

- Start at the spawn argument parser and carry provider and thinking through the existing detached wrapper and hosted supervisor.
- Support the same explicit arguments on continuation so a repair can keep its session without changing its launch contract.
- Pass an explicit provider to the existing opt-in authentication preflight.
- Preserve model environment overrides and the safe omitted-model default.
- Document the supported command in the package launch guidance.

## Out of scope

- A second launcher, provider substitution, retries, or automatic model selection.
- Transcript behavior, live creator capture, or Alice implementation.
- Changing Claude's CLI contract or adding an independent reviewer.

## Acceptance

- A hosted spawn with explicit provider, model, and thinking reaches Herdr's Pi invocation with all three separate flag/value pairs.
- A detached spawn reaches Pi with the same literal arguments, even when the worker environment names a different model.
- A continuation preserves separate provider and thinking arguments in both modes.
- Omitted-model Pi jobs still select `openai-codex/gpt-6-astra:high`.
- An explicit provider reaches the opt-in auth check before job creation.
- Pi-only flags on the Claude engine are rejected before a job is created.
