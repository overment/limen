# Build

## TRACK

- **Ops remediation lock 2026-09-10 (Adam):** (1) two unsuccessful automatic wake attempts then deliberate recovery; park-and-preserve on quota — no silent model substitution. (2) First finish→bot proof on **alice** (Mac); intended receivers Johnny + Tony; HTTP ≠ bot turn. (3) Landing/board writer = the feature coordinator **or** the coordinator-manager (Johnny/Tony); Adam reviews these slices; named-job `limen watch <id>` for takeovers — not `watch --running`. Sequence for the authorized narrow 1.0 cut: F090 wake ceiling → F092 neutral webhook names → F091 finish receipts → F081 unusable route → F048 hosted runtime start → F049 running-owner truth → F087 policy-on-resume.

- **Narrow 1.0 authorized 2026-09-11 (Adam):** Phase 0 PASS recorded in `tmp/evidence/limen-1.0-ship/GATE-RESULT.md`; dependable core only, with no new control plane, silent fallback, unsolicited ownership, or blanket review gates.
- **Narrow 1.0 landing owner:** this `dependable core` coordinator (session `01a09092-4a87-7e2a-ad1a-05cfb253b364`) owns landings and the board; Adam reviews, workers run sequentially in isolated worktrees, and takeovers name one job.
- **Narrow 1.0 proof boundary:** installed wake-storm replay and Alice Mac → Johnny/Tony correlated bot turns remain required; VPS transport acceptance is not receiver proof.
- **Narrow 1.0 deferrals:** field guide, Claude perspective, closing overview, history retention, remote rollout, GitHub doorbell, and expanded job automation wait beyond this wave; landed explicit-model work is not reopened.
- Reliable in-flight control on one seat; a laptop is a window; GitHub may ring the doorbell later.
- Settled Herdr panes keep RUNNING jobs and stall warnings visible; external finish delivery remains per-project opt-in.
- Coordinator CPU is repaired without deleting history; job-history retention remains a separate operator decision.
- 2026-09-03 Alice audit: guidance present once per call and recalled at the moment of use; hosted jobs end themselves; review loops stop at the ceiling. F053–F063.
- 2026-09-05 Alice audit: a worker falsifies its own candidate, proof belongs to the commit it proves, and the stall becomes a signal rather than another rule. F076–F083.
- Research default pair: `gpt-5.6-sol:xhigh` and `grok-4.6:xhigh`. Quality: `gpt-5.6-sol:xhigh`. Picture: `gpt-5.6-sol`.
- Adam/Tony model policy: coordinators use `openai-codex/gpt-6-astra:xhigh`; Pi workers, including repairs and resumes, default to `openai-codex/gpt-6-astra:high` rather than global Pi settings.
- Adam performs reviews; do not start an independent review lane unless asked.
- Herdr/job status work (F707): workers, repairs, and resumes use literal `--provider openai-codex --model gpt-6-astra --thinking xhigh`; automatic finish delivery landed with F702 at `622d426`, and Adam owns status review.
- Transcript-settlement workers require literal `--provider openai-codex --model gpt-6-astra --thinking high`; pass those separate flags through Limen, not a combined selector.
- Owner-requested Limen v1 integration audit: all research and judge jobs use `openai-codex/gpt-6-astra:xhigh`; no implementation or feature-state changes.

## NOW

- `F090-wake-errors-count-toward-attempt-ceiling` (🟠 ACTIVE): candidate `a477285` passed installed wake proof and 64 focused tests; one test-only repair resolves the full-lane snapshot race in `checks-1.md`, then one full run; boundary: wake runtime unchanged during repair, no provider retries or model switching; Adam review pending.
- `F092-finish-webhook-names-are-bot-agnostic` (🟠 ACTIVE): drop TONY_* env key names; LIMEN_FINISH_WEBHOOK_* only. After F090.
- `F091-finish-job-shows-bot-turn-receipt` (🟠 ACTIVE): job inspection separates configured / transport / completed bot turn; first proof on Alice Mac → Johnny/Tony, after F092.
- `F081-spawn-refuses-an-unusable-route` (🟠 ACTIVE): spawn rejects an unusable route before planting a job, after F091; boundary: preflight and hosted-start argument transport, with no retries or model selection.
- `F048-hosted-runtime-start` (🟠 ACTIVE): spawn prints the ID in seconds and the detached supervisor starts pi, after F081; boundary: move the existing hosted start into its supervisor, before F049.

