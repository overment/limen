# F091 · Finish inspection separates transport from bot turn

## Outcome

`limen jobs <id>` answers three separate questions for external finish
delivery: configured or not; transport accepted/rejected/unknown per target;
completed bot turn observed or unobserved. HTTP success is never shown as a
completed bot turn. First operational proof uses the **alice** project on Mac
with Johnny and Tony as intended receivers.

## Scope

- Preserve existing per-project opt-in (`.limen/finish-webhook.env`), once-only
  automatic claim, concurrent fan-out, and bounded finalizer.
- `src/finish-webhook.ts` / helper: bounded allowlisted per-target receipt
  channel (safe labels/ordinals, timestamps, HTTP status category). Never URLs,
  credentials, raw bodies.
- `src/commands/jobs.ts` / `src/view.ts`: present configured · transport ·
  bot-turn separately; keep aggregate receipt.
- Docs: `docs/finish-webhooks.md` proof steps for alice → Johnny/Tony.
- Stable finish-event identity derived from job ID for correlation; receiver
  owners (Johnny/Tony) must preserve it in their completed turn. No invented
  Grok API inside limen.

## Out of scope

- Implicit opt-in or home-default destinations.
- Blind whole-list retry after partial failure.
- Waiting for bot completion inside the finalizer budget.
- Editing alice product code; only private finish env + limen presentation.
- VPS proof (Mac proof first).

## Acceptance

- Synthetic two-target finalization: one accepts, one fails/stalls; inspection
  retains acceptance and distinguishes failure from unknown; secrets absent;
  repeat finalization sends nothing.
- One authorized newly spawned alice job: automatic send only; each selected
  destination followed to a completed Johnny and/or Tony turn that references
  that finish event; intentionally accepted HTTP with no bot turn stays
  **unobserved**.
- Focused helper/lifecycle checks pass. Adam reviews.

## Notes

Adam lock 2026-09-10: first finish proof project = alice; landing authority =
feature coordinator or coordinator-manager (Johnny/Tony). Private env values
never enter tickets or logs. Depends on receiver owners naming wake endpoints
and supplying bot-turn history for the proof record.
