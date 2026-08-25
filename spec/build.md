# Build

## TRACK

- Reliable in-flight control on one seat; a laptop is a window; GitHub may ring the doorbell later.

## NOW

- `F045-supervisor-stall-escalation` (🟠 ACTIVE): merged `e71dcef`; review PASS of `9139a20`. Live prove in flight (`F045 stall prove`) — needs a tool call then 60s idle; zero-tool jobs do not stall.
- `F043-seat-sweep` (🟠 ACTIVE): merged `3eff35a`. Concurrent registry tests pass; live launchd interval not yet installed.

## NEXT
- `F039-split-proc` (🔴 PLANNED): one job per file in the `proc.ts` pile; unused exports gone; CONTRIBUTING matches the 2750 cap. After F032 prove and F045 (F038 is done).
- `F028-provider-error-is-failed` (PLANNED): a run whose last turn errored records `failed: <reason>`, matching pi's own text-mode exit semantics. Decision ticket — reverses one F011 exclusion; needs explicit sign-off. After F024.
- `F013-remote-seat` (PLANNED): one disk, attach don’t clone; docs and seat-shaped guarantees. Before F014, after this quality sweep and F032's prove.
- `F014-github-doorbell` (PLANNED): mention or label starts a job on the seat; comment back evidence; merge stays human.

## PROVEN

- `F032-hosted-supervisor-target-truth` (🟢 PROVEN): supervisor follows a moved pane; live-proven `w1H:p18` → `w1M:pY`. Implemented `6ee8ff1`.
- `F011-empty-job-advisory` (🟢 PROVEN): empty jobs say produced nothing; `done` unchanged. Landed `5120e89`.
- `F044-hosted-start-retry` (🟢 PROVEN): one pane-shell retry then honest fail. Landed `fe510dd`; review PASS.
- `F042-wake-delivery-integrity` (🟢 PROVEN): claim only after a real turn; batched wakes and live heartbeat. Merged `70eaebd`; re-review PASS of `7e43d23`.
- `F041-dynamic-communication` (🟢 PROVEN): package speech now chooses compact format and contextual tone per response; six model probes and fresh review PASS of `0fa6d06`.
- `F037-continue-record-parity` (🟢 PROVEN): continue copies `repo`, finalizes launch fail, hosted in Herdr like spawn. Landed at `62aad12`; review PASS of `62aad12`.
- `F040-retire-control-migrate` (🟢 PROVEN): `limen migrate` gone; init still refuses leftover Control paths. Landed at `b99f624`.
- `F038-hosted-pulse-from-activity` (🟢 PROVEN): hosted `jobs`/footer pulse follows `activity`, not Herdr unseen-idle. Landed at `54e678c`.
- `F036-agent-name-and-description` (🟢 PROVEN): live probe showed `limen-f036-53de86f2` + display-agent `limen worker`. Landed at `554e3c9`.
- `F035-auto-close-terminal-tabs` (🟢 PROVEN): job tab closed itself at finalize — workspace left with only the coordinator tab. Landed at `554e3c9`.
- `F034-job-continue-same-session` (🟢 PROVEN): `limen continue` resumed a finished worker's session blind — it recalled AMBERDOVE without tools. Landed at `6ee8ff1`; live-proven 2026-08-21 (parent `...30eeedf4` → child `...13ec2629`).
- `F033-hosted-focus-restore` (🟢 PROVEN): restore only when the job tab holds focus; logged live at `coordinator tab restored`. Landed at `6ee8ff1`.
- `F031-wake-delivery-retry` (🟢 PROVEN): failed injections release the claim and retry; delivery path exercised live post-reload, rejection branch test-proven. Landed at `6ee8ff1`.
- `F030-hosted-stall-handoff` (🟢 PROVEN): live stall wake carried commits + final message excerpt (~60s idle). Coordinator-reviewed at `15383c7`.
- `F027-hosted-idle-advisory` (🟢 PROVEN): advisory mechanism is F030's vehicle; live tap landed with F030's prove. Merged `24ea294`.
- `F029-hosted-review` (🟢 PROVEN): hosted reviews work end-to-end; live-proven via F030's hosted implement/review loop. Merged `914bc4d`.
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
- `F008-guidance-register-split` (PROVEN): coding practice attached per user message; speech registers appended to the system prompt at the start of each user turn with a named audience.
- `F007-terminal-process-containment` (PROVEN): bounded macOS process-identity snapshots, PID-safe escaped-descendant cleanup, and durable warnings when termination cannot be confirmed.
- `F005-active-job-visibility` (PROVEN): bounded live-job snapshots and passive cross-session visibility; independently reviewed and checked.
- `F002-stage-model-defaults` (PROVEN): stage defaults with explicit per-job override.
- `F003-workspace-coordinator` (PROVEN): one workspace coordinator; one selected repository per job.
- `F004-session-notification-routing` (PROVEN): subscribed wakes and one durable fallback handoff.
