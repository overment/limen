---
touches:
  - limen.sessions.wake
  - limen.integrations.herdr
  - limen.commands
opened: 2026-10-30
---

# F958 · Seat-wide rules reach every coordinator session

## Outcome

When a seat-wide rule is set, changed or ended, each live coordinator session gets one ping in its own conversation, with or without Herdr. Today a session without a Herdr pane gets no ping. A Herdr pane without `LIMEN_COORDINATOR=1` no longer counts as a coordinator.

## Scope

- Ping on the session route first, as job wakes do (`hook/wake.ts`). Prompt a Herdr pane only for a coordinator that this route cannot reach, as a group result does (`docs/groups.md:47`). One ping per coordinator for each rule version and kind (set, change, end).
- A rule whose timer died also ends on a seat without Herdr.
- Registration needs `LIMEN_COORDINATOR=1`. A Herdr pane alone no longer registers.
- Seam: `start` (`src/integrations/coordinator-signal.ts:173`), `liveCoordinators` (`:391`) and `broadcast` (`src/commands/rule.ts`).
- The same change updates the rule lines in `templates/agents.md`, `docs/commands.md` and the `limen rule` help in `src/main.ts`, and the docs sentences on registration, such as `docs/finish-webhooks.md:397`.
- The new check replaces the rule pane test (F951) at `test/s2-hosted.test.ts:179`; `test/` holds at most 3,500 lines.

## Out of scope

- Other coordinator wording (F959).
- Practice outside this repository (`outside-limen.md`), and `limen github …`.

## Acceptance

- Proof step, run before this change lands by a person at T3, not a worker: from a T3 Pi coordinator session, spawn a two-minute dummy worker and end the turn. The finish appears as a new turn in that thread, noted in this folder's `notes.md`.
- A session with `LIMEN_COORDINATOR=1` and no Herdr pane gets one set, one change and one end ping, each as a new turn.
- A session in a Herdr pane without `LIMEN_COORDINATOR=1` does not register, gets no rule ping, and sends no coordinator event.
- A coordinator that both routes can reach gets each ping once.
- A Herdr coordinator that the session route cannot reach gets one prompt per rule version and kind.
- With no Herdr binary on PATH, a rule whose timer died ends on the next `limen` command.

## Notes

- Cause, verified by reading the code at `3419a4c`, not by a run: `liveCoordinators` skips a registration with no `pane`. `broadcast` and `endDueRules` return early without a Herdr binary.
- Decision, Adam 2026-10-30: require `LIMEN_COORDINATOR=1` everywhere. The switch alone decides who counts as a coordinator.
- F958 code waits for the T3 proof step. Evidence: `~/Downloads/t3-limen-handling-system-diff.html`, "Open questions".
- Rollout: before the land, restart with the switch each live registered session that runs without it, or that session loses rule pings and coordinator events. Check with `echo $LIMEN_COORDINATOR` in its bash; `ps -E` showed no environment for a live Pi coordinator (2026-10-30).
