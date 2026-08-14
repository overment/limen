# F003-workspace-coordinator · Outcome

[2026-08-14] [🟢] PROVEN

## Landed

- `limen workspace init` initializes a non-Git coordinator with shared specs, prompts, job state, and `spec/workspace.md`.
- Workspace spawns require one direct-child `--repo`; the selected repository alone receives Git branches, worktrees, reviews, and diffs.
- Parent job records carry the child `repo`, and workers receive an explicit repository boundary plus absolute conventional ticket pointers.
- `jobs`, `wait`, and `stop` resolve workspace-parent records; equal live branch names are permitted in different children.
- README and the coordinator template document the model.

## Evidence

`npm run check` passed: strict TypeScript, Biome, and 46 tests. Workspace coverage includes initialization, target validation, child-only worktrees, ticket paths, job rendering/diff, review/wait/stop, Git-root rejection, and same-branch concurrency across children. `npm pack --dry-run` includes `templates/spec/workspace.md`.
