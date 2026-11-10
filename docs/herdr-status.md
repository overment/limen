# Reading Herdr and Limen status

A pane can be ready for your next message while its Limen jobs are still
`RUNNING`. Herdr describes the conversation; `limen jobs` and the files in
`.limen/jobs/<id>/` describe the job. Neither tells you that a candidate landed.

`limen status` is the plant inbox for the owner. `Running` lists every
RUNNING job record (including workers in another Herdr workspace) with its tab,
minutes since start, activity, and last tool. `Candidates to inspect` lists
`done` jobs whose branch still has commits outside the checked-out branch; a
clean exit is not approval, so inspect each one before you land it. `Needs a
decision` lists `failed` or `stopped` jobs in the same position. A commit counts
as landed when it is an ancestor of the checked-out branch or a patch-equivalent
copy of one there (cherry-pick, or through an integration branch).
`limen prune --retire` deletes finished, failed, or stopped job records whose
branch is landed (ancestor or cherry-pick) or deleted. Jobs with no unlanded commits appear under no
heading. Both lists cover the last seven days; `Older: N records` counts the
rest, and `limen status --all` lists them under the same headings.
Open groups appear once with their member-branch count and `limen group status <id>`;
the lead decides what lands. Closed groups leave the inbox.
A finish webhook key that a receiver refused (HTTP 401 or 403) shows first, as
`Finish webhook rejects: invalid key`, with the receipt folder of the refused ping.
The status command also lists agent tabs whose working directory is the plant or one of its
repositories. If global Herdr agent discovery fails, `status` checks recent
recorded origin tabs directly and labels them incomplete: a visible tab is not
proof of its coordinator role, and other tabs may be missing. If neither query
works, coordinator status is unknown. A missing repository leaves landing
status unconfirmed. A `done` Herdr tab does not prove a merge. `status` does
not judge review acceptance or choose the next lane.

## Role spaces belong to a project root

Hosted workers, detached log views, and diff views share role spaces labeled
`repo workers · /canonical/path/to/repo` (or the corresponding role). The full
canonical root distinguishes projects with the same directory name; symlink
aliases reuse the same space. An adjacent repository can supply the tab's cwd
without changing the requested role-space root.

An unqualified legacy label such as `repo workers` does not establish project
identity. Limen leaves that space alone and creates a qualified one; it does not
rename, move, or close human spaces. Existing job records still focus their
recorded tabs. If several spaces have the same qualified label, Limen logs an
`ambiguous Herdr role space` advisory instead of selecting one.

## Pane readiness is not job completion

| Herdr state | What it means |
| --- | --- |
| `working` | Herdr sees the agent working. This is not a count of Limen jobs. |
| `idle` | The agent is ready for input and its tab has been seen in the focused UI. |
| `done` | The same underlying idle state after unseen background work finishes. Seeing the tab changes it to `idle`, not the job state. |
| `blocked` | Herdr recognized an approval or question UI. Inspect that evidence. |
| `unknown` | Herdr cannot confidently classify the agent. It does not prove completion. |

Limen adds labels to native `idle` and `done`, without changing Herdr's lifecycle.
For example, `2 RUNNING · 1 watched · 1 unwatched` means there are two unfinished
job records visible here even though the coordinator can take input. The job
names and activity follow, with useful words before the feature number:
`team-2 coordinator · F773 · mbp · tool`, or `session repair · F012 · mini · done`.
A host job names that host. A local job names the seat: a short hostname such as `mini`, or `seat` when the hostname is not a short name.
Legacy feature-first group labels use the same word order in the display.
Details stop after three jobs in each group, but counts include all RUNNING jobs.
The footer shows the same job line. A warning such as `1 of 14 needs attention`
counts only dead jobs, not every running job.

The footer, `limen jobs`, and the reaper use the wrapper's PID and recorded birth
identity to judge its owner. Hosted agent status is a separate fact in `jobs`;
an idle or live agent cannot make a missing or reused wrapper PID look alive.

A finished job stays on the job line until it lands or closes. It lands when
its recorded commits are in the checked-out branch, by the same test as
`limen status`. It closes when its feature folder moves to `done/` or
`dropped/`, or when `limen prune --retire` removes its record. A job without
commits cannot land, so it stays until it closes. Limen checks lands and closes
after each coordinator turn and every 30 seconds. When no running or finished
job remains, the overlay clears. That is not a merge verdict.

**Watched** means this session is subscribed to the job's wakes. **Unwatched**
means the job is visible but this session is not subscribed; another session may
be watching it. Visibility neither claims ownership nor adds a subscription.
The tab's suffix counts only jobs spawned from that tab, so it need not match the
pane's project-wide count or this session's watched count. `· 2 running` counts
live jobs. `· 1 finished` counts finished jobs that have not landed or closed and
that finished after the owner's last message. A Limen wake message does not
reset it.

A job tab's label ends in `· running` while the job runs. Herdr shows a hosted
pane that waits for input as `idle`; the label still says the job runs. A hosted
worker or reviewer also keeps its role and adds `job RUNNING · pane ready`
when the pane settles. Ending a Pi turn or writing a final answer does not end a
hosted job. The worker must finish/exit and the supervisor must record the
terminal state. The reporter reads that record, refreshes through silence, and
releases its overlay on shutdown. Reports are advisory and expire if refresh
stops; an absent label is not proof that the job ended.

When a job finishes, Limen closes its tab. The job log records the result:
`herdr tab close <tab>: closed`, `already closed`, or the refusal. Limen retries a
refused close once. If the retry also fails, the log says
`failed after one retry`, and the tab label changes to the final state, for
example `· done`. `limen open <job>` opens a log view again.

