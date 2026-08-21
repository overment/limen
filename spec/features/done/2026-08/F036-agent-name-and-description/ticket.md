# F036-agent-name-and-description · Short agent names, role descriptions

[2026-08-21] [🟢] [PROVEN] [COORDINATOR] PROVEN · F036-agent-name-and-description

## Outcome

In Herdr's agents sidebar, truncation stops eating the unique part of an agent's identity, and each job pane says what it is instead of repeating the tab label.

Observed 2026-08-21: `limen-f293-workspace-in-58bee…` — the slug duplicates the tab label while the hex suffix (the only unique bit) disappears behind the ellipsis.

## Scope

- `hostedAgentName` becomes `limen-<fnnn>-<hex>` when the job ID carries a feature number (e.g. `limen-f293-58beef04`); non-feature labels keep the existing slug+hex fallback.
- The worker-side `hosted.ts` hook reports `pane report-metadata --display-agent "limen worker|reviewer"` once at session start — role is what the sidebar cannot infer from the tab label. Spawn passes `LIMEN_ROLE`.

## Out of scope

- Random/punny names — the F-number is load-bearing for humans and for F032's relocation prefix match.
- Live pulse in the description — the footer owns activity.

## Acceptance

- Feature-labeled jobs produce `limen-fNNN-<hex8>` agent names ending in the job ID's hex suffix; two spawns of one label stay distinct.
- A hosted worker's pane reports `limen worker` (reviewer for review jobs) as display-agent.
