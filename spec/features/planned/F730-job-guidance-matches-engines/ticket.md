# F730 · Job guidance matches the engine and available evidence

## Outcome

Operators see the engine that actually ran rather than a Pi-only label on OMP jobs. Coordinator guidance uses inspectable evidence when steering a worker instead of implying that the removed dirty-file counter still exists.

## Scope

- Start with the hard-coded completion label in `src/wrapper.ts` and the Pi-only hosted diagnostic in `src/supervisor.ts`.
- Align job-launch and continuation wording in the shop manual and README with the shared engine profile table.
- Clarify recovery evidence from pulse, logs, commits, and an inspected worktree; keep steer-before-stop guidance.
- Preserve statements that genuinely refer only to the Pi coordinator or Pi-specific flags.

## Out of scope

- Changing runtime completion or recovery decisions.
- Restoring the changed-file counter or adding telemetry.
- Rewriting the communication register or inventing another owner of engine policy.

## Acceptance

- A completed detached OMP job has an OMP-specific terminal log reason; a Pi job retains an accurate Pi reason.
- Hosted diagnostics no longer claim every surviving job process is Pi.
- Manual inspection finds job-mode and continuation guidance consistent with `--engine pi|omp`.
- Recovery guidance does not depend on a removed jobs-display counter and still permits direct worktree inspection.
- Focused behavioral tests, template-history checks, and typecheck pass without adding exact-sentence policy tests.

## Notes

Two prose findings in `spec/quality/2026-09-2.md` share this slice. “Zero changed files” can still come from direct inspection; removing that ambiguity must not prohibit an otherwise evidence-based steer. Hosted process recognition itself belongs to the separate liveness ticket (F728).
