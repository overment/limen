# F736 · One plant plate shows work before another lane starts

## Outcome

A shepherd can ask Limen once whether a plant is running jobs, has completed branches waiting on a coordinator, or is actually clear for new work. The answer comes from the plant's job records and coordinator presence, not Herdr's badge for whichever tab happened to be selected. A separate workers workspace never makes the plant look empty.

## Scope

- Start at `limen jobs` and Herdr status mapping: provide one concise `limen status`/plate command for the current plant.
- Show all current RUNNING jobs from `.limen/jobs`, regardless of Herdr workspace, engine or hosted/detached mode; surface silent/dead/advisory as attention rather than green.
- Show recent finished branches that still await owner landing, distinguish accepted/proven from merely done only with Git evidence; show relevant coordinator tabs across the plant space without treating Herdr `done` as Git completion.
- If Git or Herdr is unavailable, say what cannot be confirmed; never infer an idle plant from one badge.

## Out of scope

- Creating, closing or focusing a Herdr workspace/tab, altering Herdr's native badge algorithm, or inventing a Markdown workflow registry.
- Automatically deciding which product lane should run next.

## Acceptance

- On a plant with coordinators working and workers in another workspace, one command shows both and does not say the plant is done.
- A job's true state and silent/tool activity match `limen jobs` for OMP and Pi in hosted and detached modes; final-but-unmerged work appears as waiting on owner.
- A missing Herdr process reports coordinator status unknown instead of Ready; terminal jobs without pending branch land do not remain forever on the plate.
