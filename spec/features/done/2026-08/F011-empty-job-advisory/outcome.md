# Outcome

A terminal job with 0 tool calls and an empty `commits` file now reads **produced nothing** in `limen jobs` (compact snapshot and detail) and in the completion wake. A survey that made tool calls but no commits is not labelled empty. `done` / `failed` / `stopped` are unchanged. Provider stop reasons are appended to the job log.

Landed `5120e89` on `main`. Coordinator-read; no independent review (advisory, cheap to revert). Focused jobs/wake/finalize tests passed on merge.
