# F708 · Ticket finishes wake the author's bots

## Outcome

Colleagues sharing a plant can send ticket finishes only to the author's configured bots, not every project receiver. Missing attribution has an explicit fallback, never a guessed human. A wake informs; it does not transfer ownership.

## Scope

- Start at finish configuration selection in `src/commands/spawn.ts`: resolve one conventional `Ticket:` pointer using the creation-author evidence behind `limen ticket-author`.
- Capture lowercase noreply-derived `@login` and creation commit, or an unavailable reason, at spawn; `continue` inherits it. Bound lookup locally; no identity lookup at finish.
- Extend the selected private env with `LIMEN_FINISH_WEBHOOK_AUTHOR_TARGETS`, mapping `@login` to existing target ordinals; optional `*` names fallback targets. Single URL/AUTH is target 1. Preserve original ordinals when filtering.
- Read routing with credentials at send time. Without the map, retain current fan-out; with it, use the matching list exclusively, otherwise `*`, otherwise visibly skip. Invalid configuration sends nothing, never falling back to fan-out.
- Show attribution, selection reason and original ordinals without secrets; preserve project opt-in, payload correlation, bounded delivery and deliberate retries. Receiver evidence describes selection, never authorizes sending.

## Out of scope

- GitHub API calls, email aliases, requester inference behind shared Git identities, or ticket author fields.
- Receiver services, automatic retries, polling, signing infrastructure, or new ownership/subscription behavior.
- Replacing operator-trusted completed-turn evidence (F091); HTTP acceptance is not a bot turn.

## Acceptance

- Real-Git tests show two collaborators' hosted/detached finishes reach only their mapped targets despite later ticket edits and recognized lane moves.
- Missing/ambiguous pointers, non-Git tickets, shallow history, ordinary email and unmapped logins each select only `*`, or visibly send nothing when absent.
- Invalid maps or target references make zero requests and leave the terminal job result intact.
- A continuation retains its captured author after ticket removal; a fresh spawn uses its own ticket evidence.
- Legacy fan-out and filtered per-target receipts preserve their original target numbers, including during partial transport failure.
- An authorized two-author receiver check correlates completed turns to each selected bot without changing origin/subscribers; HTTP-only acceptance remains unobserved.

## Notes

Configuration and recovery contract: [operator note](../../../../tmp/evidence/limen-1.0-ship/AUTHOR-FINISH-ROUTING.md).
