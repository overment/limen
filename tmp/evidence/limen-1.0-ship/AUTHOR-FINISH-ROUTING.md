# Finish routing for a shared plant

**Proposal, not installed behavior. Recommend after narrow 1.0:** Alice Mac → Johnny/Tony completed-turn proof remains outstanding. Ticket: `spec/features/planned/F708-ticket-finishes-wake-the-authors-bots/ticket.md`.

## What changes

Today every target gets every finish. An author map filters that private list. Resolve one conventional `Ticket:` pointer from the caller's directory against its repository's committed HEAD, before workspace rewriting. Capture the creation commit and lowercase noreply-derived `@login`, or an unavailable reason, before the worker starts. Bound local lookup without blocking the job on failure. Continuation inherits this evidence; fresh spawn resolves anew. Later ticket moves/removal cannot change the captured author.

This reuses `limen ticket-author`, not the latest editor, current account or verified identity. Ordinary emails yield no login. Non-Git workspace tickets stay unavailable; never borrow a child repository's author. Shared bot-authored commits cannot distinguish humans: collaborators need distinct, accurate creation authors.

## Private configuration — proposed keys, fake values

Upgrade every sender before enabling the map: today's helper ignores it and broadcasts. Keep the ignored, mode-600 `.limen/finish-webhook.env`; do not source it. Alice's bots are targets 1–2; Bob's is target 3.

```dotenv
LIMEN_FINISH_WEBHOOK_TARGETS='[{"url":"https://bots.example.invalid/alice-primary","auth":"Bearer ALICE_PRIMARY_TOKEN"},{"url":"https://bots.example.invalid/alice-secondary","auth":"Bearer ALICE_SECONDARY_TOKEN"},{"url":"https://bots.example.invalid/bob","auth":"Bearer BOB_TOKEN"}]'
LIMEN_FINISH_WEBHOOK_AUTHOR_TARGETS='{"@alice":[1,2],"@bob":[3]}'
```

These are not receiver APIs; obtain authorized routes from each operator. Read the map only from the selected private file. Keys are lowercase `@login` or `*`; values are nonempty lists of distinct integer target numbers in 1–64, present in the configured list. Use each author key once. Malformed entries, duplicate target numbers or invalid references fail before sending. Single URL/AUTH is target 1; TARGETS still replaces it.

An exact author match sends only to its list, once per selected target. Otherwise send only to `*`, if explicitly configured; otherwise record a visible **not sent: no author route** reason. For example, adding `"*":[3]` deliberately makes Bob the fallback for missing attribution too—it does not add Bob to Alice's mapped finishes. No map preserves legacy fan-out. An empty or invalid map setting is not permission to broadcast.

## Failures and recovery

- **Unavailable author:** absent/ambiguous pointer, missing/uncommitted ticket, shallow history, timeout, ordinary email, or missing evidence on older jobs uses only explicit fallback, otherwise skips. Never infer from labels, feature numbers or current operator.
- **Configuration changes:** read map and credentials together at send time. Edits can reroute outstanding jobs; removing the map restores broadcast. Keep target positions stable; append new ones. Private configuration is trusted, not a tenant security boundary.
- **Bad route or partial failure:** invalid config sends nothing; rejection/timeout never triggers fallback to somebody else. Keep the existing single automatic attempt and shutdown bound. Inspect receivers before a deliberate retry; accepted requests can duplicate. A job-based retry must carry the captured author context, not rerun Git; standalone sends without it use fallback/skip. Narrow any retry config explicitly.
- **Honest evidence:** retain author/commit or unavailable reason, selection reason and original ordinals before sending—no URLs, tokens or raw email. Selecting targets 1 and 3 must not renumber 3 as 2. `receivers.json` describes actual ordinals; it never authorizes sending. HTTP acceptance is not a correlated completed bot turn.

**Wake ≠ adopt.** Payload `job`, `status`, `branch` and `finishEvent` stay unchanged. A bot reports the finish; it does not subscribe, take over, steer or merge because it received it. Origin/subscribers stay untouched. This proposal read no private configuration and sent no webhook.
