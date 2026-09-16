# Build

## TRACK

- **Simple-path wave (Adam 2026-09-16):** this VPS plant coordinator is the sole landing/board writer; spawn sequential implementation workers; merge + push each ready slice to origin/main when the focused/native bar is met. Adam reviews; no independent review lane unless he asks. Out of scope: remote seat, GitHub doorbell, Claude advisors, F090, audio.
- **Wave model (Adam 2026-09-16):** Codex is over quota. Until it recovers, every spawn and continue uses `--provider xai --model grok-4.6 --thinking xhigh`. No silent substitution.
- **Ops remediation lock 2026-09-10 (Adam):** two unsuccessful automatic wake attempts then deliberate recovery; park-and-preserve on quota — no silent model substitution. Named-job `limen watch <id>` for takeovers — not `watch --running`.
- **Finish proof (Adam):** HTTP ≠ bot turn. VPS-first, Johnny-only automatic finish proof is sufficient; an export hold is unobserved evidence, never absence of an actual turn; no Tony coordination.
- **Review and models (Adam):** Adam performs reviews. Outside this wave override, coordinators use `openai-codex/gpt-6-astra:xhigh` and Pi workers default to `openai-codex/gpt-6-astra:high`. Research pair: `gpt-5.6-sol:xhigh` and `grok-4.6:xhigh`. Quality: `gpt-5.6-sol:xhigh`. Picture: `gpt-5.6-sol`.
- Reliable in-flight control on one seat; a laptop is a window; GitHub may ring the doorbell later.
- Settled Herdr panes keep RUNNING jobs and stall warnings visible; external finish delivery remains per-project opt-in.
- Coordinator CPU is repaired without deleting history; job-history retention remains a separate operator decision.

## NOW

- Simple-path wave complete. No implementation running.

## NEXT

- None in this wave.

## PARKED

- `F081-spawn-refuses-an-unusable-route` (🔴 PLANNED): until cheap Pi proof; failing candidate `b14b5fe` stays locked; no auth/catalog substitution.
- Ticket finishes wake the author's bots (`F708-ticket-finishes-wake-the-authors-bots`, 🔴 PLANNED): after this wave, spec only.
- `F090-wake-errors-count-toward-attempt-ceiling` (🔴 PLANNED): parked unchanged at `0fa48fa`; no merge, third repair, or widening.
- `F050-living-architecture-picture`, `F074-claude-perspective`, `F075-closing-overview`, `F086-job-history-can-be-retired`, `F013-remote-seat`, `F014-github-doorbell` (🔴 PLANNED): deferred beyond this wave.

## PROVEN

- `F717-land-merges-a-ready-job` (🟢 PROVEN): `limen land <id>` merges a done job onto the current branch with ordinary Git. Landed `659c05b`; `--yes` for plant use; focused tests passed; native 405/406 with unrelated wake-sweep timing miss.
- `F091-finish-job-shows-bot-turn-receipt` (🟢 PROVEN): finish inspection separates transport from bot turn. Johnny export-hold on this VPS: accepted HTTP stayed unobserved while the export was held, then observed after release without a second send. Inspection `87dd357`; proof job `2026-09-12-f091-johnny-export-hold-proof-03388067`.
- `F716-jobs-filter-by-label` (🟢 PROVEN): `limen jobs --label PREFIX` lists matching jobs including hidden terminal ones. Landed `4cc8bc9`; focused tests passed; native 402/403 with unrelated wake-sweep timing miss.
- `F715-hosted-path-and-herdr-env` (🟢 PROVEN): hosted tabs get `/usr/bin` on PATH and `HERDR_ENV=1`. Landed `ccf3e7e` / `75cf1a7`; discriminating hosted-start test passed; native 401/402 with an unrelated wake-sweep timing miss retained.
- `F714-spawn-fails-closed-without-ticket` (🟢 PROVEN): spawn refuses a `Ticket:` path missing from the base commit, with no leftover worktree. Landed `d220b3b`; worker native 401/401 passed.
- `F713-same-tip-finish-quiet` (🟢 PROVEN): same settled git tip sends at most one automatic finish ping. Landed `1cd1f68` / `9f3917c`; worker native 399/399 passed; empty failed/stopped skips still do not consume the tip.
- `F711-empty-finish-webhook-quiet` (🟢 PROVEN): empty failed and stopped jobs skip automatic finish webhooks. Landed `e9b29fe`; skip is recorded in the aggregate receipt; done jobs still send.
- `F709-native-checks-give-a-repeatable-verdict` (🟢 PROVEN): test-only registry/startup fixtures landed `2181d35`; repaired native lane passed TypeScript, Biome and all 370 tests, with earlier failures retained and no runtime, wake-ceiling or timeout changes.
- `F087-prompt-policy-has-one-home` (🟢 PROVEN): handoff rules and owner-choice precedence landed `ec65dc2` without runtime changes; focused 71 and coordinator 12 passed, packaged histories verified, full native 368 passed with one registry-lock cancellation retained.
- `F049-running-owner-truth` (🟢 PROVEN): watch-only supervisor recovery landed `6662bac` after a test-only wake-fixture correction; focused 103 passed and corrected wake/recovery 50 passed, original full native 385 passed with wake failure plus registry timeout retained; open coordinators need reload.
- 2026-09: 47 landed. Hosted jobs start under a killed caller (F048, `c6d4d6c`). Neutral finish-webhook names (F092, `a76e0ae`). Settled panes show RUNNING jobs without erasing warnings (F707, `756c747`). Spawn and continuation forward literal Pi flags (F089, `cd8cbb1`). Coordinators use Codex/xhigh and Pi jobs default to Codex/high without inheriting global Grok (F088, `aa5382e`). Coordinators skip settled history while completion wakes remain observable (F085, `5a00065`). Specs keep one check and one constraint per line (F083, `7d966e5`). Hosted jobs end themselves; review loops stop at a ceiling; failed turns and changed-file counts are visible; titles name the change and identifiers carry their meaning; handoffs point at board-owned boundaries; one living picture follows system shape; authorized research compares named sources before judgment; workers falsify candidates and retain commit-bound proof beyond their worktrees; one correction reaches watched live jobs; visual evidence names what opened frames showed. spec/features/done/2026-09/
- 2026-08: 44 landed. Hosted jobs run in a named tab; wakes retry; the process tree is contained. spec/features/done/2026-08/
