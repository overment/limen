# F004-session-notification-routing · Conversation-scoped job notifications

[2026-08-14] [🟢] [PROVEN] [COORDINATOR] PROVEN · F004-session-notification-routing

## Outcome

Several coordinator conversations can share one project without duplicate ambient wakes, while subscribed conversations receive job updates and an idle coordinator catches completions whose subscribers are unavailable.

## Scope

- Record the spawning Pi session as notification provenance and its initial subscriber.
- Let coordinators subscribe or unsubscribe through agent-executed CLI commands.
- Scope footer, start, completion, and Herdr surfaces to subscribed conversations.
- Persist per-conversation delivery receipts and elect one fallback recipient atomically.
- Make completion handoffs drive autonomous inspect/fix/re-review decisions within accepted intent.
- Increase generated job-ID entropy.

## Out of scope

- Restricting global access to job records, branches, or commands.
- A daemon, network service, or cross-machine notification bus.
- Automatically overwriting extensions already customized in initialized projects.

## Acceptance

- Unrelated coordinator windows stay quiet.
- Explicit subscribers each receive at most one terminal handoff.
- An ownerless or unavailable-subscriber completion reaches one idle coordinator, including after all coordinators were closed.
- Natural-language subscription is possible because the coordinator can run `limen watch` with its Pi session environment.
- Worker processes do not inherit coordinator session identity.
- Review rejection causes focused correction and fresh review unless a genuine human decision is required.
