# Command reference

[README](../README.md) · [Setup](setup.md) · [Jobs](jobs.md)

The coordinator runs job commands. The operator runs setup commands. Run `limen --help` for the installed command list. Run `limen <command> --help`, for example `limen picture --help`, for the usage lines of one command.

Where the reference shows them, IDs, unique suffixes, and unique labels work the same.

## Coordinator actions

The coordinator runs these from its Herdr pane during ordinary work.

### Start and continue jobs

Start a worker, a reviewer, or a job in one child repository, or continue a finished job.

```text
limen spawn --engine <engine> --provider <provider> --model <model> --thinking <level> "instruction" [--label L] [--branch B] [--role NAME] [--timeout 20m] [--task-file F|-] [--prepare CMD] [--tab|--detached] [--extension PATH ...]
limen spawn --engine <engine> --provider <provider> --model <model> --thinking <level> --repo R "instruction" [--label L]
limen spawn --engine <engine> --provider <provider> --model <model> --thinking <level> --review --detached --branch B --label L [--base REF] [--head REF] "instruction"
limen continue <id|suffix|label> "follow-up instruction" [--review] [--label L] [--engine pi|omp] [--provider P] [--model M] [--thinking T] [--tab|--detached] [--extension PATH ...]
```

`--base` and `--head` pin the range that a review reads. They take a full SHA, a short SHA, or a ref such as a branch or tag; Limen resolves it with `git rev-parse` and records the full SHA. They require `--review`.

**Pi extensions.** Repeat `--extension PATH` to select existing local extension files or package directories. Relative paths use the caller's directory, not the worker worktree; quoted `~/` paths expand from the caller's home. Quote paths with spaces. Limen resolves symlinks and removes duplicate paths in first-seen order. Empty values, remote sources (`npm:`, `git:`, URLs), built-in selectors and globs are rejected before preflight or job/worktree creation. OMP rejects this option; its existing launch behavior is unchanged.

Both hosted and detached Pi jobs retain `--no-extensions` and all required Limen hooks. Herdr state reporting remains hosted-only. The selected list is published with the job in `extensions.json`; startup checks that its targets still exist. A missing legacy record means no extras. A malformed record or unavailable target is an error.

For ordinary jobs, `continue` inherits the parent's list when no `--extension` is given. Supplied flags replace the whole list, even if an old path is unavailable; the parent record stays unchanged. Repeat the chosen `--provider`, `--model` and `--thinking` flags: continuation does not inherit those choices. An ordinary fresh `spawn`, including `spawn --branch`, has no user extras unless selected. Group members instead inherit the fixed recorded team list; they cannot replace it. There is no clear-list flag.

