# F719 · Concurrent starts keep their work

## Outcome

Two overlapping starts keep both job records and both worktrees. Cleanup still removes genuine leftovers. An operator can launch a second job while the first is still preparing without finding an empty cabinet.

## Scope

- Start at spawn's worktree-then-prune path (`src/commands/spawn.ts`) and prune's empty-state deletion (`src/commands/prune.ts`).
- The windows to reproduce are a worktree with no job directory yet, and a job directory after files are written but before `state`. Empty `state` is how prune currently treats both an in-flight start and garbage.
- Reproduce first: write a discriminating overlapping-start check, then change runtime only if that check fails.
- Preserve genuine orphan cleanup. A half-written job directory with no evidence of an in-flight start still goes.
- Job files remain truth. Do not add a starting phase or a new workflow state.

## Out of scope

- Treating every directory that contains `task.md` as live (that keeps the leftovers prune is meant to delete).
- Rewriting Git's missing-binary message or PATH fallbacks; a failed command alone does not establish the cleanup race.
- Wiring pulse or steer through process identity, or turning prepare into a gate.

## Acceptance

- A deterministic check reproduces loss on the unchanged baseline before a runtime fix is accepted; an unreproduced hypothesis is reported rather than patched speculatively.
- Overlapping starts keep both worktrees through the interval before either job record is fully published.
- A second spawn or explicit prune cannot delete a live start during a deliberately delayed prepare step.
- Prune still deletes a half-written directory with `task.md`, no `state`, and no evidence of an in-flight start.
- An interrupted start remains reclaimable rather than becoming a permanent orphan.
- Existing spawn canonical-record and prune leftover checks pass without introducing a new job phase.

## Notes

Research proposed a specific write-order and grace-window guard (`spec/research/code-clarity/judgment.md`). That fix is unverified. The overlapping-start test decides whether any runtime change is needed; do not land the proposed guard unless the test shows the loss.