## NEXT

- `F049-running-owner-truth` (🔴 PLANNED): restore watch-only supervision or fail a job with no live owner, after F048; boundary: process recovery for existing jobs, never coordinator adoption or a new worker.
- `F087-prompt-policy-has-one-home` (🔴 PLANNED): prompt policy has one prose owner, after F049; boundary: templates and prose-only assertions, with runtime model resolution unchanged and owner choices retained on resume.
- `F050-living-architecture-picture` (🔴 PLANNED): background application field guide proposal is retained but deferred beyond narrow 1.0; no product merge.
- `F074-claude-perspective` (🔴 PLANNED): Claude advisor engine is deferred beyond narrow 1.0; existing partial work is not part of this wave.
- `F075-closing-overview` (🔴 PLANNED): closing-overview speech rule is deferred beyond narrow 1.0; no new state.
- `F086-job-history-can-be-retired` (🔴 PLANNED): job-history retirement is deferred beyond narrow 1.0; retention policy remains open and worktree pruning stays unchanged.
- `F013-remote-seat` (🔴 PLANNED): remote-seat rollout is deferred beyond narrow 1.0; one disk and attach-don’t-clone remain durable direction.
- `F014-github-doorbell` (🔴 PLANNED): opt-in GitHub triggers are deferred beyond narrow 1.0, after remote-seat rollout; merge stays human.

## PROVEN

- `F707-herdr-limen-truthful-status` (🟢 PROVEN): settled panes show RUNNING jobs without erasing warnings; the operator guide separates job, merge, and wake evidence. Adam authorized landing `756c747`; 70 candidate checks passed, one post-merge timing timeout passed recheck, full suite incomplete.
- `F089-workers-accept-explicit-pi-flags` (🟢 PROVEN): spawn and continuation forward literal Pi provider/model/thinking flags in both modes. Landed `cd8cbb1`; exact-argv checks passed, full native lane incomplete; Adam owns review.
- `F088-spawns-use-explicit-model-defaults` (🟢 PROVEN): coordinators use Codex/xhigh and Pi jobs default to Codex/high without inheriting global Grok. Landed `aa5382e`; focused checks passed, full native lane incomplete; Adam owns review.
- `F085-sweep-skips-settled-jobs` (🟢 PROVEN): coordinators skip settled history while completion wakes remain observable. Landed `5a00065`; review PASS of `a482020`, with the full native lane incomplete.
- `F083-spec-folder-says-one-thing-once` (🟢 PROVEN): specs keep one check and one constraint per line, and delete files when they stop being true. Landed `7d966e5`. Review PASS of `e386591`.
- `F078-a-picture-is-evidence-when-seen` (🟢 PROVEN): visual evidence names what opened frames showed; identical frames that should differ fail the check. Landed `5067c69`. Review PASS of `5067c69`.
- `F077-evidence-outlives-the-worktree` (🟢 PROVEN): proof runs at the clean candidate commit, retained artifacts reach review, and mismatched evidence is unverified. Landed `cf3e9e0`. Review PASS of `85d57d2`.
- `F084-every-number-arrives-with-its-meaning` (🟢 PROVEN): the reply cue and the specs reminder name the failing sentence, not the property; the identifier rule leads the Human register. Landed `0d3f2fd`. Coordinator-inspected.
- `F079-job-line-shows-changed-files` (🟢 PROVEN): a running job line shows its changed-file count; a missing worktree leaves the signal absent. Landed `a98fa51`. Coordinator-inspected.
- `F082-handoff-points-at-the-board` (🟢 PROVEN): a handoff points at the board line that owns its boundary; changes and steers name that line instead of duplicating the rule. Landed `88a2627`. Coordinator-inspected.
- 2026-09: 35 landed. Hosted jobs end themselves; review loops stop at a ceiling; a failed turn is visible; a tab title says what the work changes; one living picture follows system shape; human-asked research compares named sources across models before judgment; workers falsify their own candidate before handoff; one correction reaches every watched live job. spec/features/done/2026-09/
- 2026-08: 44 landed. Hosted jobs run in a named tab; wakes retry; the process tree is contained. spec/features/done/2026-08/
