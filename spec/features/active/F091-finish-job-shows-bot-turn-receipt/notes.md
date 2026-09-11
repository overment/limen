# Finish inspection: transport and receiver-exported turns

Receiver-export inspection landed as `87dd357`, superseding the transport-only constant-unobserved behavior recorded in `checks-1.md`. Johnny actively shepherds the outstanding Alice Mac proof independently of webhook acceptance; Adam reviews the result.

## Product seams

- `src/finish-receipt.ts` renders configuration selection, independent target transport, imported completed turns and the unchanged historical aggregate. `src/commands/jobs.ts` and `src/view.ts` already share this inspection, so both detail views receive the new behavior without separate presentation changes.
- `src/finish-turn.ts` reads only an operator-selected absolute `LIMEN_FINISH_EVIDENCE_DIR`. There is no job/project/home discovery. `receivers.json` binds target ordinals to receiver identities; fixed `<finishEvent>.<target>.json` files bind that mapping and job-derived event to a completed session/turn/time. The exact v1 contract and limits are in `docs/finish-webhooks.md`.
- Matching exports promote only their target, independently of HTTP accepted/rejected/unknown. Without HTTP records, a valid exported target still shows transport unknown. Missing/invalid exports remain unobserved. Job-local flags do nothing. Inspection has no network transport, writes, finalizer waiting, polling or retry side effects.
- Trust is operator designation plus the authorized export channel and protected local files, not cryptographic provenance. A writer of the designated source can forge matching evidence. Owners/reviewer must follow actual session/turn references; syntax validation is not history verification. No receiver API or signing infrastructure is implied.
- Existing sender/finalizer behavior is unchanged: automatic per-project opt-in, once-only claim, concurrent fan-out, 64-target cap, bounded 32 KiB transport channel and three-second finalizer. Event identity remains `limen-finish-` plus SHA-256 of the job ID, stable across seats but new for a continuation.

## Checks and continuation

`test/finish-webhook.test.ts` is the offline end-to-end harness: the real canonical helper runs through automatic finalization against intercepted fetch and synthetic env files. Both CLI views are captured for accepted/no-export, one correlated/one mismatched export, and two correlated exports. Rejected/stalled transport can independently coexist with observed exports. Repeat finalization leaves request count at two. `test/finish-receipt.test.ts` rejects unselected sources, local flags, wrong event/target/receiver, incomplete turns, malformed/oversized/nonregular/symlink exports and extra/unsafe fields.

Retained round-two evidence: `/home/overment/limen-evidence/f091-51bb62b9/`. `checks-2.md` binds the landing to coordinator checks and records both full-native failures without inferring their cause. Earlier transport evidence remains at `/home/overment/limen-evidence/f091-5932f3a5/`.

Next: Adam reviews the cut and Johnny shepherds the authorized Alice Mac procedure in `docs/finish-webhooks.md`. It uses one fresh automatic-only job, an owner-held HTTP-accepted/no-turn control on that same event, then Johnny/Tony completed-turn exports with externally followed history. If a supported hold is unavailable, obtain an authorized alternative control before sending; do not guess an API. Do not claim Mac proof from this VPS, synthetic exports or the implementation worker's automatic finish receipt. Route refusal and the native-check failures remain separate open items.
