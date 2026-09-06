# F088 · Coordinators and workers start on the intended model

## Outcome

A Limen coordinator starts on `openai-codex/gpt-6-astra` with `xhigh` thinking, and its Pi workers start on that provider and model with `high` thinking. Omitting a worker's `--model` must not pick up Adam's unrelated global Pi default, `xai/grok-4.6`.

## Scope

- Start at the spawn model fallback, retaining explicit command-line and stage environment overrides.
- Apply the worker default to both hosted and detached Pi launches, without changing Claude model selection.
- Keep coordinator defaults local to this repository and document explicit Pi arguments for Herdr peers.
- Record Adam's policy that he performs reviews; independent review jobs run only when requested.

## Out of scope

- Editing Adam's global Pi settings or Herdr configuration.
- Provider preflight, retries, or automatic model ranking.
- Changing process supervision or removing the optional review command.

## Acceptance

- An omitted Pi worker model resolves to `openai-codex/gpt-6-astra:high` with no stage environment configured.
- An explicit spawn model wins over environment defaults, and requested reviews retain their reviewer override.
- Hosted and detached launch arguments preserve the selected provider, model, and thinking level.
- Trusted project Pi settings select the coordinator model at `xhigh`; the documented Herdr command makes that choice explicit regardless of project trust.
- Adam's global `defaultModel=grok-4.6` remains unchanged.
