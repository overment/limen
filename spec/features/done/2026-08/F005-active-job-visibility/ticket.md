# F005-active-job-visibility · Active job visibility

[2026-08-14] [🟢] [PROVEN] [COORDINATOR] PROVEN · F005-active-job-visibility

## Outcome

A coordinator can reliably see in-flight Limen work before selecting or restarting a feature, without gaining unsolicited completion ownership.

## Scope

- Make bare `limen jobs` a bounded, compact live-job snapshot: show every `running` record and summarize hidden terminal history without reading logs or Git diffs.
- Add explicit `limen jobs --running`/`--active`, `limen jobs --all`, and `limen jobs <id|suffix|label>` views for an active-only snapshot, historical diagnostics, and one detailed record.
- Make the generated Pi wake footer and Herdr metadata observe every local `running` job, marking work this conversation is not subscribed to as unwatched.
- Keep subscription markers as the only authority for start notices, terminal delivery, and fallback election.
- Update coordinator guidance and user documentation, with regression coverage for a large history and a resumed coordinator.

## Out of scope

- Automatic watching or changes to completion-routing ownership.
- Managing or reconciling external worker registries such as agent-control.
- Rewriting existing installed extensions; `init` continues to preserve project-owned copies.

## Acceptance

- A repository with many large terminal logs and one live job prints the live job in bare `limen jobs` output within a bounded response, with no diffstat or log tail.
- `limen jobs --all` retains historical detailed diagnostics; `limen jobs <query>` resolves and renders only that record.
- `limen jobs --running` and `--active` include only on-disk `running` records and report an empty live set clearly.
- An unsubscribed coordinator displays an existing running job as unwatched, but receives neither a start notice nor a terminal wake unless it explicitly watches the job or wins normal terminal fallback.
- `npm run check` passes.

## Notes

F001–F004 were allocated in prior Limen history; F005 is the next valid number even though this repository was re-initialized locally.
