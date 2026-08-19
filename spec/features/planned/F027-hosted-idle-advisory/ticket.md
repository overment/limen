# F027-hosted-idle-advisory · A hosted worker that stalls taps the coordinator's shoulder once

[2026-08-19] [🔴] [PLANNED] [COORDINATOR] PLANNED · F027-hosted-idle-advisory

## Outcome

A hosted worker that finished its tools and then sat in the open TUI — or hit an approval or login prompt — does not wait silently until a human happens to look. The coordinator gets one advisory wake naming the stall; the job stays `running` and nothing is auto-closed. The known failure mode "worker never exits pi, coordinator never hears anything" gets an attention channel without touching the completion semantics.

This deliberately respects the standing decision in `docs/remote.md`: Herdr `idle`/`done` is unseen background, not completion, and there is no idle-after-tools timer that marks a job `done`. F017 fixed completion to session end; this feature only adds *noticing*. The worker preamble already tells hosted workers to exit when finished — this is the backstop for when they don't.

## Scope

- **Detect the stall.** The hosted supervisor (`runHostedSupervisor` in `src/proc.ts`), which after F020 reads real agent statuses, tracks the last transition out of `working`. When the agent has been continuously non-working (`idle`/`done`) for a threshold (default 10 minutes, env-overridable) *and* the job has at least one recorded tool call, it writes a durable marker (e.g. `.limen/jobs/<id>/advisory` holding one line: `idle 10m after 14 tool calls, session still open`).
- **`blocked` is immediate.** An agent status of `blocked` (approval or question UI) writes the marker without waiting for the threshold — a hosted worker stuck on a prompt is exactly what the human needs to see now.
- **One advisory wake.** The wake extension (`hook/wake.ts`) treats the marker like a deliverable: it sends one advisory `sendUserMessage` through the existing claim machinery (its own slot, so subscribed-vs-fallback routing and dedup work as for completions), with text that names the job, the stall, and the two honest moves — steer it, or open the tab and finish/exit. Re-arm only if the agent works again and re-stalls; never a repeating nag.
- **Visible in the record.** `limen jobs` shows the advisory line for a running hosted job that has one.

## Out of scope

- Marking anything `done`, `failed`, or `stopped` — no state change, ever, from this feature.
- Auto-steering, auto-exiting, or sending keys to the agent.
- Detached jobs: the JSON stream either progresses or the timeout bounds it; `silent` in `limen jobs` already shows a hung provider call.
- Herdr notifications policy beyond reusing the existing toast beside the wake, muted like everything else (F023).

## Acceptance

- A fake hosted agent that goes `working → idle` and stays idle past a shortened threshold, with tool calls recorded, produces exactly one advisory wake in the subscribed coordinator and the marker in the record; the job remains `running`.
- The same sequence with zero tool calls produces no advisory (a worker still reading its ticket is not a stall).
- A `blocked` status produces the advisory promptly without the threshold.
- Work resuming (`idle → working`) and stalling again re-arms exactly one further advisory.
- Completion after an advisory delivers the normal completion wake; the advisory claim does not block it.
- Muted sessions receive neither the wake nor the toast until unmuted. `npm run check` green.

## Notes

Depends on F020 — today `hostedAgentStatus` reads every live agent as `unknown`, so there is no real `idle`/`working` signal to build on. Seams: `runHostedSupervisor` in `src/proc.ts`; `sendCompletion`/`observe` and the claim helpers in `hook/wake.ts` (the advisory should reuse `claimDelivery` with a distinct slot name rather than inventing a channel); `renderJobDirectory` in `src/commands/jobs.ts`. The threshold is an attention knob, not a correctness bound — err long; a false tap costs more trust than ten quiet minutes.
