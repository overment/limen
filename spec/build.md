# Build

## TRACK

- Reliable in-flight control on one seat; a laptop is a window; GitHub may ring the doorbell later.
- 2026-09-03 Alice audit: guidance present once per call and recalled at the moment of use; hosted jobs end themselves; review loops stop at the ceiling. F053–F063.

## NOW

- `F048-hosted-runtime-start` (🟠 ACTIVE): spawn prints the ID in seconds; the detached supervisor starts pi and owns the job. This closes the live 2026-08-27 caller-timeout orphaning before F049.
- `F056-wake-routing-truth` (🟠 ACTIVE): fallback waits minutes and goes only to sessions that own jobs; an errored turn keeps the wake; facts before instructions.
- `F057-failed-turn-visible` (🟠 ACTIVE): the coordinator says its previous turn failed; the hosted supervisor raises an errored advisory.
- `F062-worker-budgets` (🟠 ACTIVE): workers stay off the board and inside reading and check budgets.

## NEXT

- `F059-board-compression` (🔴 PLANNED): PROVEN keeps ten entries and folds older months into one highlight line. Beside F053.
- `F060-reply-shapes`, `F061-coordinator-ceilings` (🔴 PLANNED): prose only; after F054 so projects inherit them.
- `F049-running-owner-truth` (🔴 PLANNED): reaper adopts a hosted job that lost its supervisor, fails one with no live owner; no shape-based skips. Before F013.
- `F013-remote-seat` (PLANNED): one disk, attach don’t clone; docs and seat-shaped guarantees. Before F014.
- `F014-github-doorbell` (PLANNED): mention or label starts a job on the seat; comment back evidence; merge stays human.

## PROVEN

- `F055-hosted-finish` (🟢 PROVEN): a hosted worker ends its job with `finish`; `done:` stops record done. Landed `40873ed`. Review PASS of `b220dcf`.
- `F058-spawn-hardening` (🟢 PROVEN): spawn takes the task from a file, retries git, prepares the worktree, and prunes orphans. Landed `6b7cdb4`. Review PASS of `17fee8d`.
- `F054-stale-overlay-notice` (🟢 PROVEN): a copy of an older package template is named stale with both dates. Landed `6228859`. Review PASS of `0ae402b`.
- `F053-guidance-recall` (🟢 PROVEN): shop manual, register, vision, and styleguide ride the system prompt once per call. Landed `ea537ba`. Review PASS of `3043809`.
- `F063-reviewer-verdict-discipline` (🟢 PROVEN): reviews open `PASS`/`FAIL` with the sha, block only on acceptance, never on the environment. Landed `3ecafa0`. Review PASS of `f556f14`.
- `F052-context-by-reference` (🟢 PROVEN): the per-turn note points at vision, board, and styleguide instead of attaching bodies. Landed `67c0c70`.
- `F051-readable-jobs` (🟢 PROVEN): at a TTY `limen jobs` prints aligned human rows; piped output stays compact. Landed `1077419`.
- `F050-hunk-diff-tab` (🟢 PROVEN): `limen diff <id>` opens the job's changeset in hunk when present, else prints the git fallback. Landed `17012f8`. Review PASS of `0c8925e`.
- `F047-reload-keeps-wakes` (🟢 PROVEN): reloaded coordinator tab keeps wakes for jobs it started. Landed `a70cf2a`.
- `F028-provider-error-is-failed` (🟢 PROVEN): last-turn `error`/`aborted` records `failed`. Landed `967ab4b`. Signed off 2026-08-26.
- `F046-optional-speech-command` (🟢 PROVEN): `/speak` reads the latest response without another agent turn; brief by default, full on request.
- `F043-seat-sweep` (🟢 PROVEN): `limen sweep` + LaunchAgent every 60s. Installed `works.earendil.limen-sweep`. Merged `3eff35a`.
- `F039-split-proc` (🟢 PROVEN): `proc.ts` split into contain/reap/wrapper/supervisor. Landed `755457f`.
- `F045-supervisor-stall-escalation` (🟢 PROVEN): supervisor rings and stamps a stalled tab. Live: `⚠ stalled 1m` on `w1H:p17`. Merged `e71dcef`.
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
