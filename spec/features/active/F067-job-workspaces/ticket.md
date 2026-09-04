# F067 · Job tabs live in their own space

## Outcome

The space you talk in holds your conversation and your own tabs. Workers open in a space named after the project plus `workers`, reviewers in one named `reviewers`, so scanning your own tabs no longer means reading past six jobs. Today every job tab lands beside the coordinator: the live `alice` space holds nine tabs, four of them the human's own thinking tabs and the rest jobs, and finding the conversation means hunting.

## Scope

- `ensureWorkspace` in `src/herdr.ts` takes the role that wants the tab. The coordinator keeps `basename(cwd)`; a worker resolves or creates `<project> workers`, a reviewer `<project> reviewers`, both with the project root as cwd and `--no-focus`.
- `openWatchTab`, `openHostedTab`, and `openDiffTab` pass the job's role through `createTab`, so a detached log tail, a hosted tab, and a diff tab all land with their job.
- Hosted start still focuses the job tab, because Herdr will not start an agent in a background pane. Focus restore must return the human to the coordinator's space, not only its tab.
- A role space that empties is left in place and reused by the next job of that role.
- `limen open` and `limen close` already work by tab id; confirm they cross spaces unchanged.

## Out of scope

- Closing, renaming, or rearranging the coordinator's space or any tab a human made.
- Pane splits or layout inside a job space.
- Job records, wakes, state, or anything the coordinator reads as truth.

## Acceptance

- A hosted worker spawned from a coordinator in the `limen` space opens its tab in a space labelled `limen workers`; a `--review` spawn opens in `limen reviewers`; the coordinator's space gains no tab.
- After that spawn the focused space and tab are the coordinator's again.
- A second worker reuses `limen workers` instead of creating another space.
- `limen open <id>` on a finished job focuses or recreates its tab in the job's role space, and `limen close FNNN` closes it from the coordinator's space.
- A live spawn in this repository records the role space in the job's `herdr/workspace`, and the herdr suite passes.

## Notes

The risk worth proving live is focus restore across spaces: the start sequence focuses the job tab, and returning the human needs the coordinator's space back, not just its tab id.
