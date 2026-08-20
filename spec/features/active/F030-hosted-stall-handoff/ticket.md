# F030-hosted-stall-handoff · A hosted stall wakes the parent with the worker's last message

[2026-08-20] [🟠] [ACTIVE] [COORDINATOR] ACTIVE · F030-hosted-stall-handoff

## Outcome

When a hosted worker finishes the work and sits in the open TUI, the subscribed coordinator gets a wake that already carries `result` and `commits`. Nobody pastes. The job stays `running`; the tab stays open. Observed 2026-08-20 on alice F292: the worker had committed and written a final message; the parent never saw it; the human pasted.

F027 already writes `advisory` and taps once. That tap is too late (default 10 minutes) and too empty (steer-or-open, no handoff). This feature fills the handoff and shortens the stall bound. It does not reverse F017: Herdr `idle` is still not `done`.

## Scope

- **Snapshot on stall.** `noteHostedIdle` calls `writeHostedResult` and `recordCommits` *before* writing `advisory`, so the wake already has the excerpt. No finalize. No `finished-at`. `state` stays `running`.
- **Wake carries the handoff.** `sendAdvisory` appends the same `handoffExcerpt` completion wakes use (stop-reason, commits, final message). The lead sentence still says the job is running. Honest moves: inspect and continue the loop; steer; or open the tab and exit if you mean the session to end.
- **Shorter bound.** Default `LIMEN_HOSTED_IDLE_MS` is 60 seconds (F027 shipped 10 minutes). Env still overrides. `blocked` stays immediate. Zero tool calls still do not advisory.
- **Thinking is not idle.** The stall clock for `idle`/`done` runs only while job `activity` is `wait` (hosted hook: `turn_start` → think, tool → tool, `turn_end` → wait). `think` and `tool` mean the agentic loop is still going, including reasoning with no tools yet. Herdr `working` still resets the clock. Do not advisory a thinking turn even if Herdr already says `idle`/`done`.
- **Tests.** A fake hosted agent that goes idle after tools within a shortened bound: `advisory` + `result` + `commits` on disk, one advisory wake containing the final-message excerpt, `state` still `running`. Completion after that still delivers the ordinary done wake.

## Out of scope

- Marking `done` / `failed` / `stopped` from idle.
- Auto-exiting the hosted agent or closing the tab.
- Detached jobs.
- Changing F027's claim slots or mute/fallback routing.

## Acceptance

- Hosted idle after ≥1 tool past 60s while `activity` is `wait` (test uses a short env): `result` is the last assistant text from the session jsonl, `commits` is the branch-since-base list (empty file is a fact), `advisory` is written, one subscribed wake includes that excerpt, `state` is `running`. Idle/done while activity is think or tool does not advisory.
- A later session-end still finalizes `done` and delivers the completion wake; advisory claim does not block it.
- `LIMEN_HOSTED_IDLE_MS` still overrides. `npm run check` green on the F030 files.

## Notes

Stall clock for Herdr `idle`/`done` only while job `activity` is `wait` (hosted hook: `turn_start`→think, tool→tool, `turn_end`→wait). Do not advisory while activity is think or tool — that is the agentic loop still going, including reasoning. Herdr `working` still resets. `blocked` stays immediate.

Seams: `noteHostedIdle` / `writeHostedResult` / `recordCommits` in `src/proc.ts` (`recordCommits` is currently used only from `finalizeJob` — export or call it); `sendAdvisory` in `hook/wake.ts`; `DEFAULT_HOSTED_IDLE_MS`. Worker preamble already says exit when finished; this is the backstop when they don't.