## See what Limen added

`limen highlight on` marks every string that Limen writes into Herdr with `◆`.
Text without the mark is native: Herdr's own or Pi's. The switch is a reading
aid, not a status. It is seat-wide and off by default. It stays in the seat
folder (`~/.limen/highlight`, or `$LIMEN_HOME/.limen/highlight`), so a new shell
and a restarted coordinator keep it. `limen highlight off` turns it off, and
`limen highlight` prints the state and the legend. In a coordinator's Pi session,
`/limen highlight on` and `/limen highlight off` do the same.

While it is on, these start with `◆ `:

- the coordinator pane's display agent, pane title, and `limen` token
- a hosted job pane's display agent and `limen` token
- the stall overlay on a hosted pane
- every job tab label: `◆ fix login · F012 · mbp · running`
- the coordinator tab tail: `chat settings · ◆ 2 running · 1 finished`
- the title of each Herdr notification that Limen shows
- Limen's line in the coordinator's Pi footer

A Limen state label takes the place of Herdr's state word, so the marked label
keeps that word in front: `idle ◆ 2 RUNNING · 1 watched · …`. The state icon,
the state word where Limen reports no label, the agent kind (`pi`, `omp`), the
terminal title that Pi sets, tab numbers, workspace names you typed, and Pi's
own footer stay native. Two Limen strings stay unmarked: role space labels
(`repo workers · /path`), because Limen finds its role spaces by label, and agent
names (`limen-f012-…`), because Herdr allows only `[a-z0-9_-]` in them. Wake
messages are not marked either.

A coordinator pane follows a change within about a second, and a hosted job pane
within a second. The command renames each open job tab that a job record names,
so already open tabs follow at once. While the switch is off, Limen writes the
same text as before the switch existed.

Herdr removes control characters from reported text, so the mark is a
character, not a color. Only your own Herdr config can color it, and only in
sidebar rows. Limen never writes that config. To color `◆` text in the Agent
sidebar, you can add a style rule like this to `~/.config/herdr/config.toml`:

```toml
[ui.sidebar.agents]
rows = [
  ["state_icon", "machine", "workspace", "tab"],
  [
    { token = "agent", rules = [{ starts_with = "◆", fg = "#c026d3" }] },
    { token = "state_text", rules = [{ contains = "◆", fg = "#c026d3" }] },
  ],
]
```

These rows replace Herdr's default Agent rows (the first row is Herdr 0.9.5's
default), so start from your own rows if you changed them. `state_text` shows a
reported state label. A rule cannot color the tab strip or the pane border.
The picture page has its own switch with the same mark and accent; see
[Picture](picture.md#see-what-limen-added).

## Activity is evidence, not a human blocker

`think` is the last recorded thinking activity, not proof that tokens are arriving
now. `think · unwatched` can persist through a long silent hosted turn: the job
remains RUNNING and this session is not watching it. `tool` names tool activity;
`wait` records a turn boundary or waiting activity. Neither silence nor `wait`
says the owner needs to answer a question.

`dead` means the recorded process group was not found while the job record still
says RUNNING. Keep that warning separate from waiting; inspect the job and its
supervisor rather than treating it as successful completion. Likewise, preserve
a real Herdr `blocked` prompt or a recorded blocked advisory instead of replacing
it with a generic idle label.

## Candidate awaiting the owner is not landed work

A job marked `DONE` ended; it may have produced a candidate, partial work, or
nothing. Read its handoff, commits, diff, and exact check results. A candidate
awaiting the owner's review is still awaiting review, even if its tests passed. If a
human decision is needed, name the question; do not infer one from `wait`.

“Merge-ready” is a judgment supported by review and evidence, not a pane state
or an automatic consequence of `DONE`. “Landed” requires the accepted change in
the target branch, with its landing commit named. Limen does not derive either
judgment from activity or introduce a merge-readiness state machine.

## A wake is separate evidence

A completion toast or queued message is not a confirmed coordinator response.
The local wake hook records delivery only after its injected message enters a
turn, gets an assistant answer without error/abort, and Pi settles. The records
under a job's `notify/claims/` and `notify/delivered/` distinguish pending from
confirmed delivery. Confirmation is not the owner's review or proof that a separate
recipient observed a notification.

Automatic per-project finish delivery is a separate channel. Use the canonical
[setup instructions](finish-webhooks.md#automatic-job-delivery) and
[receipt/retry guide](finish-webhooks.md#inspect-failures-and-deliberately-retry),
not a second sender or a routine manual ping.

| Job record | What it proves |
| --- | --- |
| No `finish-webhook-env` | Not configured for this job. Existing jobs without a snapshot remain opted out, even if project config is added later. Do not retrofit them. |
| `finish-webhook`: `attempting` | The automatic attempt was claimed, not confirmed. An interrupted attempt may already have reached the endpoint. |
| `finish-webhook`: `accepted` | The sender reported HTTP acceptance. The recipient's wake remains unobserved until separately confirmed. |
| `finish-webhook`: `failed` | The send failed or could not complete within its bound; the job outcome is unchanged. |

A selected config without a receipt is not acceptance; finalization may still be
in progress or may have been interrupted. Follow the canonical guide before any
deliberate retry: an ambiguous attempt is not permission to send a duplicate.
HTTP acceptance, an observed owner wake, local `notify/delivered/` confirmation,
and the owner's review are four separate facts.
