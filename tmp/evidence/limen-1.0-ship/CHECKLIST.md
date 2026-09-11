# Limen 1.0 ship checklist

Host: alice (VPS) · repo: `~/limen` @ `59ce943` (origin/main) · written 2026-09-11
Scope: dependable-core cut from vision + `spec/build.md` ops remediation lock.
Against tickets F048–F092 (and sequenced companions named in build.md).

Legend: `[ ]` open · `[~]` partial / ops-proven only · `[x]` proven on main · `[D]` defer past narrow 1.0

---

## Must-land for narrow 1.0 (build.md sequence)

| # | Ticket | Board | Ship bar | Status |
|---|--------|-------|----------|--------|
| 1 | **F090** wake errors count toward attempt ceiling | ACTIVE | Two unsuccessful automatic wakes → deliberate recovery; quota parks (no silent model swap); reset-on-resume; inspectable blocked claims | `[~]` candidate `a477285`: focused 64/64 + installed replay pass; full 386/387; test-only repair and Adam review pending |
| 2 | **F092** finish webhook names are bot-agnostic | ACTIVE | Only `LIMEN_FINISH_WEBHOOK_*` in file contents; drop `TONY_*` keys; helper filename may remain | `[~]` env + README ops on Mac; ticket still ACTIVE until product settle on main |
| 3 | **F091** finish job shows bot-turn receipt | ACTIVE | Inspection separates configured / transport / completed bot turn; first E2E proof on **alice (Mac)** → Johnny/Tony (HTTP alone ≠ pass) | `[~]` live finish→bot wakes ops-proven; ticket acceptance still open |
| 4 | **F081** spawn refuses an unusable route | ACTIVE | Spawn preflight rejects bad route before planting; no retries / model selection in scope | `[ ]` |
| 5 | **F048** hosted runtime starts its own agent | ACTIVE | `spawn --tab` returns ID in seconds; detached supervisor starts pi + owns lifecycle (closes 2026-08-27 orphan) | `[ ]` |
| 6 | **F049** running owner truth | PLANNED | Reaper adopts hosted job that lost supervisor; fails job with no live owner; no shape-based skips. After F048, before F013 | `[ ]` |
| 7 | **F087** prompt policy has one home | PLANNED | One prose owner for prompt policy; templates + prose assertions only; survives resume | `[ ]` |

### Ops proof gates (not tickets, still ship blockers)

- [x] Adam authorized dependable-core as the 1.0 boundary in the 2026-09-11 coordinator instruction; Phase 0 PASS is recorded in `GATE-RESULT.md`
- [ ] F090: candidate `a477285` passed focused 64/64 and isolated installed-Pi replay; full check 386/387 needs snapshot-race repair; candidate not merged, Adam review pending
- [ ] F091: correlated bot-turn receipt on an authorized Alice Mac job (not HTTP-only)
- [ ] F092: no `TONY_*` keys remaining in product paths; CI/docs match
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

1. F090 → merge + prove ceiling
2. F092 (can ride after/with F090 docs) → settle naming on main
3. F091 → bot-turn receipt + Alice Mac E2E
4. F081 → unusable-route refuse
5. F048 → hosted start ownership
6. F049 → reaper/adoption
7. F087 → policy-on-resume prose home
8. Adam review pass on the cut; tag/release decision

---

## Seat note (this host)

- Repo synced: was behind 6 commits at `2807126`; now **ff to `59ce943`**.
- Pre-sync stash: `alice-pre-sync-2026-09-11: HOSTED_START_MS + F-multi-author` (local `DEFAULT_HOSTED_START_MS` 5s→60s + untracked multi-author ticket copy). Backup also under `~/limen-sync-backup/2026-09-11/`.
- Herdr: server running 0.8.0, session `default`. Focused workspace is still labeled **alice** (product repo), not limen — checklist lives on disk under limen `tmp/`.
- `limen jobs`: no running jobs at checklist write time.
