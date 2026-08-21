# F033 outcome · hosted focus restore

Landed at `6ee8ff1` (2026-08-21, coordinator-written, suite-covered).

`startHostedPi` now reads `herdr tab get <jobTab>` after agent start: restore of the coordinator tab runs only when the job tab still holds focus (`focused === true`) or focus state is unavailable; when the human took focus elsewhere during the start window (`focused === false`), restore is skipped. Every outcome — restored / skipped / failed / check-failed — lands in the job log.

Proven live: job `2026-08-21-f034-continue-try-30eeedf4` log carries `[limen ...] coordinator tab restored` against real Herdr 0.8.
