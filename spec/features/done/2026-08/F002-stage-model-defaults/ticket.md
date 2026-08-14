# F002-stage-model-defaults · Stage model defaults

[2026-08-14] [🟢] [PROVEN] [COORDINATOR] PROVEN · F002-stage-model-defaults

## Outcome

A project can choose routine Pi models separately for worker and reviewer jobs, while the coordinator can override either choice for a particular job.

## Scope

- Use `LIMEN_WORKER_MODEL` as the default model for ordinary `limen spawn` jobs.
- Use `LIMEN_REVIEWER_MODEL` as the default model for `limen spawn --review` jobs.
- Preserve `--model` as the per-job override.
- Document the policy in the coordinator shop-manual template and README.
- Cover worker, reviewer, and explicit-override precedence with the fake Pi process.

## Out of scope

- A Limen configuration file or configured model registry.
- Selecting a model by ticket, feature, branch, provider, or cost.
- Persisting the resolved model in job state.

## Acceptance

- With only `LIMEN_WORKER_MODEL` set, an ordinary spawned Pi process receives that model via `--model`.
- With only `LIMEN_REVIEWER_MODEL` set, a review Pi process receives that model via `--model`.
- `limen spawn --model explicit` receives `explicit` even when a stage default exists.
- With no default and no `--model`, Pi receives no `--model` argument.
- Templates explain that routine stage choices belong in the environment and `--model` carries a ticket-specific judgment.

## Notes

Use stage defaults for repeatable local policy, not an opinionated choice in Limen itself. A different reviewer model can provide independent priors; whether that is worth the cost remains a project decision.
