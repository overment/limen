# Command reference

[README](../README.md) · [Setup](setup.md) · [Jobs](jobs.md)

The coordinator runs job commands. The operator runs setup commands. Run `limen --help` for the installed command list. Run `limen <command> --help`, for example `limen picture --help`, for the usage lines of one command.

Where the reference shows them, IDs, unique suffixes, and unique labels work the same.

## Coordinator actions

The coordinator runs these from its Herdr pane during ordinary work.

### Start and continue jobs

Start a worker, a reviewer, or a job in one child repository, or continue a finished job.

```text
limen spawn --engine <engine> --provider <provider> --model <model> --thinking <level> "instruction" [--label L] [--branch B] [--role NAME] [--timeout 20m] [--task-file F|-] [--prepare CMD] [--priority 1|2|3] [--tab|--detached] [--extension PATH ...]
limen spawn --engine <engine> --provider <provider> --model <model> --thinking <level> --repo R "instruction" [--label L]
limen spawn --engine <engine> --provider <provider> --model <model> --thinking <level> --review --detached --branch B --label L [--base REF] [--head REF] "instruction"
limen continue <id|suffix|label> "follow-up instruction" [--review] [--label L] [--engine pi|omp] [--provider P] [--model M] [--thinking T] [--tab|--detached] [--timeout D] [--priority 1|2|3] [--extension PATH ...]
limen spawn --engine devin [--provider macos|linux] [--model MODE] "instruction" [--label L] [--branch B] [--timeout 20m] [--task-file F|-]
```

**Start queue.** A detached job waits in the seat's start queue until the machine has room for it; see [Start queue](jobs.md#start-queue). Spawn and continue then print `queued <label>: <reading>, N ahead` before the ID. `--priority` sets the queue order: 1 is the most urgent, 2 is the default, and `continue` keeps the parent's priority unless it gets its own flag. The job records it in `priority`. Spawn when the work is ready; Limen starts the job and tells its coordinator.

`--base` and `--head` pin the range that a review reads. They take a full SHA, a short SHA, or a ref such as a branch or tag; Limen resolves it with `git rev-parse` and records the full SHA. They require `--review`.

**Pi extensions.** Repeat `--extension PATH` to select existing local extension files or package directories. Relative paths use the caller's directory, not the worker worktree; quoted `~/` paths expand from the caller's home. Quote paths with spaces. Limen resolves symlinks and removes duplicate paths in first-seen order. Empty values, remote sources (`npm:`, `git:`, URLs), built-in selectors and globs are rejected before preflight or job/worktree creation. OMP rejects this option; its existing launch behavior is unchanged.

Both hosted and detached Pi jobs retain `--no-extensions` and all required Limen hooks. Herdr state reporting remains hosted-only. The selected list is published with the job in `extensions.json`; startup checks that its targets still exist. A missing legacy record means no extras. A malformed record or unavailable target is an error.

For ordinary jobs, `continue` inherits the parent's list when no `--extension` is given. Supplied flags replace the whole list, even if an old path is unavailable; the parent record stays unchanged. Repeat the chosen `--provider`, `--model` and `--thinking` flags: continuation does not inherit those choices. An ordinary fresh `spawn`, including `spawn --branch`, has no user extras unless selected. Group members instead inherit the fixed recorded team list; they cannot replace it. There is no clear-list flag.

