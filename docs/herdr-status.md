# Reading Herdr and Limen status

A pane can be ready for your next message while its Limen jobs are still
`RUNNING`. Herdr describes the conversation; `limen jobs` and the files in
`.limen/jobs/<id>/` describe the job. Neither tells you that a candidate landed.

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
names and activity follow; details stop after three jobs, but counts include all
RUNNING jobs. When none remain, the overlay clears; that is not a merge verdict.

**Watched** means this session is subscribed to the job's wakes. **Unwatched**
means the job is visible but this session is not subscribed; another session may
be watching it. Visibility neither claims ownership nor adds a subscription.
The tab's `· N running` suffix counts jobs spawned from that tab, so it need not
match the pane's project-wide count or this session's watched count.

A hosted worker or reviewer keeps its role and adds `job RUNNING · pane ready`
when the pane settles. Ending a Pi turn or writing a final answer does not end a
hosted job. The worker must finish/exit and the supervisor must record the
terminal state. The reporter reads that record, refreshes through silence, and
releases its overlay on shutdown. Reports are advisory and expire if refresh
stops; an absent label is not proof that the job ended.

## Activity is evidence, not a human blocker

`think` is the last recorded thinking activity, not proof that tokens are arriving
now. `think · unwatched` can persist through a long silent hosted turn: the job
remains RUNNING and this session is not watching it. `tool` names tool activity;
`wait` records a turn boundary or waiting activity. Neither silence nor `wait`
says Adam needs to answer a question.

`dead` means the recorded process group was not found while the job record still
says RUNNING. Keep that warning separate from waiting; inspect the job and its
supervisor rather than treating it as successful completion. Likewise, preserve
a real Herdr `blocked` prompt or a recorded blocked advisory instead of replacing
it with a generic idle label.

## Candidate awaiting Adam is not landed work

A job marked `DONE` ended; it may have produced a candidate, partial work, or
nothing. Read its handoff, commits, diff, and exact check results. A candidate
awaiting Adam's review is still awaiting review, even if its tests passed. If a
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
confirmed delivery. Confirmation is not Adam's review or proof that a separate
recipient observed a notification.

Automatic per-project finish delivery is a separate channel. Use the canonical
[setup instructions](finish-webhooks.md#automatic-job-delivery) and
[receipt/retry guide](finish-webhooks.md#inspect-failures-and-deliberately-retry),
not a second sender or a routine manual ping.

| Job record | What it proves |
| --- | --- |
| No `finish-webhook-env` | Not configured for this job. Existing jobs without a snapshot remain opted out, even if project config is added later. Do not retrofit them. |
| `finish-webhook`: `attempting` | The automatic attempt was claimed, not confirmed. An interrupted attempt may already have reached the endpoint. |
| `finish-webhook`: `accepted` | The sender reported HTTP acceptance. Tony's/Adam's wake remains unobserved until separately confirmed. |
| `finish-webhook`: `failed` | The send failed or could not complete within its bound; the job outcome is unchanged. |

A selected config without a receipt is not acceptance; finalization may still be
in progress or may have been interrupted. Follow the canonical guide before any
deliberate retry: an ambiguous attempt is not permission to send a duplicate.
HTTP acceptance, an observed owner wake, local `notify/delivered/` confirmation,
and Adam's review are four separate facts.
