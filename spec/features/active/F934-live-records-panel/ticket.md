---
touches:
  - limen.picture.viewer
  - limen.picture.build
  - limen.cabinet.records
opened: 2026-10-08
---

# F934 · A live job on the picture opens in the side panel and shows its workers and its group

## Outcome

Adam points at any live job on the served picture and sees who it is, which engine and model run it, what it does, and how long it has run. A click opens the job in the side panel: on its feature when it names one, or as a job entry when it does not. A coordinator shows the workers it spawned under it, and a `limen group` run shows its lead, teams, and workers as one tree with live counts rolled up, so Adam can see who is stuck without opening a terminal.

## Scope

- Every live record on the served page: strip lines, feature tags, and place marks.
- A spawn from inside a job records which job spawned it; the picture uses that link and the group roster.
- Group trees come from the group run record and the `group` and `team` files of member jobs.
- The existing side panel (the reading column) shows the selected job; no new banner.

## Out of scope

- Steering, stopping, or landing a job from the page.
- The static built picture: it stays offline and shows no live records.
- Changing group event routing or the group roster's own `parent` field.

## Acceptance

- Hovering a strip line, a feature tag, or a place mark shows the job's label, engine and model, state, last activity, and run time.
- A click on a job that names a feature opens that feature in the side panel, scrolls to it, and marks the job there with its details.
- A click on a job with no feature shows a job entry at the top of the side panel.
- A job spawned from inside another job writes `spawned-by`, and the page nests it under that job with its own state.
- A group shows lead, teams, and members as one tree; the group and each team show how many members are working, waiting, or not responding.
- `limen picture build --strict` still passes and its file has no live layer.
