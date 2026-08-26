# F047-reload-keeps-wakes · A reloaded coordinator still gets its job wakes

[2026-08-26] [🟠] [ACTIVE] [COORDINATOR] ACTIVE · F047-reload-keeps-wakes

## Outcome

If you reload the coordinator tab, finishing workers still wake that tab. You do not have to run `limen watch --running` just because the session id changed.

## Scope

- Spawn (and continue) records the coordinator Herdr tab beside `origin-session`.
- On wake `session_start`, a running job whose recorded coordinator tab is this tab gets this session as a subscriber, even when the session id is new.
- A coordinator in a different tab still sees those jobs as unwatched.

## Out of scope

- Changing fallback, mute, or delivered-slot protocol.
- Auto-watching terminal history after `/new`.
- Hosted focus restore after overlapping spawns.

## Acceptance

- Running job spawned from tab `w1:t1`, new session id, same `HERDR_TAB_ID`: session start writes this session under `notify/subscribers` and a later completion injects here.
- Running job with a different origin tab: session start does not subscribe; footer still shows unwatched; no start notice.
- Existing unwatched and fallback tests still pass.

## Notes

Seen in mega-live: jobs subscribed to `01a03d39-…` while the live sweeper was `01a03d3f-…`. Completions marked delivered to the old session. The human in the new tab never got the wake. `/reload` and `/new` mint a new Pi session id in the same tab.
