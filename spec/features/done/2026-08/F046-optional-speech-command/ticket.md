# F046-optional-speech-command · Optional spoken response

[2026-08-26] [🟢] [PROVEN] [COORDINATOR] PROVEN · F046-optional-speech-command

## Outcome

When the optional `speak` CLI is installed, a human can run `/speak` in Pi to hear the latest assistant response without starting another model turn.

## Scope

- Register `/speak` only when an executable named `speak` is on `PATH`.
- Read the latest assistant response on the current session branch.
- Use compressed brief mode by default and provide `/speak full` for exact playback.
- Keep audio strictly human-triggered.

## Out of scope

- Automatic completion or notification audio.
- Installing or configuring the `speak` CLI.
- A shell-level `limen speak` command that guesses which Pi session owns the response.

## Acceptance

- `/speak` sends the latest assistant text to `speak` through stdin with no mode flag.
- `/speak full` adds `--full`.
- No command registers when `speak` is unavailable.
- Native checks cover command registration, input selection, and both modes.
