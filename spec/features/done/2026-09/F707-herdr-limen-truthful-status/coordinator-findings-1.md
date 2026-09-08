# Hosted refresh erases an active stall warning

The status candidate `aa7ab42d179e423ab0dd908cd7f1e8e036bb90c1` needs one correction before Adam's review. This is a coordinator finding, not an independent review verdict.

## Blocking finding

`hook/hosted.ts` refreshes the role and idle/done labels under the same Herdr metadata source (`limen`) used by `src/herdr.ts`'s `reportHostedStall`. A later heartbeat replaces the stalled description and the entire state-label map, including the blocked label. The durable advisory remains present. This contradicts the ticket's truthful-status outcome and the new guide's promise to preserve blockers.

Reproduction used the actual candidate hosted hook and stall-report function, redirected to one temporary expiring source on the coordinator's own pane. It sent no notifications and changed no native lifecycle, focus, subscriptions, or job state. Advancing the hook's refresh clock yielded:

- Initial: `job RUNNING · pane ready`, role `limen worker`.
- Stall report: `⚠ stalled 2m` on idle/done/blocked and the description.
- Hosted refresh: generic RUNNING idle/done labels and worker description; blocked label gone, advisory still present.

Retained script and observed JSON: `.limen/jobs/2026-09-08-f707-running-jobs-stay-visible-a15a7b12/artifacts/stall-overlay-check.mjs` and `stall-overlay-check.log`. Native state stayed `working`; this proves metadata clobbering, not a real blocked UI transition. Temporary source was cleared afterward.

## Smallest correction and evidence

Start at the hosted reporter's `report` function: respect active supervisor advisories and restore ordinary RUNNING metadata promptly after recovery, without competing writers erasing warnings. Test heartbeat, blocked/errored advisories, recovery, and shutdown using the actual stall reporter where practical.

Validate the corrected candidate with main's landed automatic finish delivery. Retain focused status/hosted/helper/lifecycle checks, typecheck, scoped Biome, and rendered metadata evidence. Do not repeat the fifteen-minute full-suite run: its six failures and missing final summary remain unclassified in the original `artifacts/HANDOFF.md`. Do not widen this repair into their investigation.
