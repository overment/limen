# F012-herdr-job-spaces · Named Herdr places for every job, including reopen

[2026-08-15] [🟢] [PROVEN] [COORDINATOR] PROVEN · F012-herdr-job-spaces

## Outcome

A job has a place you can see. Spawn opens a named Herdr tab. The name updates as the job starts and finishes. Closing the tab does not lose the job: `limen open <id>` brings the place back. Proving a feature may close that feature’s leftover job tabs; it does not delete the job record.

Without Herdr, spawn still works exactly as today — background process, files, no tab. With Herdr, layout is part of the job.

## Spaces

Herdr has three named layers. Limen maps onto them like this:

```
workspace   = this project          e.g. limen
  tab       = one job               e.g. F009 steer
    pane    = the process in it     log tail, or (F010) the worker itself
```

There is no tab-inside-tab. Child workers for the same feature are sibling tabs in the same workspace (`F009 steer`, `F009 review`). The coordinator stays in its own tab and is never closed by Limen.

| Layer | Whose name | When it changes |
|---|---|---|
| workspace | project / repo directory name | once, on first Herdr spawn from this root |
| tab | job label | spawn; then `· done` / `· failed` / `· stopped` when the process ends |
| agent (if hosted, F010) | short slug of the label (`[a-z][a-z0-9_-]{0,31}`) | spawn; cleared when the agent exits |

A tab name is for humans. An agent name is Herdr’s short handle. They are not the same string.

## Scope

- On spawn, if Herdr is available: ensure a project workspace, create a tab labelled with the job, run a **watch** in it (`tail -f` of `.limen/jobs/<id>/log`). Do not move focus away from the coordinator unless the human asked.
- Record the workspace, tab, pane, and mode (`watch`) in the job directory so reopen does not guess.
- Rename the tab when the job becomes `done`, `failed`, or `stopped`. Do **not** close the tab just because `pi` exited 0 — that exit has already lied (F011).
- `limen open <id|suffix|label>`: if the recorded tab still exists, focus it; if it was closed and the job is still running, recreate the watch tab; if the job is finished, recreate a read-only log tab. Same job, new Herdr ids, written back to the record.
- When a feature folder moves to `done/` or `dropped/`, close leftover tabs for jobs of that feature. Never close the coordinator tab. Never delete `.limen/jobs/<id>/`.
- Names stay readable: job label on the tab; status suffix only after the process ends. Update the name from the job record, not from model chatter.
- Missing Herdr is a skip plus one log line, not a failed spawn.

## Out of scope

- Hosting the worker process itself in the tab (you type into `pi`). That is F010 and sits on top of this layout.
- Making Herdr required for headless spawn.
- Auto-closing a tab when the worker exits.
- Nested tabs, or a new Herdr primitive.
- Changing F007 containment, timeouts, or the JSON stream of ordinary jobs.

## Acceptance

- `limen spawn` inside Herdr opens one new tab named after the job label, in the project workspace, without stealing coordinator focus.
- The job record names the Herdr workspace, tab, pane, and `watch` mode.
- After the job ends, the tab is still there and reads `F009 steer · done` (or failed/stopped). `limen jobs` is unchanged in meaning.
- After the human (or Herdr) closes that tab, `limen open <id>` recreates it. A running job shows the live log again; a finished job shows the stored log.
- `limen open` on a job that never had a tab (spawned without Herdr) creates one if Herdr is available now, or says why not.
- Proving or dropping a feature closes that feature’s leftover job tabs and leaves job files on disk.
- Every existing spawn / stop / jobs / steer test still passes when Herdr is absent.
- `src/` stays inside the structure-test line budget; Herdr calls stay advisory and bounded.

## Notes

The human accepted Herdr as load-bearing **for layout**, not as a replacement for job files. Files remain the source of truth; tabs are a view that can be thrown away and rebuilt.

Reopen cannot revive a dead process. It reopens the place. If F010 later hosts `pi` in the tab, closing that tab still kills the hosted agent; reopen then is a log tab unless the human respawns.

Default close policy: leave finished tabs until the feature is proven. That is the opposite of “close on `done`,” on purpose — F011 exists because `done` is not “the work finished.”

`herdr tab create --label --cwd --no-focus`, `herdr tab rename`, `herdr tab close`, `herdr tab focus`, `herdr workspace create|rename`, and `herdr pane run` are the confirmed commands. Agent names are only needed when F010 starts `pi` in the pane.
