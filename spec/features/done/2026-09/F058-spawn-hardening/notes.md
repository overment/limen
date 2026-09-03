# F058 notes

## Seams

- `src/commands/spawn.ts` — `--task-file` / `-` / `--prepare`; positional `` `` or doubled-spaces warning; `headCommit` before `mkdir` of the job dir; try/catch `rm` if writes fail before `state`.
- `src/git.ts` — first `git` ENOENT retries once, then `/usr/bin/git`, `/usr/local/bin/git`, `/opt/homebrew/bin/git`. Cached per process.
- `src/commands/jobs.ts` — missing/empty `state` renders `ORPHAN <id> · no state`; compact snapshot includes those rows.
- `src/commands/prune.ts` — `pruneFinishedWorktrees` deletes job dirs with no `state` (spawn's opportunistic prune does too).

## Decisions

- File/stdin `task.md` is the raw buffer. Workspace prefix and `Candidate commit:` append only for positional tasks.
- `--prepare` wins over `LIMEN_PREPARE`. Failure is logged, not fatal. Timeout `LIMEN_PREPARE_MS` or 300s.
- Positional `-` and `--task-file -` both read stdin.

## Checks

Spawn, jobs, prune, structure, job, continue suites. Worktree has no `node_modules`; tsc/biome used the main checkout's copies.
