# F056 · A wake reaches the session that owns the job, once, facts first

## Outcome

A completion or idle wake goes to the coordinator that started or watches the job, waits minutes rather than seconds before falling back to another session, and falls back only to a session that owns jobs of its own. A wake that lands on a turn which dies with a provider error is not lost. The wake text opens with what the job was for and what it produced, and the standing instruction follows. At Alice the two-second fallback let three research sessions steer, stop, and spawn five duplicate reviews of one branch in forty minutes, and one wake sat three hours behind errored turns.

## Scope

- In `hook/wake.ts`, raise the fallback grace to minutes (configurable), and make fallback eligibility require that the session has spawned or watched at least one job under this root.
- An assistant message ending `error` or `aborted` releases the claim without spending one of the two confirmation attempts; delivery retries after the next successful turn.
- One completion delivery per job per session; a second delivery of the same slot is dropped and logged.
- Reorder the wake text: label, the first sentence of `task.md`, state, commits, excerpt, then the instruction. Routed wakes say the subscribed coordinator is busy and that this session should not act unless the human asks.
- `templates/agents.md`: a session started for research or a tool task never spawns, stops, or steers on a routed wake.

## Out of scope

- The advisory threshold itself and the hosted ending (F055).
- Seat notifications and the footer.
- Any change to which session the spawn subscribes.

## Acceptance

- A job finishing while its coordinator is mid-turn is not offered to an idle helper session within the grace window; after the window it is offered only to a session with a subscriber or watch record.
- An injected wake whose turn ends `error` leaves the attempts counter unchanged and is delivered on the next successful turn.
- Two sweeps cannot deliver one completion twice to one session.
- The wake string begins with the label and task sentence and ends with the instruction; tests assert the order.
- The wake suite passes.

## Notes

Fallback exists so a job started from a dead session is not orphaned. Minutes of grace keep that safety net; seconds turned it into a race.
