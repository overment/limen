# F057 · A failed model turn is said out loud

## Outcome

When a coordinator turn dies on a provider error, the owner's next reply opens by saying so and what was lost, instead of the owner typing "..." to find out. When a hosted worker's turn dies the same way, the job record and the Herdr tab say so, the way a detached job already records `failed`. At Alice the coordinator produced 132 errored turns with no text, one worker lost an hour across three timeouts in silence, and the owner prodded 26 times in ten days.

## Scope

- In `hook/communication.ts`, remember the last assistant message that ended `error` or `aborted` and its error text; the next turn's per-turn cue carries one line: the previous turn failed with that error and nothing reached the human.
- `templates/communication.md`: the first line after a failed turn says it failed and what is being redone.
- In `src/supervisor.ts`, when the hosted session's last assistant message ended `error` and no tool call followed within the idle window, write an `errored` advisory naming the error, stamp the tab the way stalls are stamped, and clear it when the worker works again.
- The advisory wake text for that case says the worker's last turn failed, not that it is idle.

## Out of scope

- Retrying the provider call; Pi owns retries.
- Recording a hosted job `failed` on a single errored turn; the worker may recover.
- Detached jobs, which already end `failed` on a final errored turn.

## Acceptance

- A test session whose previous assistant message has `stopReason: error` gets a per-turn cue containing the error text; a session whose previous turn succeeded gets none.
- The register template contains the failed-turn sentence.
- A hosted session file ending in an errored assistant message past the idle window produces an `advisory` file beginning `errored:` and a wake that says the turn failed.
- The hook and supervisor suites pass.

## Notes

Pi hands the error text to extensions on `message_end`; the hook only has to keep it until the next turn.
