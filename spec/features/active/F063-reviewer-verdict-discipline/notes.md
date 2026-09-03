# Notes

## Seams

- `templates/reviewer.md` — birth prompt. Spawn still matches `Review; do not rewrite`.
- `test/structure.test.ts` — phrase assertions plus the two forbidden strings.

## Decisions

- Blocking is a proven break of an acceptance bullet only. A contract or unnamed security issue that is not an acceptance bullet is a note.
- Verdict line is `PASS <sha>` or `FAIL <sha>`; the sha is `git rev-parse HEAD`.
- Install from the lockfile replaces "installing is not reviewing". Unverified never fails the environment.

## Probes (2026-09-03)

Isolated `pi -p --no-tools` with this template appended:

- Acceptance defect plus lint bypass → first line `FAIL 1111…1111`, one blocking finding, one note.
- Missing `node_modules`, no checks run → first action `npm ci` from the lockfile; verdict `PASS 2222…2222` with acceptance unverified, not FAIL.

Live `pi -p --tools read,bash` in `/tmp/f063-env-probe` (lockfile present, no `node_modules`):

- Ran `npm ci`, then `node --test test.js` (1 pass). First line `PASS 43ba801d3e6f90419e05d3bc89f8afc9296766b8`. Did not FAIL the environment.

## Open

None. Independent review still earns a real candidate, not these fixtures.
