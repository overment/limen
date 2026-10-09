# F935 synthesis

The group was a live fixture for the picture, not a design contest. Both teams read the code that draws the group tree and agreed with each other.

- Team 1 (snapshot, `src/picture/activity.ts`): `linkJobs` puts a job under the job that spawned it when that job is on the page; otherwise a non-coordinator member goes under its team's coordinator from `run.json`. `groupTrees` counts each team and then recounts the same job ids for the group, so the two totals agree by construction.
- Team 2 (viewer and serve, `picture/viewer/live.js`, `src/picture/picture-serve.ts`): `groupHtml` draws the lead line, the team lines, then each team's jobs as trees. A job that is missing from every team list draws as its own tree. Serve reads job folders once a second and pushes a snapshot only when jobs or groups change.

Neither team found a defect. The lead found three in the real run, recorded in `ticket.md` Notes and fixed on main.

Team 2's coordinator committed a notes file on its branch against the read-only brief. It repeated its published findings; the branch was deleted at cleanup and nothing from it landed.
