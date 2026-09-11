# Limen 1.0 ship checklist

Host: alice (VPS) · repo: `~/limen` @ `59ce943` (origin/main) · written 2026-09-11
Scope: dependable-core cut from vision + `spec/build.md` ops remediation lock.
Against tickets F048–F092 (and sequenced companions named in build.md).

Legend: `[ ]` open · `[~]` partial / ops-proven only · `[x]` proven on main · `[D]` defer past narrow 1.0

---

## Must-land for narrow 1.0 (build.md sequence)

Adam's continuation parks the wake-ceiling candidate unchanged for later review. It is not a blocker for implementing the remaining six tickets and must not be merged or widened. The coordinator remains the sole landing/board writer; hosted workers use `--provider openai-codex --model gpt-6-astra --thinking high`.

| # | Ticket | Board | Ship bar | Status |
|---|--------|-------|----------|--------|
| — | **F090** wake errors count toward attempt ceiling | PLANNED | Parked for Adam's later review, outside the remaining wave | `[~]` unchanged `0fa48fa`; no merge, third repair, or widening; incomplete full-native proof retained |
| 1 | **F092** finish webhook names are bot-agnostic | PROVEN | Only `LIMEN_FINISH_WEBHOOK_*` in file contents; drop `TONY_*` keys; helper filename may remain | `[x]` landed `a76e0ae`; focused 76/76 + coordinator 79/79; full native 371 passed, one registry-lock timeout retained |
| 2 | **F091** finish job shows bot-turn receipt | ACTIVE | Inspection separates configured / transport / completed bot turn; first E2E proof on **alice (Mac)** → Johnny/Tony (HTTP alone ≠ pass) | `[~]` receipt implementation starts on landed neutral keys; correlated Mac receiver proof still required |
| 3 | **F081** spawn refuses an unusable route | ACTIVE | Spawn preflight rejects bad route before planting; no retries / model selection in scope | `[ ]` |
| 4 | **F048** hosted runtime starts its own agent | ACTIVE | `spawn --tab` returns ID in seconds; detached supervisor starts pi + owns lifecycle (closes 2026-08-27 orphan) | `[ ]` |
| 5 | **F049** running owner truth | PLANNED | Reaper adopts hosted job that lost supervisor; fails job with no live owner; no shape-based skips. After F048, before F013 | `[ ]` |
| 6 | **F087** prompt policy has one home | PLANNED | One prose owner for prompt policy; templates + prose assertions only; survives resume | `[ ]` |

### Ops proof gates (not tickets, still ship blockers)

- [x] Adam authorized dependable-core as the 1.0 boundary in the 2026-09-11 coordinator instruction; Phase 0 PASS is recorded in `GATE-RESULT.md`
- [D] F090 is parked by Adam, not proven or merged; incomplete native evidence remains in `spec/features/planned/F090-wake-errors-count-toward-attempt-ceiling/checks-2.md` and does not block the remaining wave
- [ ] F091: correlated bot-turn receipt on an authorized Alice Mac job (not HTTP-only)
- [x] F092: retired operational key reads/aliases removed; setup docs and packaged guidance match, legacy literals retained only for negative tests and retirement prose; no private migration or live send claimed
- [x] Landing writer for this wave: the `dependable core` coordinator; Adam reviews; takeovers via named `limen watch <id>` only

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