Only paths are retained, not extension source or dependency versions. Later edits or upgrades at those paths affect later launches. See [extension trust and model routes](setup.md#personal-model-routes-and-pi-extensions) before selecting third-party code.

### Inspect jobs

Run job commands from the project repository or Limen workspace. Outside either location, Limen names the current directory and tells you where to run. A new repository needs its first commit before `spawn`.

Read the plant inbox, the job records, and the diff of a job, or open a job in Herdr.

```text
limen status [--all]
limen jobs [--running|--active|--all|--label PREFIX|<id|suffix|label>]
limen diff <id|suffix|label>
limen open <id|suffix|label>
```

`status` is the plant inbox. It has four parts:

- `Running`
- `Candidates to inspect` (finished jobs with commits that are not landed)
- `Needs a decision` (failed or stopped jobs with commits that are not landed)
- coordinator tabs

Open groups replace individual member candidates with one line: `group <feature>: N member branches; the lead decides (limen group status <id>)`. Closed groups leave the inbox. Work outside groups keeps its ordinary candidate or decision row.

In a terminal, `jobs` shows an aligned table for people. Through a pipe, it prints the compact format that tools read. `LIMEN_VIEW=human|compact` selects a view. `NO_COLOR` removes the color.

The default compact `jobs` view lists running jobs and recent empty jobs. It hides empty jobs that ended more than 7 days ago and prints `N older empty jobs hidden`. `limen jobs --all` shows every job. An unknown job ID exits 1 with `no job matches "<id>"`.

A job is starting while `limen spawn` still prepares it: the worktree, `--prepare`, and the launch. Its record holds the spawn's pid in `starting` from the first moment. `jobs` and `status` list it as running with the pulse `starting`. A job with no state whose spawn process is gone is `ORPHAN`.

### Control running jobs

Correct or stop a running job, or subscribe to it.

```text
limen steer <id|suffix|label> | --running "correction"
limen stop <id|suffix|label> [reason]
limen watch <id|suffix|label> | --running
limen unwatch <id|suffix|label> | --all
```

### Land and clean up

Merge a job, close the Herdr tabs of a feature, and remove finished worktrees or records.

```text
limen land <id|suffix|label> [--onto BRANCH] [--yes]
limen close <FNNN>
limen prune [--retire [--dry-run]]
```

`land` merges into the checkout of the plant even when another session has uncommitted files there. It leaves those files as they are. It refuses when a file the merge would change has uncommitted edits, or when the index holds staged changes. A merge that fails beside uncommitted files is aborted, so the checkout returns to its earlier state.

### Tickets

Show who first added a ticket.

```text
limen ticket-author <ticket-path>
```

### Map build and refresh

Build the architecture map, or do one quiet refresh pass.

```text
limen picture build [--dir D] [--out F] [--json F] [--strict]
limen picture tick --engine E --provider P --model M --thinking T [--dir D] [--branch B] [--dry-run]
```

### Team groups

Start a team group, and show the status of, publish, wait for, stop, or close it.

```text
limen group start FEATURE --teams N --workers-per-team N --timeout D --worker-timeout D --engine E --provider P --model M --thinking T --worker-thinking T [--team-model team-N=provider/model] [--extension PATH ...] [--team-extension team-N=PATH ...] [--detached|--tab] [--new-run]
limen group status [GROUP-ID] [--json]
limen group publish [GROUP-ID] [--team team-N] "finding"
limen group wait [GROUP-ID] [--timeout D]
limen group stop|close [GROUP-ID]
```

Members get their group from their recorded membership. The group lead gives the group ID. Repeat `--team-model` to give more than one team its own model. For Pi, repeat `--extension PATH` for common extensions and `--team-extension team-N=PATH` for team-only additions. Common paths precede team paths; the recorded effective lists are inherited by members, reviews and worker continuations. Engine/provider/model/reasoning flags still need explicit values. See [Groups](groups.md).

### GitHub comments

Start a hosted review or task for one GitHub request, or give an answer without a job. The claim ID is the triggering comment ID, or `issue-<number>` when an issue body carries the request.

```text
limen github review <root> <claim-id> --engine E --provider P --model M --thinking T
limen github work <root> <claim-id> --engine E --provider P --model M --thinking T --task "instruction"
limen github resolve <root> <claim-id> <handoff-nonce> "no-job answer"
```

## Operator actions

You run these one time for each project or seat, or a scheduler runs them.

### Project setup

Create the project files, set up a parent workspace for child repositories, or choose where group planning files live. `limen init` ends with a `next:` line that names the next step, and says so when the repository has no commit yet.

```text
limen init
limen init --drop-leftovers
limen workspace init
limen planning [committed|private]
```

`limen planning` prints the current planning source. `committed` is the default.

### Seat sweep

Run the seat sweep (see [Seat notifications](jobs.md#seat-notifications)), or install or remove it. Each pass also sends the `coordinator.exited` webhook for a registered coordinator whose process died without a normal exit (see [Plant events](finish-webhooks.md#plant-events)).

```text
limen sweep [--install|--uninstall]
```

### Finish webhook test

Send one `webhook.test` event to this plant's finish webhook targets. The sender prints one line per target. It never prints a URL or a credential.

```text
limen webhook test
```

### Linear

`linear` turns the Linear mirror on or off.

```text
limen linear [on [--team T --project P]|off|status]
```

### GitHub

Connect projects to GitHub, diagnose the seat, and run one polling pass. The poller runs `deliver` to hand one claim to the live coordinator.

```text
limen github connect|disconnect|status|doctor
limen github ensure [registered-root]
limen github poll
limen github deliver <root> <claim-id> <handoff-nonce>
```

`github poll` runs as the isolated App user. It never runs as the worker account.

### Map watch toggle

Turn the architecture map watch on or off, or print its state.

```text
limen picture watch [off | on --engine E --provider P --model M --thinking T [--branch B] [--dir D]]
```

### Scripts

`limen wait` blocks until a job ends, so use it in scripts.

```text
limen wait <id|suffix|label>
```

Because it blocks, `wait` refuses a running job under `LIMEN_COORDINATOR=1`. The refusal names the commands for that job: `limen jobs <id>` to read it now, and `limen watch <id>` when the coordinator did not spawn it and so gets no completion wake. For a job that already ended, `wait` prints the result in a coordinator too.
