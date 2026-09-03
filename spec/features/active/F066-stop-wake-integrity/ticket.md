# F066 · stop suppresses a wake only after the job stops

## Outcome

When a coordinator stops a job, Limen marks that coordinator’s completion wake delivered only after the stop has actually reached a terminal state. A failed hosted stop leaves notification routing intact, so the eventual completion can still wake the session that asked for the stop.

## Scope

- Start in `src/commands/stop.ts`, where the caller’s delivered marker is currently written before signaling or finalization.
- Write the marker after successful terminal-state confirmation for hosted and detached jobs.
- Leave no delivered marker when stop throws or the job remains running.
- Preserve the current rule that a successful stop does not wake the same coordinator again.

## Out of scope

- Changing completion claim confirmation in the wake hook.
- Changing stop reasons, signal escalation, or process containment.
- Adding retries to a failed hosted stop.

## Acceptance

- A successful hosted or detached stop records the caller session as delivered after the terminal state exists.
- A hosted stop that reports the agent still running leaves no delivered marker for the caller.
- An eventual completion after that failure remains eligible for normal wake delivery.
- Stop-command tests cover marker timing on success and failure.
