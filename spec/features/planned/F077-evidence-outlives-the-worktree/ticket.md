# F077 · Proof belongs to the commit it proves

## Outcome

A reviewer can use the evidence the worker produced, because the deciding proof
ran at the commit under review and its files still exist after the worktree is
gone. At Alice 37 of 53 retained proof summaries recorded `dirty: true` at a
pre-commit tree, so reviewers discarded them and marked acceptance unverified
instead — on F457 twice, and on F484, F465 and F456. Workers already write
"copy before prune" into their handoffs because `tmp/` dies with the checkout.

## Scope

- `templates/worker.md`: run the deciding lane at the clean candidate commit,
  after committing, not before it.
- Copy the artifacts a reviewer must read out of the worktree, and name that
  path in the final message.
- `templates/agents.md`: the review handoff carries that path, so the reviewer
  inspects retained evidence before deciding to rerun a lane.
- `templates/reviewer.md`: evidence recorded at a different commit or a dirty
  tree is unverified, and saying so is not a finding against the candidate.

## Out of scope

- A harness-owned artifact store, evidence directory, or retention policy.
- Where a project keeps its artifacts; the path is the project's to choose.
- Pruning behaviour, which already protects live worktrees.

## Acceptance

- The three templates contain their added sentences, asserted by phrase in the
  structure test.
- Each template stays under its current length plus ten percent.
- The structure test passes.

## Notes

The project convention at Alice is `tmp/evidence/FNNN/<phase>/` in the main
checkout, invented per job and re-taught in every prompt. Limen should name the
obligation and leave the path to the project.
