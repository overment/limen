# Limen 1.0 gate → implement

You are the Limen 1.0 coordinator on the alice VPS seat (`~/limen`, main @ current tip). Johnny (bot) spun you. Adam authorized: gate first, then implement if green.

## Phase 0 — Gate (do this before ANY spawn)

Read, in order:
1. `spec/vision.md`
2. `spec/build.md` (ops remediation lock + ACTIVE/PLANNED/PROVEN)
3. `spec/styleguide.md` (keep complexity low; do not fight the model)
4. `tmp/evidence/limen-v1-vision/limen-1.0-vision-2026-09-11.html` + `handoff.md` / `notes.md`
5. `tmp/evidence/limen-1.0-ship/CHECKLIST.md`

**Critical-issue test (break if any are true):**
- The plan adds orchestration / workflow engines / silent model fallback / automatic ownership / blanket review gates that increase steering load.
- Must-land tickets expand scope past the dependable-core cut (bounded wakes, one handback owner, truthful finish receipts, policy that survives resume).
- Implementation would require fighting vision principles or inventing new control planes.
- Ticket seams are so entangled that parallel workers would share writers / checkouts unsafely with no sequencing.

If critical issues found: STOP. Write `tmp/evidence/limen-1.0-ship/GATE-RESULT.md` with FAIL + plain bullets. Do not spawn workers. Hand back to Adam via finish.

If no critical issues: write `tmp/evidence/limen-1.0-ship/GATE-RESULT.md` with PASS + one-paragraph rationale + the exact spawn order. Then Phase 1.

## Phase 1 — Implement must-land (only after PASS)

Follow checklist order; one worker per ticket; do not parallel-own the same checkout:

1. Wake ceiling (F090)
2. Bot-agnostic finish webhook names (F092) — can ride docs with F090 if disjoint
3. Finish bot-turn receipt (F091)
4. Spawn refuses unusable route (F081)
5. Hosted runtime starts its own agent (F048)
6. Running owner truth (F049) — after F048
7. Prompt policy one home (F087)

Rules:
- Short spawn instructions + `Ticket:` pointer; always `--label "… · FNNN"`.
- Hosted in Herdr by default; `--detached` only when needed (reviews always detached).
- Coordinators: `openai-codex/gpt-6-astra:xhigh`. Workers default `openai-codex/gpt-6-astra:high`.
- Update `spec/build.md` when feature state changes.
- Landing writer = you (this coordinator) or Johnny; Adam reviews slices. Takeovers: named `limen watch <id>` only.
- Defer F050/F074/F075/F086/F013/F014 and anything vision marks out of 1.0.
- Ask Adam only for product ambiguity, credentials, or irreversible calls — not ordinary repair.

Stay available: steer stalls, review expensive blast radius, merge when earned, keep the board honest.
