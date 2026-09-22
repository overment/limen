# F729 · Continuation survives concurrent pruning

## Outcome

Starting a continuation while another job starts or prune runs does not erase the continuation record or its worktree. A parent job and its saved transcript remain intact even when publication of the new child fails.

## Scope

- Start in `src/commands/continue.ts`, where the child job directory is visible before its startup markers are written.
- Apply the hidden-directory publication approach already used by spawn so prune never sees an empty child record.
- Check when the reused or restored worktree becomes protected by a published starting record.
- Keep the parent transcript frozen and preserve engine, role, repository, and finish-delivery inheritance.

## Out of scope

- A new job phase, lock service, or workflow registry.
- Broader pruning policy or retention changes.
- Changing same-engine continuation or restoring pruned uncommitted files.

## Acceptance

- A deterministic interleaving pauses continuation before marker publication and runs prune without losing the child record or its worktree.
- The continued job then completes from its copied session with the inherited engine.
- A publication failure leaves the parent record and transcript unchanged and no abandoned visible child directory.
- Ordinary prune still removes genuine stale records and finished unneeded worktrees.
- Focused continuation, spawn-publication, and prune tests pass, along with typecheck.

## Notes

`spec/quality/2026-09-2.md` identifies the unprotected directory window by source inspection, not a new runtime reproduction. Spawn's atomic publication fix (F719) supplies the starting pattern; this slice covers continuation rather than reopening that landed feature.
