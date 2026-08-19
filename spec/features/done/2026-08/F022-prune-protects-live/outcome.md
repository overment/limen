# Outcome

## Result

Landed. Prune keeps live checkouts from the job’s own `worktree` record, so detached reviewers survive spawn. The leftover sweep skips paths still in `git worktree list`. A job still in its 10-minute startup window counts as live. Handshake is 10s (`LIMEN_HANDSHAKE_MS`). Spawn prints the real terminal state when the handshake exits because the job is no longer running. The suite runs with `--test-concurrency=1`.

Reviewed PASS at `8a44bb5` (`review-1.md`). `src/proc.ts` auto-merged with F020.

## Date

2026-08-19

## References

- `8a44bb5` / merge `069fb88`
- Implement `2026-08-19-f022-prune-protects-live-889f375a`
- Review `2026-08-19-f022-review-b502caa9`
- `spec/features/done/2026-08/F022-prune-protects-live/review-1.md`
- `spec/features/done/2026-08/F022-prune-protects-live/notes.md`
