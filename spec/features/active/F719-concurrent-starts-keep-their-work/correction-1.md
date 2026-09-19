# Startup safety: correction before landing

Candidate inspected: `63bbff6b77e91e0666d396430e182dcefd1bd1df` on `limen/2026-09-19-f719-concurrent-starts-keep-work-8f1a6434`. The lead inspected the complete diff and retained test output. This is coordinator inspection, not an independent review. Nothing has landed.

## Confirmed remaining loss

In `src/commands/spawn.ts`, `mkdir(jobDir)` publishes an empty directory before the separate `started-at` and `worktree` writes. Prune deletes that directory if scheduled before those writes. The lead's deterministic interleaving probe ran against the candidate, using a real scratch Git repository and the candidate's own spawn/prune functions. It paused after mkdir, invoked prune, and observed the directory disappear followed by spawn failing with ENOENT while writing `worktree`.

Evidence: `tmp/evidence/f719-lead-check-2026-09-19/publication-probe.mjs` and `publication-probe.log`. The initial probe failed to intercept because macOS resolved `/var` to `/private/var`; its output is retained separately as `publication-probe-path-mismatch.log`. The corrected probe canonicalizes the root. Its zero exit means it successfully demonstrated the defect, not that the candidate passed.

Close the publication gap and add a regression for that schedule. Also test the related stale-snapshot schedule: prune reads the job-directory listing, then a new startup publishes its record and worktree before prune lists/removes worktrees. The current keep set comes from the earlier listing. This second schedule is a source-based concern, not yet a reproduced failure. Do not prescribe a timestamp-only fix or add a workflow phase.

## New tests must terminate on failure

The new test helpers in `test/spawn-command.test.ts` launch an outer Node process that synchronously launches the CLI. Failure cleanup kills only the outer process; the gated prepare or Git child can remain blocked forever if its gate is never released. Release gates and settle the actual children on success and failure. Exercise a forced-failure path and retain evidence that the fixture processes are gone; keep changes local rather than adding a general process framework.

## Evidence required at the corrected commit

- Retain raw failing-baseline and passing-candidate outputs for each reproduced startup-loss schedule, with commands and commit identities.
- Run the complete native check once after committing the corrected candidate, with enough tool time to finish; the previous suite took about 28 minutes. Do not amend runtime or tests afterward and present the earlier run as current.
- For remaining failures, compare the same focused check on the unchanged base under the same environment. Source distance alone does not prove a failure unrelated. Several existing failures expose `/var` versus `/private/var`; a canonical TMPDIR is worth testing on both sides without changing unrelated product behavior.
- Preserve interrupted-start and genuine-orphan cleanup acceptance. Do not broaden into unrelated repairs.
- Preserve evidence outside the disposable worktree before returning. The lead has already copied the original `/tmp` artifacts into the retained evidence directory; their summary is not raw proof of every baseline claim.

The size allowance is now an explicit board decision: 4180 is permitted for this slice. A larger necessary allowance must be proposed before changing the guard; do not compress logic or delete unrelated code to meet it. Adam retains review ownership; no independent reviewer is authorized.
