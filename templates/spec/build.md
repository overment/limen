# Build

> Coordinator-maintained narrative board. Reconcile it with the planned and active feature folders before selecting, starting, resuming, reviewing, merging, proving, or dropping work. Update it in the same coherent change that changes feature state. Drift is an advisory, never a runtime gate.

TRACK at most three bullets. NOW one clause per feature plus one clause for the current slice, about forty words. NEXT one clause. PROVEN keeps the last ten landed features, then one line per older month: count landed, three highlights in product words, and the month's folder.

Status marks are prose only: 🟠 ACTIVE · 🔴 PLANNED · 🟢 PROVEN · ⚪ DROPPED. Nothing in `limen` treats them as workflow state.

## TRACK

- <!-- Current stretch: intended outcome, why it matters, and material constraint. At most three bullets. -->

## NOW

- `FNNN-slug` (ACTIVE): <!-- One clause of outcome plus one clause of the current slice; about forty words. -->

## NEXT

- `FNNN-slug` (PLANNED): <!-- One clause: likely outcome, dependency, or sequencing reason. -->

## PROVEN

- `FNNN-slug` (PROVEN): <!-- One of at most ten. Landed outcome plus commit and review reference. -->
- <!-- 2026-08: 40 landed. Hosted jobs end themselves; wakes reach the owning session; reviews stop at the ceiling. spec/features/done/2026-08/ -->
