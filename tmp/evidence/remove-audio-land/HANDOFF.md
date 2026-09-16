# Speech removal: native triage complete, coordinator retirement still blocks landing

All seven previously reported native failures reproduce on freshly fetched `main`, at the same assertion sites. The native cleanup condition is satisfied under Adam's landing authorization; no removal-caused failure or necessary code repair was found. **Not merged or pushed:** F046 retirement remains undone because this worker's higher-priority instructions prohibit editing board, ticket status, or outcome files. The job ending is not completion of the landing request.

## Changes and checks

- Source removal remains `cb3542a` (`Remove optional speech playback and command registration`), with original evidence in `4686c24`. This continuation changes only evidence files under `tmp/evidence/remove-audio-land/`.
- Comparison checkpoint `2cc0b93` (`Compare speech removal native failures with main`) retains the failed assertion output and decision in `TRIAGE.md`.
- Seven-test candidate run on `4686c241a4f10c28b460abf545fb7bf7455e0c33`: **0 passed / 7 failed / 0 cancelled**, exit **1**, 76.814 seconds (`candidate-seven.tap`).
- Identical slice on main `38b2dc9ffbcf20bb88edd50900c43ba40b3f3f69`: **0 passed / 7 failed / 0 cancelled**, exit **1**, 78.932 seconds (`main-seven.tap`). `git fetch origin` succeeded; local and remote main matched this SHA. The same assertions fail, including the explicit `/var` versus `/private/var` path difference and the stop timing bound (2383ms candidate, 2473ms main). See `TRIAGE.md` for all seven.
- On clean `2cc0b93`, `node --test --test-reporter=tap --test-concurrency=1 --test-timeout=60000 test/no-speech-hook.test.ts test/communication-hook.test.ts` passed **23/23**, exit **0** (`focused.tap`). The discriminating test calls the real extension with an executable `speak` fixture on PATH and with empty PATH; neither registers `/speak`. Writing-guidance checks also pass.
- `npm pack --dry-run --json` and explicit package assertions passed: **72 packaged files**, communication and loader retained, no speech module, `/speak` command, or deleted-module reference (`package-absence.log`, `package-files.json.txt`). npm emitted the existing `min-release-age` configuration warning.
- `git diff --cached --check` passed before the comparison commit. TAP whitespace-only lines were normalized without changing assertion text or values.

The full native suite was **not rerun** in this evidence-only continuation. The prior clean-source run on `cb3542a` passed TypeScript and Biome, then hit its 1200-second outer timeout with these seven failures and no final suite result. That failed/incomplete evidence remains in `../remove-audio/NATIVE.md` and `native.log`; the paired slice does not claim full-suite success. No interactive Pi reload or actual playback was tested. No independent review was started.

## Required coordinator action

Retire `spec/features/done/2026-08/F046-optional-speech-command/` per `../remove-audio/RETIREMENT.md`: it still has a PROVEN status line and present-tense playback claims. The supplied brief prefers the dropped lane and a short historical outcome saying the command shipped, then was removed at the owner's request, citing the actual landing commit. Reconcile `spec/build.md` only if needed; its August history is aggregate-only. Leave writing-register prose unchanged.

This is an instruction-authority blocker, not a new product decision: Adam already authorized land once the cleanup is done. The implementation worker may not override the explicit prohibition on feature-state and outcome edits, and the supplied project context separately marks the board read-only. A coordinator with authority to make those record changes must do so before the ordinary merge to `main` and `git push origin main`. Both refs remain at `38b2dc9`; this worker ran neither merge nor push. Refresh refs/status before landing if another job has advanced them.

After landing, Adam should reload/restart existing Pi sessions to unload the old `/speak` registration, then confirm the command is absent. The independent `speak` CLI and Pi skills/extensions outside Limen are untouched.

## Durable handoff

- Evidence copied out of the worktree to `/Users/overment/.overment/limen/tmp/evidence/remove-audio-land/`; start with `TRIAGE.md`, this handoff, and the paired TAP logs.
- Branch carrying the candidate and comparison: `limen/2026-09-16-remove-audio-995a164f`.
- Worktree: `/Users/overment/.overment/.limen-limen-worktrees/2026-09-16-remove-audio-995a164f`.
- Continuation session: `/Users/overment/.overment/limen/.limen/jobs/2026-09-16-remove-audio-land-fdb9d3f0/session`.
- The named `BRIEF.md` was absent in this worktree; the coordinator copy at `/Users/overment/.overment/limen/tmp/evidence/remove-audio-land/BRIEF.md` was read. No replacement ticket was sought. The temporary detached main worktree was removed after baseline checks; no matching test-fixture processes remained when inspected.
- Finish delivery: `finish-webhook-env` is present; `finish-webhook` and `finish-webhook-attempt` were absent at the handoff check. Automatic delivery is configured but not yet observed. No manual ping was sent.
