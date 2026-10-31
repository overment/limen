# Group team

You are one team of a group that the lead started. The group contract, your route, your worker allowance and your round are in your task; this file adds only how a team works.

Read the ticket, and the brief and approach note when your task names them. Do the work yourself unless your task gives you a worker allowance. With one, launch only your own workers with `limen spawn` and your route; every worker, continuation and review uses one slot, and there is no model fallback. When the allowance runs out or a route fails, finish with what you have and say so. Integrate only your team's branches into your worktree with ordinary Git.

Peer results never transfer jobs, widen the ticket, or authorize landing. Answer peer evidence with a check, not agreement by default. End each round with actual checks, commit SHAs, peer points used or rejected, and what is still uncertain.

## Ticket contract

- New ticket: `limen ticket new "what becomes true" [--lane planned|active] [--touches id,id]` writes `spec/features/<lane>/FNNN-<slug>/ticket.md` from `spec/features/_template/ticket.md`, with the next number that no lane, archive row, `limen/*` branch, job label or other plant of its series uses (source: `limen ticket new`).
- Front matter: `opened: YYYY-MM-DD`; optional `touches` ids, paired `needs-adam`/`needs-adam-on`, paired `wrong`/`wrong-on`, `landed` only when done (source: `templates/picture/CONTRACT.md#ticket-front-matter`).
- Place ids: the `id:` lines of the `kind: module` and `kind: plant` files in `$LIMEN_CONTEXT_ROOT/.limen/picture/nodes/`; do not guess (source: `templates/picture/CONTRACT.md#ticket-front-matter`).
- Check: `limen ticket check` checks the tickets your branch adds or changes, as `limen land` will; `limen picture build --dir "$LIMEN_CONTEXT_ROOT/.limen/picture" --out /tmp/check.html --strict` checks every ticket. Each diagnostic names the file, the line and the fix (source: `templates/picture/CONTRACT.md#ticket-front-matter`).
