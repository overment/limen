Coordinator review of `c97c02a` (same judgment as F024/F026).

**PASS.** Hosted `stop` writes `stop-requested`, sends `ctrl+c` twice, does not SIGTERM the supervisor or finalize on a timer. Supervisor finalizes `stopped` from missing/session-end when that file exists. Agent still up after 15s → nonzero, record stays `running`. Supervisor-dead + agent missing → stop finalizes directly. Recovery matches the created pane only. Names are `limen-<slug17>-<hex8>`. `--tab --timeout` errors before any job record.

Live probe in `notes.md`: `agent list` rows carry `name` for named agents; name-matching was still rejected as the collision latch.
