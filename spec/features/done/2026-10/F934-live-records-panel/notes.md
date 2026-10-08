# F934 notes

## Seams

- Parent link: `publishJob` (`src/job/publication.ts`) writes `spawned-by` from `LIMEN_JOB_ID` when a job's agent runs `limen spawn` or `limen continue`. Hosted and detached jobs both export that id. The older `parent` file stays what it was: the job a continuation continues.
- Live snapshot (`src/picture/activity.ts`): each job carries `role`, `parent`, `group`, `team`. `parent` is kept only when that job is on the page. A group worker with no `spawned-by` (jobs from before this change) goes under its team's coordinator. `groups` holds one tree per `limen group` run with a member on the page, read from `.limen/groups/<id>/run.json`, with state counts per team and for the group.
- `limen picture serve` sends a snapshot when jobs or group trees change, not on the clock alone.
- Viewer (`picture/viewer/live.js`): one renderer draws trees for the strip and for the "Jobs on this now" block in the side panel. Group lead line, team lines, then coordinator and workers. Hover shows a small card; a click selects the job. A job that names a feature opens `#work/<id>` and shows its details under its line; a job with no feature shows a job entry at the top of the reading column. A record already in the panel opens in place. The selection belongs to the panel route that showed it; another route clears it.
- A click on a place mark or a feature tag opens the first job of its list: a job that stopped responding first, then by state.

## Proof

- Coordinator view: real jobs. This job spawned `F934 proof coordinator` (omp, xai-oauth/grok-4.7), which spawned two workers with the branch's `limen spawn`. All three wrote `spawned-by`; the strip nests them (`live-3-coordinator-with-workers.png`).
- Group view: a fixture group in `/tmp`, in the real file format (`run.json`, `group`, `team`, `spawned-by`), served with the branch code over the real plant map. A real `limen group start` needs the owner's lead pane, which a job cannot be (`live-4`, `live-5`, `live-6`).

## Decisions

- The lead is a session, not a job, so the tree's root line is the lead with the whole group's count.
- The strip shows about eight lines before it scrolls, room for a coordinator and its workers.
