# Build

## TRACK

- Reliable in-flight control on one seat; a laptop is a window; GitHub may ring the doorbell later.

## NOW

Stability sweep from the 2026-08-18 reliability review. These three are independent of each other; each is one focused job.

- `F022-prune-protects-live` (ACTIVE): prune keeps live checkouts by the job's own record, not branch match; reviewer worktrees survive spawns; the startup window counts as live; suite stops racing itself.

## NEXT
- `F024-terminal-state-first` (PLANNED): terminal state lands before Herdr cosmetics, exactly once; `stop-reason` made durable for F011; unseen steers surfaced at finalize.
- `F021-hosted-stop-real` (PLANNED): hosted stop ends the agent or truthfully says it could not; agent names keep their entropy; `--tab --timeout` errors. After F020.
- `F027-hosted-idle-advisory` (PLANNED): a hosted worker idle after tools, or blocked, taps the coordinator once — advisory wake, no state change, nothing auto-closed. After F020.
- `F025-dead-job-reaper` (PLANNED): a running job whose process group died reaps to `failed: process group gone` and wakes; recycled pgids cannot fake life on macOS. After F022 and F024.
- `F026-spawn-preflight` (PLANNED): every job records its pi/Herdr versions; loud spawn failures for missing pi and wrong Node; optional `pi auth check`; SECURITY.md names what Linux does not contain.
- `F028-provider-error-is-failed` (PLANNED): a run whose last turn errored records `failed: <reason>`, matching pi's own text-mode exit semantics. Decision ticket — reverses one F011 exclusion; needs explicit sign-off. After F024.
- `F011-empty-job-advisory` (PLANNED): a job that produced nothing should say so instead of reading DONE. Observed, not theorised. After F017 it reads `commits` and `tool-calls` instead of inferring; after F024 it also reads `stop-reason`; if F028 is signed off, its advisory targets clean-but-empty runs.
- `F013-remote-seat` (PLANNED): one disk, attach don’t clone; docs and seat-shaped guarantees. Before F014, after the stability sweep.
- `F014-github-doorbell` (PLANNED): mention or label starts a job on the seat; comment back evidence; merge stays human.

## PROVEN

- `F023-wake-quiet-fallback` (PROVEN): delivered jobs skip fallback claims; mute silences toasts; wake finds the root from a subdirectory. Reviewed PASS at `9f43458`.
- `F020-herdr-agent-truth` (PROVEN): nested Herdr envelope, missing debounce, hook owns activity. Reviewed PASS at `2ef9f40`.
- `F017-completion-handoff` (PROVEN): wake carries the final message and commits; hosted done means session end. Landed at `437a4dc`.
- `F019-coordinator-own-hands` (PROVEN): shop-manual threshold for fixing inline instead of spawning. Guidance only. Coordinator-written at `da52ae5`.
- `F018-review-handoff` (PROVEN): reviewer is given the candidate commit; verdicts filed as `review-<n>.md`. Reviewed PASS at `afea1eb`.
- `F016-agent-handoff-map` (PROVEN): spawn gives task.md plus preamble; the wake is a pointer, not the work. Notes only.
- `F015-harness-steering-map` (PROVEN): speech lives in the system prompt per user turn; F008 restack is gone. Notes only.
- `F006-interactive-managed-updates` (PROVEN): package defaults inherit; leftover hook copies cannot load beside the stub. Reviewed PASS at `236b8e7`.
- `F010-pane-hosted-jobs` (PROVEN): `limen spawn --tab` runs interactive pi in the job tab; live-tried at `2026-08-15-f010-try-ce97a91f` (`7947b2f`, `755d762`).
- `F012-herdr-job-spaces` (PROVEN): named Herdr tab per job; `limen open` reopens a closed one; `limen close FNNN` after the feature is proven. Coordinator-checked at `a65584e`.
- `F009-running-job-supervision` (PROVEN): `limen steer` writes an inbox file; the worker delivers it once between tool calls. Independently reviewed at `57f6c96`.
- `F008-guidance-register-split` (PROVEN): coding practice attached per user message; speech registers restacked before every LLM call with a named audience.
- `F007-terminal-process-containment` (PROVEN): bounded macOS process-identity snapshots, PID-safe escaped-descendant cleanup, and durable warnings when termination cannot be confirmed.
- `F005-active-job-visibility` (PROVEN): bounded live-job snapshots and passive cross-session visibility; independently reviewed and checked.
- `F002-stage-model-defaults` (PROVEN): stage defaults with explicit per-job override.
- `F003-workspace-coordinator` (PROVEN): one workspace coordinator; one selected repository per job.
- `F004-session-notification-routing` (PROVEN): subscribed wakes and one durable fallback handoff.
