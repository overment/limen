---
opened: 2026-10-09
---

# F935 · A real group shows as one tree on the live picture

## Outcome

Adam can watch a real `limen group` run on the served picture (`http://127.0.0.1:4747/`): the lead, each team coordinator, and each team's workers sit in one tree with live state counts. The group tree on the live strip landed earlier (F934, live jobs on the picture), but it was proven only with a fixture group, because a job cannot start a group. This ticket proves it with a real group started from the owner's lead pane, and fixes what the real run shows wrong.

## Scope

- One cheap real group: 2 teams, 2 workers per team, OMP, `xai-oauth/grok-4.7`, about 15 minutes.
- Members are read-only: read a few picture files, wait, publish one finding. No code changes.
- Screenshots of the live strip from vscreen while members run, filed in this folder.
- A gap the real run exposes is fixed in the live snapshot (`src/picture/activity.ts`) or the viewer (`picture/viewer/live.js`).

## Out of scope

- New picture features beyond the group tree.
- Group transport, receipts, or launch behavior.

## Acceptance

- During the run, the live strip shows one tree: the lead line, two team lines, and two workers under each team coordinator.
- The lead line and each team line show state counts that match `limen group status`.
- Screenshots of that tree are in this folder.
- After close and prune, the group tree leaves the strip.

## Notes
