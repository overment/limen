# F726 · Limen runs jobs on Pi only

## Outcome

Limen starts jobs only with Pi. There is no `--engine claude`, no advisor-on-Claude path, and no leftover CLI, docs, or tests that teach a Claude engine. Operators spawn workers, reviewers, and other Pi jobs as before.

## Scope

- Start at spawn's `--engine` parsing and `preflightClaude` in `src/commands/spawn.ts`, then wrapper/stream branches that launch `claude` and parse its JSON stream.
- Delete the Claude engine path, `LIMEN_ENGINE=claude`, `LIMEN_CLAUDE`, `claude-session` handling, and the Claude stream parser.
- Remove advisor-on-Claude guidance. The advisor role exists only for Claude: delete the role, its preamble, shop-manual second-opinion paragraph, and README/help that teach it.
- Rewrite tests and fake-claude fixtures so remaining Pi paths stay green. Do not touch Herdr `advisoryCall` pane helpers.

## Out of scope

- GitHub doorbell, unusable-route refusal, living architecture picture.
- Changing how Pi jobs spawn, continue, or parse streams.
- Rewriting Alice/API plants.

## Acceptance

- `limen spawn --engine claude` is not a real engine path: unknown or gone, no job, worktree, or agent created.
- No packaged file registers or launches the `claude` CLI for a Limen job.
- Shop manual, README, and `limen` help do not teach `--engine claude` or advisor-on-Claude.
- Focused spawn, stream, and structure tests for remaining Pi paths pass. Typecheck clean.

## Notes

F074 shipped Claude as a detached advisor engine. That path is removed at owner request; the done folder stays historical. Prefer delete over a Pi-only advisor role that nobody uses.
