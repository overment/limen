# Outcome

## Result

Landed. Hosted status reads Herdr 0.8.0's nested `result.agent.agent_status` with a flat fallback. CLI failures that are not `agent_not_found` keep the last known status. The supervisor finalizes `missing` after three samples and no longer overwrites in-pane `activity`. `stopHostedAgent` sends `ctrl+c` (live probe in `notes.md`).

Reviewed PASS at `2ef9f40` (`review-1.md`). First review (`8862aa28`) exited without a verdict.

## Date

2026-08-19

## References

- `2ef9f40`
- Implement `2026-08-19-f020-herdr-agent-truth-c27e72de`
- Re-review `2026-08-19-f020-re-review-a9639d8f`
- `spec/features/done/2026-08/F020-herdr-agent-truth/review-1.md`
- `spec/features/done/2026-08/F020-herdr-agent-truth/notes.md`
