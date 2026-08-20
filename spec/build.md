# Build

## TRACK

- Reliable in-flight control on one seat; a laptop is a window; GitHub may ring the doorbell later.

## NOW

- `F027-hosted-idle-advisory` (ACTIVE): candidate `24ea294` in review (`2026-08-20-f027-review-fb831e0c`).
- `F029-hosted-review` (ACTIVE): in Herdr, `--review` is an interactive tab unless `--detached`. After F010 leftover.

## NEXT
- `F028-provider-error-is-failed` (PLANNED): a run whose last turn errored records `failed: <reason>`, matching pi's own text-mode exit semantics. Decision ticket — reverses one F011 exclusion; needs explicit sign-off. After F024.
- `F011-empty-job-advisory` (PLANNED): a job that produced nothing should say so instead of reading DONE. Observed, not theorised. After F017 it reads `commits` and `tool-calls` instead of inferring; after F024 it also reads `stop-reason`; if F028 is signed off, its advisory targets clean-but-empty runs.
- `F013-remote-seat` (PLANNED): one disk, attach don’t clone; docs and seat-shaped guarantees. Before F014, after the stability sweep.
- `F014-github-doorbell` (PLANNED): mention or label starts a job on the seat; comment back evidence; merge stays human.

## PROVEN

- `F025-dead-job-reaper` (PROVEN): dead running jobs reap to `failed: process group gone`. Coordinator-reviewed at `4edcba3`.
- `F021-hosted-stop-real` (PROVEN): hosted stop observes exit or tells the truth; name suffix kept. Coordinator-reviewed at `c97c02a`.
- `F026-spawn-preflight` (PROVEN): versions on the job record; loud fail on missing pi / wrong Node. Coordinator-reviewed at `206506c`.
- `F024-terminal-state-first` (PROVEN): terminal state before Herdr; idempotent finalize; durable stop-reason. Coordinator-reviewed at `4ce24b6`.
- `F022-prune-protects-live` (PROVEN): prune keeps live checkouts by the job worktree record; handshake 10s; suite serialized. Reviewed PASS at `8a44bb5`.
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
