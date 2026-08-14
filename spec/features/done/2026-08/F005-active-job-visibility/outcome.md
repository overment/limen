# Outcome

## Result

`limen jobs` now gives coordinators a compact, bounded view of all active jobs; explicit `--all` and job-query forms retain detailed diagnostics. The generated wake extension displays all local active jobs and marks unsubscribed work as unwatched without changing notification ownership.

## Date

2026-08-14

## References

- `src/commands/jobs.ts`, `hook/wake.ts`, and their command/wake regression tests.
- Independent final review: PASS.
- `npm run check`: 58 passing tests.
