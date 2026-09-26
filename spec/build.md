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
- `F734-stalled-children-fail` (🟠 ACTIVE): A silent CPU-idle child must stop claiming RUNNING with retained failure evidence; prove OMP/Pi hosted and detached before landing.
- `F735-finish-waits-for-owner` (🟠 ACTIVE): A finished branch is waiting on the landing owner, never a Ready-to-stack signal; webhook and subscribed wake agree.
- `F736-plant-status-plate` (🟠 ACTIVE): One job-record-backed plant plate shows running workers across spaces, working coordinators and branches awaiting land.
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

- `F732-github-mention-front-door` (🟢 PROVEN): Authorized PR mentions reach one warm coordinator with bounded context; pending retry produced one hosted review start and terminal reply on Alice PR #10. Landed `a745289`, live repair `912f9e0`; focused 13/13.
- `F733-github-seat-doctor` (🟢 PROVEN): Root-managed Alice setup and `github doctor` passed with isolated App key, worker without sudo, root Node/Herdr, and active timer. Landed `f74a6b3`, live repair `912f9e0`; focused 13/13.
- `F727-pi-omp-interchangeable-engine` (🟢 PROVEN): Pi or OMP jobs use one profile table, wrapper, and unchanged parser; continuation preserves the engine. Landed `0f74748`; coordinator checks 72/72, typecheck and Biome clean. Live hosted OMP and live OMP continuation remain unproved.
- `F726-limen-runs-jobs-on-pi-only` (🟢 PROVEN): Limen starts jobs only with Pi. Landed `14c99d9`; native 453/453. `--engine claude` and `--role advisor` fail before any job exists.
- `F725-stale-intent-prose-matches-landed-reality` (🟢 PROVEN): vision and TRACK no longer treat spawn, reaper, seat, or research/quality/picture as still ahead. Landed `3723740`. Typecheck clean. Wake/Herdr not split: `src/` 4219/4280.
- `F723-tests-stop-owning-prompt-prose` (🟢 PROVEN): tests no longer inventory unique sentences from shop manual, register, or role preambles. Landed `e030714`. Native 456/456.
- `F722-wake-sweep-export-is-private` (🟢 PROVEN): wake sweep collector is file-private. Landed `482715d`. Focused wake 64/64; typecheck clean.
- `F721-coordinator-status-is-static` (🟢 PROVEN): coordinator footer no longer animates a spinner. Landed `ab70649`. Native 456/456. Reload Pi for the static footer.
- `F720-drop-running-changed-file-counter` (🟢 PROVEN): running jobs no longer count dirty files. Landed `327fc2e`. Focused jobs/view/git-status/wrapper 88/88; typecheck clean. Full native not run.
- `F719-concurrent-starts-keep-their-work` (🟢 PROVEN): overlapping starts keep both worktrees; the empty job-directory publication window is closed. Landed `e5feac5` / `30cff7a` from Mac tips `63bbff6` / `8cc3ba6`. Focused spawn and prune 45/45; TypeScript clean. Full native not rerun here.
- 2026-09: 64 landed. Finished job records can be deliberately retired without touching live jobs or unmerged branches (F086, `58c9c4f`). Ticket finishes wake only the author's mapped bots (F708, `ec6c645`). Wake errors count toward the two-attempt ceiling (F090, `a14640f`). Shop manual names the coordinator as a hosted Pi tab (F718, `5305eeb`). Land merges a done job onto the current branch (F717, `659c05b`). Finish inspection separates transport from bot turn (F091, `87dd357`). Jobs can filter by label prefix (F716, `4cc8bc9`). Hosted tabs get `/usr/bin` on PATH and `HERDR_ENV=1` (F715, `ccf3e7e`). Spawn refuses a ticket missing from the base commit (F714, `d220b3b`). Same settled git tip sends at most one automatic finish ping (F713, `1cd1f68`). Empty failed and stopped jobs skip automatic finish webhooks (F711, `e9b29fe`). A Claude advisor engine shipped then was removed (F074, `96832c3`; F726, `14c99d9`). Native checks give a repeatable verdict (F709, `2181d35`). Handoff rules and owner-choice precedence have one home (F087, `ec65dc2`). A dead supervisor on a live hosted job regains watch-only recovery (F049, `6662bac`). Hosted jobs start under a killed caller (F048, `c6d4d6c`). Neutral finish-webhook names (F092, `a76e0ae`). Settled panes show RUNNING jobs without erasing warnings (F707, `756c747`). Spawn and continuation forward literal Pi flags (F089, `cd8cbb1`). Coordinators use Codex/xhigh and Pi jobs default to Codex/high without inheriting global Grok (F088, `aa5382e`). Coordinators skip settled history while completion wakes remain observable (F085, `5a00065`). Specs keep one check and one constraint per line (F083, `7d966e5`). Hosted jobs end themselves; review loops stop at a ceiling; failed turns and changed-file counts are visible; titles name the change and identifiers carry their meaning; handoffs point at board-owned boundaries; one living picture follows system shape; authorized research compares named sources before judgment; workers falsify candidates and retain commit-bound proof beyond their worktrees; one correction reaches watched live jobs; visual evidence names what opened frames showed. The remote seat has an explicit seat/window story (F013, `d33e334`); coordinator handbacks with live work carry a closing overview (F075, `dd85e7c`). spec/features/done/2026-09/
- 2026-08: 44 landed. Hosted jobs run in a named tab; wakes retry; the process tree is contained. spec/features/done/2026-08/
