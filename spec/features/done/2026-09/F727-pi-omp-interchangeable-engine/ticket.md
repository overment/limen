# F727 · Pi and OMP share one engine profile

## Outcome

Adam can run Limen jobs on Pi or OMP behind one flag, one wrapper, and one stream parser. Implement-now: land the shared engine profile table and allow `--engine omp` on VPS main; the spike established that no second parser is needed.

## Scope

- Start in `src/engine.ts` with the profile table and `argvFor` defined by `spec.md`; both detached and hosted launches consume it.
- Spawn accepts `--engine pi|omp`, falls back to `LIMEN_ENGINE` then Pi, persists the selected engine, and records its binary version.
- OMP preflight checks PATH only; Pi retains its optional auth check, and unsupported engines fail before creating a job.
- Continuation copies the parent engine and session, launches the same profile, and refuses a conflicting `--engine`.
- Document engine selection and separate Pi/OMP auth stores; retain `interpret()` and `src/stream.ts` unchanged.

## Out of scope

- A second wrapper or stream parser, or restoring Claude.
- Merging `~/.pi` and `~/.omp` credentials or adding OMP auth probes.
- Live hosted OMP proof unless trivial; GitHub doorbell and unusable-route refusal.

## Acceptance

- Spawn tests show OMP is accepted and Claude fails before any job exists.
- Detached OMP argv uses `--mode json`, `--auto-approve`, and `--no-title`, never Pi's `--approve` or `--name`.
- Hosted launches omit JSON mode and select Herdr's profile-specific kind.
- Continuation tests show an OMP parent keeps its engine and copied session, while an explicit Pi override is rejected.
- Stream tests show unknown extra event types emit no events without a parser change.
- Focused spawn/wrapper/continue/stream tests and typecheck pass on the committed candidate.

## Notes

The profile fields and exact argv mapping in `spec.md` are authoritative. `spike.md` records observed compatibility and the remaining live hosted/continuation risks. The coordinator owns the board, landing onto main, and pushing origin/main.
