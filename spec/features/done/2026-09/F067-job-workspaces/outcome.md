# Outcome

Worker tabs open in a space named `<project> workers` and reviewer tabs in `<project> reviewers`, so the space you talk in holds only the coordinator conversation and your own tabs. A hosted start still focuses the job tab, because Herdr will not start an agent in a background pane, but it now returns you to the coordinator's space as well as its tab. The first job tab replaces the empty tab Herdr seeds a new space with, and a role space that empties disappears on its own.

Landed `63a9179`, with the seeded-tab fix at `7f9408d`. Merged on coordinator inspection with the full check suite green; no independent review was bought for a change this visible and this cheap to revert.

Proven live in both projects: the alice space went from nine tabs to eight, and the next job spawned there opened in `alice workers`. Not proven: `--review` routing and `limen close FNNN` across spaces, both covered by tests only.
