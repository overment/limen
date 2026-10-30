---
touches:
  - limen.sessions.guidance
  - limen.commands
opened: 2026-10-30
---

# F959 · Docs and messages describe a coordinator as a session

## Outcome

Limen's shop manual, docs and messages describe a coordinator as a coordinator session: a Pi session with `LIMEN_COORDINATOR=1` and the Limen hooks. Herdr is one way to reach and show it. A person who runs a coordinator without Herdr reads no sentence that requires a Herdr pane, unless Herdr is the real reason.

## Scope

- `templates/agents.md`: "a hosted session in Herdr" under Coordinator, and the group lines that say "this pane".
- `docs/setup.md`, `docs/jobs.md`, `docs/commands.md`, `docs/finish-webhooks.md`, and `docs/groups.md` ("The lead is this plant's Herdr coordinator pane").
- `limen status`: the "Coordinator tabs" section lists only Herdr agents (`coordinatorLines` in `src/commands/status.ts`).
- Messages that make the lead or the coordinator a Herdr pane: for example the group start and `spawn --role coordinator` refusals, and the `coordinator.exited` handoff "restart it in its pane" (`src/integrations/coordinator-signal.ts:28`).
- A test that asserts an old string changes in place; `test/` holds at most 3,500 lines.

## Out of scope

- The rule lines and the rule ping (F958).
- `limen github …` and its doorbell lines: Adam said to leave them alone.
- `--tab` jobs and "This conversation's tab", which do need Herdr.
- Who registers as a coordinator (F958), and how a wake travels.

## Acceptance

- Each rewritten sentence is true in the code for a coordinator without Herdr, or names Herdr as the reason it is not.
- `grep -n "Herdr coordinator\|coordinator pane\|this pane"` over the Scope files finds only Herdr layout, `--tab` jobs, or `limen github …`.
- `limen status` lists coordinator sessions from live registrations, which F958 limits to `LIMEN_COORDINATOR=1`. It shows the Herdr tab only when a registration has one.
- No changed line uses "seat" for a session.
- No changed line names the app that hosts a session.

## Notes

- Decision, Adam 2026-10-30: the switch alone decides who counts as a coordinator; F958 makes registration need it.
- Say "coordinator session". In Limen, "seat" already means the always-on host ("Seat and window", "seat-wide rule"); it never names a session.
- Group start without Herdr has no live proof yet. Read in the code at `3419a4c`, not run: the lead is found by `PI_SESSION_ID` and the `hook/group-peer.ts` registration, not by a pane.
