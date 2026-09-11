# Narrow Limen 1.0: delivery handback

The safe product work is landed on this VPS's main checkout, but the accepted narrow 1.0 cut cannot yet be called delivered. Real route refusal and the required Alice Mac receiver proof are missing; native verification is not green. No tag, publish, remote push or Adam review verdict is claimed.

## What landed

- Neutral finish configuration names (F092), merge `a76e0ae9b564d540d710189bb3815242d50c71bd`.
- Hosted startup ownership proof (F048), merge `c6d4d6c271ca5648789423ae75f0e13c02d57792`.
- Watch-only recovery of lost supervisors (F049), merge `6662bac4afad29c647f2d76ecf7e61247a892aeb`.
- One home for handoff policy and owner choices across resume (F087), merge `ec65dc266410f7bbe46366a7997f8ae2dd0db21a`.
- Safe hosted continuation file transport, the completed portion of route refusal (F081), commit `a3872a68ae1b408dabc6ef57d7f645971c08abfc`.
- Per-target finish transport, merge `2dabae76b5b13747f3a5fd502ff2e8ea38f22095`, and receiver-export inspection, merge `87dd357cde8740cb5b129ee909cc42129eb88b0a` (F091). Both CLI views now distinguish HTTP results from matching completed-turn exports. F091 is not PROVEN.

Receiver inspection uses an explicit absolute `LIMEN_FINISH_EVIDENCE_DIR`, an operator-controlled `receivers.json` target mapping and bounded per-event/per-target JSON exports. It authenticates neither origin nor history. The source writer is trusted explicitly; actual receiver history must be followed independently. No receiver API, network probe, polling or signing infrastructure was added.

## What needs Adam or Johnny

1. **Alice Mac proof and review.** Adam reviews the cut; Johnny arranges the authorized Mac run using the exact procedure under “Alice Mac receiver-owned proof” in `docs/finish-webhooks.md`. Use an installation containing receiver-inspection merge `87dd357`; record its actual revision or package checksum in the proof bundle. Obtain the private Johnny/Tony ordinal mapping and a supported receiver hold before spawning. Capture one automatic event with HTTP accepted but processing held, plus the owner's no-completed-turn attestation; then release that same event, follow both real completed turns and import their authorized exports. Retain both CLI views, safe transport records, mapping attestation, history references/excerpts and control evidence. If a hold is unsupported, obtain an authorized alternative control before sending. Do not invent an API or use a second manual ping. Johnny outside Pi follows the named job and files directly; a Pi coordinator runs its own named `limen watch` command. This coordinator remains the sole landing/board writer.
2. **Real route refusal.** Installed Pi 0.84.2's auth implementation and model interface are unchanged and expose no supported non-generating exact-route probe. Recommend waiting for that Pi interface. The alternative requires Adam's explicit generated-probe authorization, including spend/token, latency and retry limits. No generated probe was run and no zero-cost generation was assumed. The failing auth-ready batch-only counterexample remains unchanged and locked at `b14b5fedb5b9eefe150d569427cebe63c6c53ba6`; see the route feature's `checks-2.md` and `interface-question.md`.

Native failures still need technical investigation before claiming clean native verification. They are not attributed to the environment or repaired by this handback; no unrelated repair was folded into these slices.

## Evidence and actual finish delivery

Receiver candidate `ab33fd170500844e93e0999db12ffdf82cb329a8` passed coordinator typecheck and 121 focused checks at the clean commit. The offline positive/negative harness retains both CLI views and confirms no additional send on repeat finalization. Its full native lane ran once: TypeScript/Biome passed, 368 tests passed, the registry-lock test exceeded 60000ms, and a warm-sweep test measured 28.217ms against a 20ms limit. Causes remain unproven; no full rerun was performed.

Evidence: `/home/overment/limen-evidence/f091-51bb62b9/`, especially `coordinator-focused.log`, `coordinator-offline/`, `native.log` and `HANDOFF.md`. The feature's `checks-2.md` records the coordinator landing decision. The offline harness command and exact v1 contract are in `docs/finish-webhooks.md`.

The implementation worker's automatic VPS send was accepted by one configured target at `2026-09-11T22:29:07.704Z`; no receiver completion was verified and no manual retry was sent. Its event is `limen-finish-dde63db51430f5a0115c02eed3e91d972d491bdfe6c920799a1f48172ef28b32`, filed under job `2026-09-11-f091-observed-bot-turns-round-2-51bb62b9`. This is transport evidence only, not the required Mac proof. Johnny actively shepherds rather than waiting for that webhook to wake him.

The wake-ceiling candidate (F090) remains parked, unchanged and locked at `0fa48fabd0f8faa9b461292d9cba97a1708fa59a`; no merge, repair, rebase or widening was performed. No implementation jobs remain running at handback. If the coordinator has not reloaded since the supervisor-recovery landing, `/reload` loads that changed hook dependency; new CLI invocations already use main.
