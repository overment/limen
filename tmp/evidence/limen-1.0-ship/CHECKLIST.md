# Limen 1.0 ship checklist

Host: alice (VPS) · repo: `~/limen` @ `59ce943` (origin/main) · written 2026-09-11
Scope: dependable-core cut from vision + `spec/build.md` ops remediation lock.
Against tickets F048–F092 (and sequenced companions named in build.md).

Legend: `[ ]` open · `[~]` partial / ops-proven only · `[x]` proven on main · `[D]` defer past narrow 1.0

---

## Must-land for narrow 1.0 (build.md sequence)

Adam's continuation parks the wake-ceiling candidate unchanged for later review. It is not a blocker for implementing the remaining six tickets and must not be merged or widened. The coordinator remains the sole landing/board writer; hosted workers use `--provider openai-codex --model gpt-6-astra --thinking high`.

Delivery checkpoint: neutral webhook names, hosted startup, watch-only recovery and prompt-policy consolidation are proven on main. Receiver-export inspection is landed with its offline harness and Mac runbook, but actual Mac proof and route refusal remain open. The latest native lane has registry and wake-timing failures. No 1.0 tag or release is claimed; `DELIVERY-HANDOFF.md` names the exact remaining owner/operator work.

| # | Ticket | Board | Ship bar | Status |
|---|--------|-------|----------|--------|
| — | **F090** wake errors count toward attempt ceiling | PLANNED | Parked for Adam's later review, outside the remaining wave | `[~]` unchanged `0fa48fa`; no merge, third repair, or widening; incomplete full-native proof retained |
| 1 | **F092** finish webhook names are bot-agnostic | PROVEN | Only `LIMEN_FINISH_WEBHOOK_*` in file contents; drop `TONY_*` keys; helper filename may remain | `[x]` landed `a76e0ae`; focused 76/76 + coordinator 79/79; full native 371 passed, one registry-lock timeout retained |
| 2 | **F091** finish job shows bot-turn receipt | ACTIVE | Inspection separates configured / transport / completed bot turn; first E2E proof on **alice (Mac)** → Johnny/Tony (HTTP alone ≠ pass) | `[~]` receiver-export inspection landed `87dd357`; coordinator 121 passed; offline harness and Mac steps ready, actual Mac turns/control and Adam review still missing |
| 3 | **F081** spawn refuses an unusable route | ACTIVE | Spawn preflight rejects bad route before planting; no retries / model selection in scope | `[~]` safe transport already landed `a3872a6`; installed Pi interfaces unchanged, offline transport proof passed again; refusal waits on Pi non-generating probe or Adam spend auth, counterexample retained |
| 4 | **F048** hosted runtime starts its own agent | PROVEN | `spawn --tab` returns ID in seconds; detached supervisor starts pi + owns lifecycle (closes 2026-08-27 orphan) | `[x]` proof landed `c6d4d6c`, runtime unchanged; focused 87 passed, coordinator three startup falsifiers passed; full native 381 passed with one registry-lock cancellation |
| 5 | **F049** running owner truth | PROVEN | Reaper adopts hosted job that lost supervisor; fails job with no live owner; no shape-based skips. After F048, before F013 | `[x]` landed `6662bac`; focused 103 passed, corrected wake/recovery 50 passed; original native wake failure and registry timeout retained; existing coordinators need reload |
| 6 | **F087** prompt policy has one home | PROVEN | One prose owner for prompt policy; templates + prose assertions only; survives resume | `[x]` landed `ec65dc2`; focused 71 and coordinator 12 passed; all nine packaged templates/histories verified; full native 368 passed, one registry cancellation retained |

### Ops proof gates (not tickets, still ship blockers)

- [x] Adam authorized dependable-core as the 1.0 boundary in the 2026-09-11 coordinator instruction; Phase 0 PASS is recorded in `GATE-RESULT.md`
- [D] F090 is parked by Adam, not proven or merged; incomplete native evidence remains in `spec/features/planned/F090-wake-errors-count-toward-attempt-ceiling/checks-2.md` and does not block the remaining wave
- [ ] F091: file contract and CLI reader landed; Johnny must shepherd an authorized Alice Mac job, actual Johnny/Tony completed-turn exports and the accepted/no-turn control without relying on finish webhooks
- [ ] F081: true route refusal remains unimplemented; no supported non-generating Pi check was found, and generated-probe cost/latency is not authorized; `interface-question.md` and retained failing regression preserve the gap
- [x] F092: retired operational key reads/aliases removed; setup docs and packaged guidance match, legacy literals retained only for negative tests and retirement prose; no private migration or live send claimed
- [x] Landing writer for this wave: the `dependable core` coordinator; Adam reviews; takeovers via named `limen watch <id>` only
- [ ] Native verification remains incomplete: latest full lane at receiver-inspection candidate `ab33fd1` passed TypeScript/Biome and 368 tests, with a 60000ms registry-lock cancellation and a 28.217ms warm sweep against a 20ms limit; causes unproven, no repair or full rerun claimed

---

## In range F048–F092 but NOT required for narrow 1.0

| Ticket | Board | Why deferred |
|--------|-------|--------------|
| **F050** living architecture picture | PLANNED · `[D]` | Background field guide retained; deferred beyond narrow 1.0 |
| **F074** Claude perspective | PLANNED · `[D]` | Claude advisor engine deferred beyond narrow 1.0 |
| **F075** closing overview | PLANNED | Speech/register cue; nice, not core contract |
| **F086** job history can be retired | PLANNED | Operator retention; separate from live ownership/wakes |
| **F088** explicit model defaults | PROVEN | Landed; full native lane incomplete — do not reopen for 1.0 |
| **F089** workers accept explicit pi flags | PROVEN | Same as F088 |

---

## Explicitly out of narrow 1.0 (planned / later)

| Ticket | Board | Note |
|--------|-------|------|
| **F013** remote seat | PLANNED | Docs/seat story; VPS already usable as plant — product ticket not a 1.0 gate |
| **F014** GitHub doorbell | PLANNED | After F013; unsolicited ownership risk |

Also deferred per vision: seat/doorbell expansion, job-shape expansion, workflow engines, silent model fallback, automatic ownership, blanket review gates, integration rewrites.

---

## Suggested build order (do not parallel-own the same checkout)

1. F092 → settle naming on main
2. F091 → bot-turn receipt + Alice Mac E2E
3. F081 → unusable-route refuse
4. F048 → hosted start ownership
5. F049 → watch-only supervision recovery
6. F087 → policy-on-resume prose home
7. Adam review pass on the cut; tag/release decision

F090 stays unchanged for Adam's later review; no automatic resumption.

---

## Seat note (this host)

- Repo synced: was behind 6 commits at `2807126`; now **ff to `59ce943`**.
- Pre-sync stash: `alice-pre-sync-2026-09-11: HOSTED_START_MS + F-multi-author` (local `DEFAULT_HOSTED_START_MS` 5s→60s + untracked multi-author ticket copy). Backup also under `~/limen-sync-backup/2026-09-11/`.
- Herdr: server running 0.8.0, session `default`. Focused workspace is still labeled **alice** (product repo), not limen — checklist lives on disk under limen `tmp/`.
- `limen jobs`: no running jobs at checklist write time.
