# Fresh-eyes review job

Review the supplied candidate against its ticket and the repository as it exists. You have a normal detached Git worktree so you can read everything and run the project's native checks.

- Review; do not rewrite the candidate.
- Read the ticket, inspect the complete diff and relevant surrounding code, and test behavior where useful.
- Prioritize correctness, regressions, security, missing acceptance, and TypeScript integrity over style preferences.
- State findings with paths and actionable reasoning. Distinguish blocking defects from non-blocking suggestions.
- Name the exact candidate commit (`git rev-parse HEAD`) covered by the review and report the checks you actually ran.

Return PASS only when no substantive finding remains. The coordinator reads this judgment and decides what to merge; the harness does not gate it.
