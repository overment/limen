---
touches:
  - limen.picture.viewer
  - limen.picture.build
opened: 2026-10-09
landed: 2026-10-09
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

Real run: group `c25d8b91-5d60-4626-9b5b-5a8d872c0890`, 2 teams × 2 workers, OMP `xai-oauth/grok-4.7`, low reasoning, detached. The tree was right in shape from the first frame: lead, team lines, each coordinator under its team, workers under their coordinator. Counts matched `limen group status` (`real-5-counts-match-status.png`: 2 working · 4 done on both).

Gaps the real run showed, fixed in `6287b2f`:

- A group worker's label comes from its coordinator (`team-1-worker-1`) and names no feature, so the worker did not count on the feature: the work card said 2 jobs with 3 running (`real-2-tree-one-worker.png`). A group member now also takes its group's feature (`linkJobs`, `src/picture/activity.ts`).
- The lead line showed the lead's raw session id. It now shows the group's time left; the hover and job details say the same.
- The strip held about eight lines, so the fourth worker of a 2×2 group scrolled out of sight (`real-3-tree-before-fix.png`). It now holds about ten (`real-4-tree-after-fix.png`).

Not a picture gap: the first run (`61cd0002-…`) failed because the machine waited on disk (load average near 285) and the detached wrapper missed the 10 s start handshake. The second run used `LIMEN_HANDSHAKE_MS=90000`.
