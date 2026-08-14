# F003-workspace-coordinator · Non-Git workspace coordinator

[2026-08-14] [🟢] [PROVEN] [COORDINATOR] PROVEN · F003-workspace-coordinator

## Outcome

A person can coordinate several adjacent Git repositories from one non-Git workspace root, keeping shared intent and feature specs beside them while every worker and reviewer operates in exactly one selected repository.

## Scope

- Add `limen workspace init` for a non-Git coordinator directory.
- Add `--repo <immediate-child>` to worker and reviewer spawns in that mode.
- Keep branches, worktrees, reviews, and diffs scoped to the selected Git child.
- Record the selected repository with each workspace job and render it in `limen jobs`.
- Rewrite a conventional relative `Ticket: spec/...` pointer to the workspace’s absolute spec path for jobs.
- Document the workspace workflow in README and the coordinator template.

## Out of scope

- A parsed repository manifest or registry.
- A single job that mutates multiple repositories.
- Cross-repository atomic review or merge.
- Migrating legacy Control workspaces.

## Acceptance

- `limen workspace init` initializes templates and runtime state in a non-Git parent without creating `.gitignore`.
- Workspace spawns require a direct-child `--repo` that is itself exactly a Git root.
- The selected repo alone contains the new branch/worktree; its name is recorded in the job.
- Workspace workers receive absolute pointers for conventional relative spec tickets.
- Workspace review, jobs, wait, and stop resolve records from the parent while Git work remains scoped to the recorded repo.
- Existing single-repository commands retain their behavior.

## Notes

The human-owned `spec/workspace.md` explains the adjacent repositories to the coordinator. Limen does not parse it; `--repo` is an explicit per-job choice. One job owns one repository so Git’s branch/worktree model stays unambiguous.
