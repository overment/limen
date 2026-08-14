# F004-session-notification-routing · Outcome

[2026-08-14] [🟢] PROVEN

## Landed

- New jobs record their originating Pi session and subscribe it to scoped status and completion wakes.
- `limen watch`, `watch --running`, `unwatch`, and `unwatch --all` let coordinators follow jobs through ordinary conversation.
- Durable filesystem claims deduplicate subscribed delivery and route an undelivered completion to one idle fallback coordinator.
- Completion handoffs and the coordinator manual now continue ordinary review-fix-review loops autonomously, escalating only genuine human decisions.
- Herdr pane metadata identifies the agent as the Limen coordinator, titles active panes from subscribed job labels, mirrors live status, and clears cleanly without overwriting persistent names.
- Worker environments no longer inherit coordinator `PI_SESSION_*` metadata, and generated IDs use eight random hex characters.
- The unpublished Control migration narrative was removed from the README.

## Evidence

`npm run check` passed: strict TypeScript, Biome, and 51 tests. Coverage includes origin metadata, worker environment scrubbing, watch/unwatch behavior, unrelated-window silence, multiple explicit subscribers, atomic fallback routing, mute catch-up, Herdr titles/descriptions/scoping, and packaged extension installation.
