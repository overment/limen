# Limen speech playback removal

Playback code, `/speak` registration, and README advertising are removed in `cb3542a` (`Remove optional speech playback and command registration`). Candidate only; no merge. **Not merge-ready:** the full native lane is incomplete with failures, and the coordinator must retire the feature records before this request is complete.

## Changes and boundaries

- Deleted `hook/speak.ts`, including CLI discovery, assistant-response selection, and subprocess playback. Removed its import, API type intersection, and registration call from `hook/communication.ts`.
- Replaced the three playback tests in `test/speak-hook.test.ts` with `test/no-speech-hook.test.ts`. It calls the real communication extension with a command-registration spy, both with an executable `speak` fixture on PATH and with empty PATH.
- Removed only the playback paragraph from `README.md`. Writing-register prose, guidance tests, templates, and other projects are unchanged.
- No separate speech entry or dependency exists in `package.json`. `templates/limen-extension.ts` loads communication alongside wake and steering; removing the communication hook's call removes the registration path. Its “speech” comment refers to writing guidance and is unchanged.
- No dedicated speech-history artifact was found outside F046's protected ticket/outcome. Mixed historical audit logs remain historical evidence, not current advertising. External CLI installations and independent Pi skills/extensions are untouched.

## Checks actually run

- Discriminator before removal: `node --test test/speak-hook.test.ts` failed as intended, **0 passed / 1 failed**, because the installed executable caused `/speak` registration (`absence-before.log`).
- After removal: `node --test --test-concurrency=1 test/no-speech-hook.test.ts test/communication-hook.test.ts` passed **23 / 23**, including all writing-guidance behavior (`focused.log`).
- Lockfile install: `npm ci --ignore-scripts --no-audit --no-fund` added 12 packages. npm warned about the existing `min-release-age` user config (`install.log`).
- `npm pack --dry-run --json` plus assertions passed: **72 packaged files**, communication/loader retained, no speech module or `/speak`/removed-helper references (`package-absence.log`, `package-files.json.txt`).
- `git diff --check` passed for the source diff. The staged evidence check initially flagged two whitespace-only lines in the failure log; those blank lines were normalized.
- Full `npm run check` ran once from clean `cb3542a`. TypeScript passed; Biome checked 81 files with no fixes. The test run hit the tool's **1200-second timeout**, after logging **seven failures**, with no final summary or process exit code. It is **not a passing suite** (`native.log`, `NATIVE.md`). No baseline comparison or rerun established why those tests failed.

No interactive Pi reload or real audio playback was tested. After landing, reload/restart existing Pi sessions to unload the old command. No independent review was started.

## Remaining coordinator actions

`RETIREMENT.md` gives the exact F046 record changes withheld under the worker's prohibition on editing board, ticket status, or outcomes. Resolve those and triage native failures before asking Adam to merge. No other product decision is needed for this removal.

Evidence is copied outside the worktree to `/Users/overment/.overment/limen/tmp/evidence/remove-audio/`.

- Branch: `limen/2026-09-16-remove-audio-995a164f`.
- Worktree: `/Users/overment/.overment/.limen-limen-worktrees/2026-09-16-remove-audio-995a164f`.
- Session: `/Users/overment/.overment/limen/.limen/jobs/2026-09-16-remove-audio-995a164f/session`.

The brief was absent from the isolated worktree; the supplied coordinator copy was read first and preserved here. Automatic finish configuration is present; no attempt/result was observed at handoff and no manual ping was sent.
