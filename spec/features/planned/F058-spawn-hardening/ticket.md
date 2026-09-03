# F058 · Spawn takes the task from a file, validates before writing, prepares the worktree

## Outcome

A spawn prompt never passes through the coordinator's shell, a failed spawn leaves no half-written job, and a worker or reviewer starts with its dependencies installed. At Alice backticks and `$( )` inside a double-quoted task corrupted three handoffs and wasted one job; a transient `git` lookup failure left six job directories with no state and provoked duplicate spawns; 41 of 93 workers spent their first minutes on `pnpm install`, 28 symlinked the coordinator's `node_modules`, and 42 of 81 reviews lost checks to missing dependencies.

## Scope

- `limen spawn --task-file <path>` and `-` for stdin as alternatives to the positional task; `task.md` receives the bytes untouched. A positional task containing an empty backtick pair or a run of two spaces gets a one-line warning.
- Resolve `git` once at spawn start with an absolute-path fallback, and validate the base commit before creating the job directory; on any failure after creation, remove the directory. Retry a transient `ENOENT` once.
- An optional prepare step after the worktree exists: the command in `LIMEN_PREPARE` or `--prepare`, run in the worktree with a bounded timeout, its output in the job log; failure is logged, not fatal. Document `pnpm install --frozen-lockfile --prefer-offline` as the usual value.
- `limen jobs` names a job directory with no `state` as an orphan; `limen prune` removes orphans.
- `templates/agents.md`: single-quote the task or use a file; a spawn whose shell call timed out may have created a job, so check `limen jobs` before retrying.

## Out of scope

- Adopting or failing a running job that lost its supervisor (F049).
- Hosted start timing and the Herdr readiness wait.
- Installing dependencies for the coordinator's own checkout.

## Acceptance

- A task file containing backticks and `$(date)` spawns a job whose `task.md` is byte-identical to the file.
- With `git` absent from `PATH` for the first call, spawn either succeeds on the retry or exits with no job directory left behind.
- With `LIMEN_PREPARE=touch prepared`, the worktree contains `prepared` before Pi starts and the job log records the step.
- `limen jobs` lists a stateless directory as orphan and `limen prune` deletes it.
- The spawn and prune suites pass.

## Notes

The prepare command is the project's; Limen only runs it. Symlinking another checkout's `node_modules` is the hazard this replaces.
