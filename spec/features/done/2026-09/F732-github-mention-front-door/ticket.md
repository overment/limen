# F732 · A mention reaches the warm coordinator

## Outcome

An authorized collaborator can comment `@limen` or `/limen`, with optional free text, on an open PR and receive a visible start and finish reply. The owning seat hands the complete relevant PR and comment context to its registered, live Herdr coordinator, which decides whether to start a hosted worker, review, or take another appropriate action. One coordinator can handle several registered repositories on the same seat without a pane per repository.

## Scope

- Start at `src/github-poller.ts`, `src/commands/github.ts`, and the existing private-claim reconciliation; keep one isolated App poller on the seat and the existing credential boundary.
- Match exact mention tokens, not substrings or quoted/code impersonation; only PR issue comments by effective write-or-higher collaborators in installed and registered repositories.
- Include PR title/body, diff/commits link, existing discussion and triggering comment text as untrusted data, bounded for a usable coordinator prompt; preserve repository, pinned base/head, comment ID, actor and URL.
- Add `limen github ensure` to inspect/reach the bound live agent before prompting; ensure is safe and meaningful for several repositories targeting one warm coordinator.
- Recover pending/unconfirmed claims after a missing-agent or bare-shell delivery failure without creating duplicate jobs or duplicate PR replies. A pending request stays visible until a safe retry succeeds or the operator must intervene.
- Start/finish replies reflect the actual hosted job or coordinator outcome, not prompt acceptance; no silent detached fallback.

## Out of scope

- Changes to iceener/alice, App credential ownership, GitHub Actions, automatic merge/push/approval, or issue comments outside PRs.
- A pane per repository, persistent workflow engine, or verbs beyond optional sugar for a review request.
- Replacing the existing F014 App poller and claim store.

## Acceptance

- A write-authorized `@limen please review this` or `/limen` on a PR reaches the live coordinator with PR plus comment context, and a corresponding hosted job gets one start and one terminal PR reply.
- `@limenology`, `/limenish`, an unauthorized actor, or an issue that is not a PR produces no claim or job.
- A coordinator unavailable at first delivery causes a visible pending notice; after it becomes live, safe retry produces one handoff, never a detached or duplicated job.
- Two registered repositories can target one live coordinator and receive correct repo-specific context and receipts independently.
- A moved PR SHA fails closed for a review; no worker can read App keys or forge authoritative poller claims.
