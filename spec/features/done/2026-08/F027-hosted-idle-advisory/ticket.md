# F027-hosted-idle-advisory · A hosted worker that stalls taps the coordinator's shoulder once

[2026-08-20] [🟢] [PROVEN] [COORDINATOR] PROVEN · F027-hosted-idle-advisory

## Outcome

A hosted worker that finished its tools and then sat in the open TUI — or hit an approval or login prompt — does not wait silently until a human happens to look. The coordinator gets one advisory wake naming the stall; the job stays `running` and nothing is auto-closed. The known failure mode "worker never exits pi, coordinator never hears anything" gets an attention channel without touching the completion semantics.

Two such taps in the same moment do not collide: the first idle wake is a real user turn; every later wake in that sweep is `deliverAs: "followUp"`. Queue, do not coalesce, do not drop. Pi's follow-up list is the delay; job files remain truth if the tab dies with follow-ups still queued.

This deliberately respects the standing decision in `docs/remote.md`: Herdr `idle`/`done` is unseen background, not completion, and there is no idle-after-tools timer that marks a job `done`. F017 fixed completion to session end; this feature only adds *noticing*. The worker preamble already tells hosted workers to exit when finished — this is the backstop for when they don't.

## Scope

- **Detect the stall.** The hosted supervisor (`runHostedSupervisor` in `src/proc.ts`), which after F020 reads real agent statuses, tracks the last transition out of `working`. When the agent has been continuously non-working (`idle`/`done`) for a threshold (default 10 minutes, env-overridable) *and* the job has at least one recorded tool call, it writes a durable marker (e.g. `.limen/jobs/<id>/advisory` holding one line: `idle 10m after 14 tool calls, session still open`).
- **`blocked` is immediate.** An agent status of `blocked` (approval or question UI) writes the marker without waiting for the threshold — a hosted worker stuck on a prompt is exactly what the human needs to see now.
- **One advisory wake.** The wake extension (`hook/wake.ts`) treats the marker like a deliverable: it sends one advisory `sendUserMessage` through the existing claim machinery (its own slot, so subscribed-vs-fallback routing and dedup work as for completions), with text that names the job, the stall, and the two honest moves — steer it, or open the tab and finish/exit. Re-arm only if the agent works again and re-stalls; never a repeating nag.
- **Serialize wakes.** In `sendCompletion` (and the advisory send that reuses it), the first inject while `isIdle()` in a sweep is `sendUserMessage` with no `deliverAs`. Every later inject in that same sweep — and any inject while not idle — is `deliverAs: "followUp"`. Do not merge two jobs into one message. Do not invent a limen-side wake queue. Reset the "already injected" latch at the start of each sweep. Toasts may both fire.
- **Visible in the record.** `limen jobs` shows the advisory line for a running hosted job that has one.

## Out of scope

- Marking anything `done`, `failed`, or `stopped` — no state change, ever, from this feature.
- Auto-steering, auto-exiting, or sending keys to the agent.
- Detached jobs: the JSON stream either progresses or the timeout bounds it; `silent` in `limen jobs` already shows a hung provider call.
- Herdr notifications policy beyond reusing the existing toast beside the wake, muted like everything else (F023).
- Changing `followUpMode` or other Pi settings.

## Acceptance

- A fake hosted agent that goes `working → idle` and stays idle past a shortened threshold, with tool calls recorded, produces exactly one advisory wake in the subscribed coordinator and the marker in the record; the job remains `running`.
- The same sequence with zero tool calls produces no advisory (a worker still reading its ticket is not a stall).
- A `blocked` status produces the advisory promptly without the threshold.
- Work resuming (`idle → working`) and stalling again re-arms exactly one further advisory.
- Completion after an advisory delivers the normal completion wake; the advisory claim does not block it.
- Two terminal jobs observed in one idle sweep: first `sendUserMessage` has no `deliverAs`; second has `deliverAs: "followUp"`; both claims land; neither message is a merge of the two jobs.
- A second inject while the session is already not idle is always `followUp`, even if it is the first job in that sweep.
- Muted sessions receive neither the wake nor the toast until unmuted. `npm run check` green.

## Notes

F020 is proven — `hostedAgentStatus` is a real signal. Observed 2026-08-20 in alice-app: F287 `f15863aa` and F286 `c0f51313` had commits, last tool then `wait`, `state` still `running`, no `result`, no completion wake, parent `01a01ef1` never injected. That is this ticket.

Seams: `runHostedSupervisor` in `src/proc.ts`; `sendCompletion`/`observe` and the claim helpers in `hook/wake.ts` (the advisory should reuse `claimDelivery` with a distinct slot name rather than inventing a channel); `renderJobDirectory` in `src/commands/jobs.ts`. The threshold is an attention knob, not a correctness bound — err long; a false tap costs more trust than ten quiet minutes.
