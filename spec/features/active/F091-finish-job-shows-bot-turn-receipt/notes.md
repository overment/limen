# Finish inspection: transport and receiver-exported turns

The receiver-evidence candidate supersedes the transport-only constant-unobserved implementation described in `checks-1.md`. F091 remains ACTIVE: authorized Alice Mac proof and Adam's review are still required. Johnny actively shepherds delivery, independently of webhook acceptance.

## Product seams

- `src/finish-receipt.ts` renders configuration selection, independent target transport, imported completed turns and the unchanged historical aggregate. `src/commands/jobs.ts` and `src/view.ts` already share this inspection, so both detail views receive the new behavior without separate presentation changes.
- `src/finish-turn.ts` reads only an operator-selected absolute `LIMEN_FINISH_EVIDENCE_DIR`. There is no job/project/home discovery. `receivers.json` binds target ordinals to receiver identities; fixed `<finishEvent>.<target>.json` files bind that mapping and job-derived event to a completed session/turn/time. The exact v1 contract and limits are in `docs/finish-webhooks.md`.
- Matching exports promote only their target, independently of HTTP accepted/rejected/unknown. Without HTTP records, a valid exported target still shows transport unknown. Missing/invalid exports remain unobserved. Job-local flags do nothing. Inspection has no network transport, writes, finalizer waiting, polling or retry side effects.
- Trust is operator designation plus the authorized export channel and protected local files, not cryptographic provenance. A writer of the designated source can forge matching evidence. Owners/reviewer must follow actual session/turn references; syntax validation is not history verification. No receiver API or signing infrastructure is implied.
- Existing sender/finalizer behavior is unchanged: automatic per-project opt-in, once-only claim, concurrent fan-out, 64-target cap, bounded 32 KiB transport channel and three-second finalizer. Event identity remains `limen-finish-` plus SHA-256 of the job ID, stable across seats but new for a continuation.

## Checks and continuation

`test/finish-webhook.test.ts` is the offline end-to-end harness: the real canonical helper runs through automatic finalization against intercepted fetch and synthetic env files. Both CLI views are captured for accepted/no-export, one correlated/one mismatched export, and two correlated exports. Rejected/stalled transport can independently coexist with observed exports. Repeat finalization leaves request count at two. `test/finish-receipt.test.ts` rejects unselected sources, local flags, wrong event/target/receiver, incomplete turns, malformed/oversized/nonregular/symlink exports and extra/unsafe fields.

Retained round-two evidence: `/home/overment/limen-evidence/f091-51bb62b9/`. The first probe passed three receipt tests; its typecheck caught an unused test import before the negative test was added. The initial discriminating run passed 25 tests and failed only the architecture budget (4006 source lines versus 3915). The budget is now 4010 to account explicitly for bounded receiver-export inspection; no unrelated source was compressed or refactored. TypeScript and scoped Biome checks passed; the focused helper/lifecycle/receipt/finalize/jobs/view/structure lane passed 121/121. Full-native results belong in the retained handoff, not inferred from the focused result.

The transport landing `2dabae7` and its original evidence `/home/overment/limen-evidence/f091-5932f3a5/` remain historical. The former claim that the CLI cannot promote any evidence is superseded by this candidate, not by live proof.

Next: Adam reviews the candidate, then the authorized operator runs the exact Alice Mac procedure in `docs/finish-webhooks.md`. It uses one fresh automatic-only job, an owner-held HTTP-accepted/no-turn control on that same event, then Johnny/Tony completed-turn exports with externally followed history. Do not claim Mac proof from this VPS, synthetic exports or the implementation worker's automatic finish receipt. Do not widen into the unrelated registry-lock timeout, route probes, board edits or merge.
