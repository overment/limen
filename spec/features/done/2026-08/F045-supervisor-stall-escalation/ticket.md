# F045-supervisor-stall-escalation · The supervisor rings when a hosted worker stalls, coordinator or not

[2026-08-25] [🟢] [PROVEN] [COORDINATOR] PROVEN · F045-supervisor-stall-escalation

## Outcome

A stalled hosted worker is loud on its own. When the supervisor writes an advisory it also rings Herdr and stamps the job tab with a durable stalled label. The ring repeats while the stall stays unheard. None of it needs a coordinator session to exist.

## Scope

- `noteHostedIdle` (`src/proc.ts`): writing an advisory also fires `herdr notification show` from the supervisor process and stamps the job's recorded pane (`herdr/pane`) via `pane report-metadata` — display-agent/state-label reading `⚠ stalled <duration>`. Same herdr-binary resolution the rest of the tree uses; `LIMEN_HERDR=0` silences it all.
- Re-ring while unheard: repeat the toast every 15 minutes (`LIMEN_STALL_RERING_MS`) only while the advisory has no `_advisory.*` entry in `notify/delivered`. Once a coordinator claimed it, toasts stop; the label stays until recovery or finalize.
- The label duration updates as the supervisor polls (it already wakes every second).
- Recovery: when status returns to `working`, `clearHostedAdvisory` also restores the pane metadata (the hosted hook's role description comes back) and re-arms the ring — existing F027 arming semantics unchanged.
- Coordinator wake delivery is untouched. The supervisor ring is additive, not a delivery.

## Out of scope

- Detached jobs — the wrapper self-finalizes and the reaper covers death; stalls are a hosted phenomenon.
- Wake-extension changes (F042) and the seat sweep (F043).
- A quiet knob beyond `LIMEN_HERDR=0` / `LIMEN_STALL_RERING_MS`. Session mute stays session-scoped and does not silence the supervisor.

## Acceptance

- Fake-herdr: worker goes idle → advisory file, exactly one `notification show`, pane metadata carries the stalled label.
- Advisory still unheard past a shrunk re-ring interval → second toast. After a fake `_advisory.*` delivered marker appears → no further toasts; label persists.
- Status returns `working` → advisory cleared, label restored, ring re-armed.
- Live prove: a real stalled worker with the coordinator closed rings within a minute of the stall and its tab reads stalled.
- `npm run check` green.

## Notes

Found in the 2026-08-25 wake investigation. The F006 blackout in the easy workspace: six advisories over four hours, zero claims — no coordinator session existed for the project, and `hook/wake.ts` only toasts inside a successful claim (`notifyHerdr` is gated on `claimMarker`), so an unclaimed advisory is silent by construction. The supervisor is the only process guaranteed co-alive with a hosted job; it does the ringing.

Verify early: `herdr notification show` from a process without pane env (`HERDR_ENV` unset) must still reach the daemon. If it cannot, the floor is `osascript -e 'display notification …'` — system binary, still zero runtime dependencies.

Before F039 — this edits `proc.ts`; land the surgery before the split moves the file. Process-control adjacent: fresh reviewer.

(Filed as F041 for a few minutes on 2026-08-25 before the number collided with the concurrently-activated `F041-dynamic-communication`; renumbered F045, no content change.)
