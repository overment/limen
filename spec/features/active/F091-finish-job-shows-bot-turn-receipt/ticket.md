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
- Define a bounded on-disk contract for receiver-exported completed turns from
  an operator-designated trusted source; correlate event, target and receiver
  with a completed-turn reference, not a local observed flag.
- `docs/finish-webhooks.md`: exact Alice Mac → Johnny/Tony operator steps and
  an offline harness, with the evidence import's trust boundary stated plainly.
- Preserve job-derived finish-event identity in receiver evidence; no invented
  receiver API, polling, signing infrastructure or completion claim from HTTP.

## Out of scope

- Implicit opt-in or home-default destinations.
- Blind whole-list retry after partial failure.
- Waiting for bot completion inside the finalizer budget.
- Editing alice product code; only private finish env + limen presentation.
- VPS proof (Mac proof first).

## Acceptance

- Two-target synthetic finalization retains independent transport results and
  sends nothing on repeat finalization.
- Matching receiver-exported completed-turn evidence promotes only its target
  to observed in both CLI views, independently of HTTP acceptance.
- Missing, malformed, incomplete or mismatched evidence remains unobserved;
  legacy local flags, raw bodies and secrets cannot promote or leak into output.
- An offline harness proves accepted HTTP without completed-turn evidence stays
  unobserved and a correlated completed-turn export becomes observed.
- One authorized new Alice Mac job sends automatically only; Johnny and Tony's
  actual completed turns preserve its finish event, with no-turn control retained.
- Focused helper/lifecycle checks pass. Adam reviews.

## Notes

Limen defines the file-exchange contract; receiver owners supply actual completed
turns through an authorized export. Validating that export is not cryptographic
proof of provenance. Johnny actively shepherds delivery; webhook acceptance is
not relied on as a wake. Private env values never enter tickets or logs.