Only paths are retained, not extension source or dependency versions. Later edits or upgrades at those paths affect later launches. See [extension trust and model routes](setup.md#personal-model-routes-and-pi-extensions) before selecting third-party code.

**Devin cloud jobs.** `--engine devin` runs the job as a Devin cloud session: `--provider` names the platform (`macos` or `linux`) and `--model` the Devin mode. The job pushes its branch to `origin`, follows the session into its log, and fast-forwards the worktree from the pushed branch when the session finishes; Devin's last message is the result. It runs detached only: spawn refuses `--tab`, `--thinking` and `--extension`, and `continue` and group teams refuse the engine. `limen stop` and the timeout terminate the session. Credentials, limits and failure reasons: [Devin cloud jobs](setup.md#devin-cloud-jobs).

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

When a webhook target refused a ping with HTTP 401 or 403, the first line after the plant is `Finish webhook rejects: invalid key (…)`. It names the target, the event, the time and the receipt folder. A later ping that every target accepts, or a passing `limen webhook test`, removes it.

In a terminal, `jobs` shows an aligned table for people. Through a pipe, it prints the compact format that tools read. `LIMEN_VIEW=human|compact` selects a view. `NO_COLOR` removes the color.

The default compact `jobs` view lists running jobs and recent empty jobs. It hides empty jobs that ended more than 7 days ago and prints `N older empty jobs hidden`. `limen jobs --all` shows every job. An unknown job ID exits 1 with `no job matches "<id>"`.

`limen jobs <id>` also shows `model`, the provider and model that the session's turns ran, and `tokens`, the turns and the input, output, cache-read and cache-write totals of that job's own turns. When a turn ran a model other than the one spawn recorded in the job's `model` file, the line shows both: `served … · requested …`. This informs; it does not block.

A job in the start queue lists as running with the pulse `queued`, then its wait and the reason: the CPU and memory reading against the gate, or each rule that holds its priority with the rule's end, and the number of jobs ahead. `limen queue` prints the gate, the current reading, and every waiting job of the seat in start order, each held job with the rules that hold it. It samples the load for about two seconds.

A job is starting while `limen spawn` still sets it up: the worktree and the launch. Its record holds the spawn's pid in `starting` from the first moment. `jobs` and `status` list it as running with the pulse `starting`. A job with no state whose spawn process is gone is `ORPHAN`. Spawn prints the job ID as soon as the record exists, and again on its last line. The job's wrapper or hosted supervisor then prunes finished worktrees and runs `--prepare` before the engine starts; the job log records each result and its time. A prepare command has 5 minutes; a plant can change that (see [Limits](jobs.md#limits)). A setup failure after the ID printed marks the job `failed`.

### Control running jobs

Correct or stop a running job, or subscribe to it.

```text
limen steer <id|suffix|label> | --running "correction"
limen stop <id|suffix|label> [reason]
limen watch <id|suffix|label> | --running
limen unwatch <id|suffix|label> | --all
```

### Land and clean up

Merge a job and close its ticket, close the Herdr tabs of a feature, and remove finished worktrees or records.

```text
limen land <id|suffix|label> [--onto BRANCH] [--yes] [--keep-open]
limen close <FNNN>
limen prune [--retire [--dry-run]]
```

`land` merges into the checkout of the plant even when another session has uncommitted files there. It leaves those files as they are. It refuses when a file the merge would change has uncommitted edits, or when the index holds staged changes. A merge that fails beside uncommitted files is aborted, so the checkout returns to its earlier state.

`land` asks for a confirm only when stdin is a terminal; `--yes` skips it there too. After the merge, `land` deletes the job's local `limen/*` branch and the finished worktree that holds it. It keeps the branch while another job on that branch, such as a continuation, is still running, and prints why.

`prune` prints one line for each worktree, leftover directory, or stateless record it removes: `pruned <path> (job <id>): <reason>`, with `job none` when no record names the path. The prune that a new job runs writes the same lines to its own log and to the log of the job whose worktree went.

Prune and `land` never remove the worktree or record of a job that is starting, running, or in an open group, nor a worktree made inside such a job's worktree. A running job keeps its worktree even when its process looks gone; `limen sweep` finalizes it first. Prune lists what it may remove, then reads the job records under the lock that publishing a job record also takes, so a job started during a prune keeps its worktree. It moves each removal out of reach in one rename and deletes it after the lock. A Git-locked worktree stays.

After the merge, `land` also closes the active tickets the job works on: the tickets its label, ID or `Ticket:` pointers name, or, when they name none, the feature that starts its commit subjects (`F946: …`). Each folder moves to `spec/features/done/YYYY-MM/` with a `landed` date, NOW and PROVEN in `spec/build.md` are regenerated, and both go in one commit, `Close FNNN: landed by <id>`. `--keep-open` keeps the tickets active while more slices remain. When the board or a ticket folder has uncommitted edits, the tickets stay active and `land` says so.

### Tickets and the board

Show who first added a ticket, close a ticket whose work landed another way, name the plants that share F numbers, and show the board.

```text
limen ticket-author <ticket-path>
limen ticket done FNNN [FNNN ...] [--on YYYY-MM-DD]
limen ticket series [NAME PLANT [PLANT ...]]
limen board [--write]
```

NOW and PROVEN in `spec/build.md` are generated from the feature lanes: NOW lists `active/`, PROVEN the last ten landed tickets and one count line per month folder. An archived done ticket counts in PROVEN by its close month, and a month line names `spec/features/archive.tsv` when the register holds some of that month's tickets. TRACK, NEXT, PARKED and DROPPED stay as the coordinator wrote them. `limen board` prints the board with each active ticket's running job, or its last job when none runs: failed, done but not landed, or landed. It lists running jobs that name no active ticket below NOW. `--write` rewrites NOW and PROVEN in the file.

**Ticket numbers.** `limen ticket new` takes one more than the highest F number in use. A number is in use when one of these names it: a ticket folder in any lane (`spec/features/<lane>/` or `spec/features/<lane>/<month>/`, `cancelled/` included), a row of `spec/features/archive.tsv`, a local `limen/*` branch, or a job label.

**Shared series.** Plants on one seat can share one F-number series. `limen ticket series NAME PLANT [PLANT ...]` names the plants of series NAME. It replaces the earlier list and refuses a plant that another series names. To take a plant out, name the series again without it. With no arguments, the command shows the series of this plant: its plants, `mark` (the highest number `ticket new` issued in the series) and `next` (the number `ticket new` would take now). The series is seat state in `$LIMEN_HOME/.limen/series/NAME/` (`~/.limen/series/NAME/` by default): `plants` holds one plant root per line, and `mark` holds the mark. In a plant of a series, `ticket new` holds `mark.lock` from reading the mark to writing the ticket folder. The number it takes is above the mark and above every number in use in any plant of the series, so two plants never take the same number. A plant that no series names takes numbers alone, without the mark and the lock.

**Archive register.** A plant that moves closed tickets out of `spec/features/` records them in its tracked `spec/features/archive.tsv`. The first line names the tab-separated columns: `path`, `number`, `title`, `close_month`, `archive_date`, `last_commit`, `manifest_digest`; without that line, Limen reads the columns in this order. Limen reads `path`, `number`, `title` and `close_month`. `number` is `FNNN` or `NNN`. A row whose `path` ends in an `FNNN-slug` folder archives that ticket. A row with another path, such as a high-water row (`high-water`, then the highest number issued), only keeps its number in use. Every row's `number` stays in use for `ticket new`. `limen land` and `limen ticket check` refuse a new ticket whose number an archived ticket holds, or a ticket folder in another plant of the series. `limen close` treats an archived ticket as closed.

### Seat-wide rules

Give every coordinator on the seat one rule until a time, change it, end it, or list the rules that hold.

```text
limen rule
limen rule set NAME --until 90m|12h|3d|"YYYY-MM-DD HH:MM"|ISO [--start-priority 1|2|3] "text"
limen rule end NAME [reason]
```

A rule is one record per name under the Limen home (`~/.limen/rules/NAME/`, or `$LIMEN_HOME/.limen/rules/NAME/`): the text, the end time, who set it, the start priority, and one receipt per pinged tab. `--until` takes a duration, a local date and time, or an ISO time with a zone. Setting a name that holds is a change. A set, a change and an end each send one `herdr agent prompt` to every live coordinator tab: a registration under `<project>/.limen/coordinators/` in a project of the seat registry, with a live process and no shutdown mark, the newest one on each pane. The pane that ran the command is one of them. A text that may have reached a pane is never sent again. A detached timer ends the rule once at its end time and pings every live tab with what the rule held. When that timer died, the next `limen` command run where Herdr is reachable starts a new one. A rule that holds is shown in each coordinator's turn context and at the top of `limen board`; it never enters `spec/build.md`. While a rule with `--start-priority N` holds, the start queue starts only detached jobs at priority N or more urgent; see [Priority budget](jobs.md#start-queue).

### Map build and refresh

Build the architecture map, serve it with live job activity, or do one quiet refresh pass.

```text
limen picture build [--dir D] [--out F] [--json F] [--strict]
limen picture serve [--dir D] [--port N]
limen picture tick --engine E --provider P --model M --thinking T [--dir D] [--branch B] [--dry-run]
```

### Team groups

Start a group, and show the status of, publish, wait for, stop, or close it.

```text
limen group start FEATURE --team ENGINE:PROVIDER/MODEL:THINKING [--team …] [--rounds draft,critique,revise,final] [--workers N] [--timeout D] [--extension PATH ...] [--team-extension team-N=PATH ...] [--detached|--tab]
limen group status [GROUP-ID] [--json]
limen group publish [GROUP-ID] [--team team-N] "finding"
limen group wait [GROUP-ID] [--timeout D]
limen group stop|close [GROUP-ID]
```

Each `--team` is one agent on its own route, for example `--team pi:pi-claude/claude-opus-5-5:high`; the teams are `team-1`, `team-2`, and so on, in flag order. `--rounds` defaults to `draft`, `--workers` to 0 and `--timeout` to 90m. Members get their group from their recorded membership. The group lead gives the group ID. For Pi, repeat `--extension PATH` for common extensions and `--team-extension team-N=PATH` for team-only additions. Common paths precede team paths; the recorded effective lists are inherited by members, reviews and worker continuations. See [Groups](groups.md).

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

### Herdr highlight

Mark every string that Limen writes into Herdr with `◆`, seat-wide, or print the state and the legend. It is off by default. See [See what Limen added](herdr-status.md#see-what-limen-added).

```text
limen highlight [on|off]
```

In a coordinator's Pi session, `/limen highlight on` and `/limen highlight off` do the same.

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

Because it blocks, `wait` refuses a running job under `LIMEN_COORDINATOR=1`. The refusal names the commands for that job: `limen jobs <id>` to read it now, and `limen watch <id>` when the coordinator did not spawn it and so gets no completion wake. The first line is the state, label and id (`DONE label · id …`). The job's ending follows, as a completion wake carries it: stop reason, at most ten commits, the whole final message, and undelivered steers. For a job that already ended, `wait` prints the same in a coordinator too.
