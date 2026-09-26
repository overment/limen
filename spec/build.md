# Build

## TRACK

- **Pi/OMP engines (Adam 2026-09-22):** one flag, one profile table, one wrapper, one unchanged parser; separate auth stores and same-engine continuation. This VPS plant coordinator owns the board and authorized main landings/pushes; Adam retains review ownership, with no independent reviewer. Live hosted OMP proof, doorbell, unusable-route, and restoring Claude were outside the engine slice.
- **Standing engine (Adam 2026-09-23):** new jobs default to OMP at runtime; `--engine` overrides `LIMEN_ENGINE`. Use `--engine pi` or `LIMEN_ENGINE=pi` only when Pi is required; continuation keeps the recorded engine, and old records without one remain Pi.
- **Standing models (Adam 2026-09-23):** ordinary work and coordination use `openai-codex/gpt-6-sol` on OMP; simple / cheap tasks use `xai-oauth/grok-4.7`; UI-related work uses `anthropic/claude-opus-5-5` on OMP. Pass engine/provider/model/reasoning explicitly; this supersedes the Grok-only wave override.
- **Ops remediation lock 2026-09-10 (Adam):** two unsuccessful automatic wake attempts then deliberate recovery; park-and-preserve on quota — no silent model substitution. Named-job `limen watch <id>` for takeovers — not `watch --running`.
- **Finish proof (Adam):** HTTP ≠ bot turn. VPS-first, Johnny-only automatic finish proof is sufficient; an export hold is unobserved evidence, never absence of an actual turn; no Tony coordination.
- **Review and reasoning (Adam):** Adam reviews; no independent reviewer unless asked. Retain `xhigh` for coordination/research/quality and `high` for ordinary jobs. Research pairs the ordinary and cheap models above; quality, judge, and picture use the ordinary model.
- Reliable in-flight control on one seat; a laptop is a window; the GitHub App rings Alice's registered coordinator while two-seat routing remains unproved.
- Settled Herdr panes keep RUNNING jobs and stall warnings visible; external finish delivery remains per-project opt-in.
- Coordinator CPU is repaired without deleting history; job-history retention remains a separate operator decision.

## NOW

- `F014-github-doorbell` (🟠 ACTIVE): Alice's isolated App key, warm coordinator, live PR mention, hosted review, and one start/finish receipt are proven; second-seat ownership/routing remains to prove before closing.
- `F731-seat-bell-once` (🟠 ACTIVE): Stop the seat sweep replaying the same finished or stalled job forever; old markers and concurrent sweeps must not ring again.
- `F737-worker-skills-visible` (🟠 ACTIVE): OMP workers see native and legacy plant skills across fresh, continued, hosted, detached and review jobs without hand links.

## NEXT

- Quality follow-ups remain planned, not started.
- `F728-hosted-engine-liveness` (🔴 PLANNED): keep a hosted OMP process live when Herdr loses its classification; reproduce the fallback gap before changing recovery.
- `F729-continuation-publication` (🔴 PLANNED): publish continuation records safely against concurrent prune without adding workflow state.
- `F730-job-guidance-matches-engines` (🔴 PLANNED): make job logs and guidance reflect the selected engine and available evidence.

## PARKED

- `F081-spawn-refuses-an-unusable-route` (🔴 PLANNED): still waiting for a Pi-supported non-generating route probe. Rechecked installed Pi 0.84.2 on 2026-09-19: `auth check` still proves credentials only; model runtime has stream/complete, no exact-route validation. Failing candidate `b14b5fe` stays locked; no auth/catalog substitution. Hosted continuation file transport already landed.
- `F050-living-architecture-picture` (🔴 PLANNED): background field-guide proposal remains parked; the stale existing picture is recorded in the latest quality findings, not refreshed by this wave.

## DROPPED

- `F724-handoff-policy-has-one-home` (⚪ DROPPED): speech register already has no second handoff length or constraint rule; shop manual owns the full handoff. No code change.
- `F046-optional-speech-command` (⚪ DROPPED): optional `/speak` shipped, then removed at owner request. Removal `d45fed2`.

## PROVEN

- `F736-plant-status-plate` (🟢 PROVEN): Job records, Git and Herdr show running work, unmerged branches and working coordinators across spaces; uncertain evidence stays explicit. Landed `e1a9d2f` / `fd267a5`; status 4/4 and live plate observed.
- `F735-finish-waits-for-owner` (🟢 PROVEN): Finished workers hand off to the landing owner; webhook `status: waiting` cannot be mistaken for Ready by a recipient ignoring new fields. Landed `83f8cd1` / `fd267a5`; intercepted sender and wake passed; external receiver turn unobserved.
- `F734-stalled-children-fail` (🟢 PROVEN): Verified idle or vanished tool children fail hosted/detached OMP/Pi jobs; uncertain identity raises an advisory. Landed `59cfb4e` / `fd267a5`; synthetic real-process liveness 7/7, live provider hang unproved.
- `F732-github-mention-front-door` (🟢 PROVEN): Authorized PR mentions reach one warm coordinator with bounded context; pending retry produced one hosted review start and terminal reply on Alice PR #10. Landed `a745289`, live repair `912f9e0`; focused 13/13.
- `F733-github-seat-doctor` (🟢 PROVEN): Root-managed Alice setup and `github doctor` passed with isolated App key, worker without sudo, root Node/Herdr, and active timer. Landed `f74a6b3`, live repair `912f9e0`; focused 13/13.
- `F727-pi-omp-interchangeable-engine` (🟢 PROVEN): Pi or OMP jobs use one profile table, wrapper, and unchanged parser; continuation preserves the engine. Landed `0f74748`; coordinator checks 72/72, typecheck and Biome clean. Live hosted OMP and live OMP continuation remain unproved.
- `F726-limen-runs-jobs-on-pi-only` (🟢 PROVEN): Limen starts jobs only with Pi. Landed `14c99d9`; native 453/453. `--engine claude` and `--role advisor` fail before any job exists.
- `F725-stale-intent-prose-matches-landed-reality` (🟢 PROVEN): vision and TRACK no longer treat spawn, reaper, seat, or research/quality/picture as still ahead. Landed `3723740`. Typecheck clean. Wake/Herdr not split: `src/` 4219/4280.
- `F723-tests-stop-owning-prompt-prose` (🟢 PROVEN): tests no longer inventory unique sentences from shop manual, register, or role preambles. Landed `e030714`. Native 456/456.
- `F722-wake-sweep-export-is-private` (🟢 PROVEN): wake sweep collector is file-private. Landed `482715d`. Focused wake 64/64; typecheck clean.
- 2026-09: 67 folded landings. Coordinator status became static (F721, `ab70649`), running jobs stopped counting changed files (F720, `327fc2e`), and overlapping starts retained both worktrees (F719, `e5feac5` / `30cff7a`). Earlier work added owner-routed finish wakes, explicit seat recovery, job retention, native checks, engine defaults, and evidence-backed role handoffs. Details and outcomes: spec/features/done/2026-09/
- 2026-08: 44 landed. Hosted jobs run in a named tab; wakes retry; the process tree is contained. spec/features/done/2026-08/
