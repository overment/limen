# Outcome

## Result

Landed. A `running` job whose process group stays dead across two observations 10s apart, past the startup grace, becomes `failed: process group gone` and wakes. Recycled macOS pgids cannot fake life. A hosted job whose agent still answers is left running.

Coordinator-reviewed at `4edcba3` (`review-1.md`). This closes the original 2026-08-18 stability sweep (F020–F026).

## Date

2026-08-19

## References

- `4edcba3`
- Implement `2026-08-19-f025-dead-job-reaper-a135ebc9`
