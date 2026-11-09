<p align="left">
  <a href="https://mega.dev">
    <img src="docs/assets/mega-logo-badge.svg" alt="MEGA.dev" width="220" height="60">
  </a>
</p>

# Limen

> **[Explore the full workflow → Towards Autonomous Product Development](https://mega.dev/autonomous-product-development)**
>
> This MEGA Drop explains the workflow behind Limen. It includes a live video walkthrough with Pi, Herdr, and Grok Bot. [MEGA.dev](https://mega.dev) shares practical articles, repos, and tools for work with AI.

You describe a task to an agent in Pi or Herdr.
The agent uses Limen to plan work, start workers, and request review.
Jobs run in separate Git worktrees and keep their task, branch, log, state, and session.
You review the results and approve merges.

Experimental software. Commands, prompts, and project files can change.

## Requirements

- macOS or Linux, with Node.js 24 or later and Git.
- [Pi](https://pi.dev), the default engine, or OMP (`--engine omp`), installed and authenticated.
- Herdr is optional for interactive job tabs.
- A Devin account is optional, for jobs that run as Devin cloud sessions (`--engine devin`).

See the [setup guide](docs/setup.md) for engine and Herdr configuration.

## Start

Install Limen once:

```bash
git clone https://github.com/overment/limen.git
cd limen
npm install
npm link
```

In your project’s Git repository, run:

```bash
cd /path/to/your-project
limen init
```

Open Pi (`pi`) in that directory, or start an agent tab in Herdr.
Before you ask for code, define these project files:

- `spec/vision.md`: what the project should do, who it serves, and its scope.
- `.agents/limen/styleguide.md`: code structure, conventions, and required checks.

You can ask the agent to help:

> Help me define the project vision and code styleguide before we start work.

`limen init` preserves existing specs. The repository must have at least one commit before a worker starts.

Planning is committed to Git by default. To keep planning private, run `limen planning private`. Planning files then stay in the canonical project root, and jobs read them through absolute paths. Limen does not copy them into worktrees. `limen planning` shows the current setting. `limen planning committed` restores the default for new jobs.

To update Limen, pull the package clone and use `/reload` in the agent session.
All projects on that computer use the same installed package.

## Work

1. Tell the agent the result you need, such as “Add email sign-in.”
2. The agent records a ticket, starts jobs, and requests review.
3. Inspect the result and approve the merge.

The specs describe the work. `spec/build.md` records its state.
A completed job does not prove that a feature is finished or that its branch is ready to merge.

Workers approve tools automatically and have the same access as your account.
A Git worktree is not a security sandbox. Read the [security notes](SECURITY.md).

## Picture

After `limen init`, ask the agent:

> Create a Picture map from the code and specs, and open it in my browser.

See the [Picture guide](docs/picture.md) for navigation and updates.

## Task-note experiment (started 2026-10-22)

The experiment started on 2026-10-22 at 12:17 CEST (UTC+2), when this change landed on `main`. Jobs that started before that time have no note. On 2026-10-23 the note became the plan below (F950). Notes from before that change use the earlier 🔴 / 🟡 / ⚪ marker lines.

**What changed.** Every Limen job keeps a task note in `.limen/jobs/<id>/note.md`. Team coordinators of a group get one too; the top-level coordinator session does not. The agent writes the note. Limen copies and shows the note, and never parses it. At the finish, Limen reads the "Note check" of the final message (see **After the finish**).

- **The format.** A plan in plain technical English, about six lines in three parts, with no colored markers. It is not a task copy or a result log.
  - `Done means:` two to four end checks. Each states what must be true, then `Shown by:` and the command or observation that would prove it.
  - `Easy to miss:` the one task rule that the quickest way to finish could skip or break, quoted, with its own `Shown by:`.
  - `Not proven yet:` the short names of the end checks and the rule that lack evidence.
  - A check stays in the note after it is proven and gets `Seen: <evidence location>`: a pointer, not results.
- **The files.** Limen keeps the first version of the note as `note.first.md`, and adds a `note changed` line to the job log at each change. `limen continue` copies both files into the new job folder.
- **Three injections.** The first prompt of each job, also a continued one, asks the agent to read or write the note, with the format. A continued job reads its note against the new task and reuses earlier evidence only after it confirms that the evidence still applies. When a steer changes an end check or the easy-to-miss rule, the agent keeps the old line, adds `Changed: <new requirement>. Reason: <what changed it>` under it, and puts the affected checks back in `Not proven yet`. Once before the finish, Limen shows the note now, the note at the start when it differs, and the project reminders. Under the heading "Note check" in its final message, the agent marks each end check proven, not proven, changed or dropped, and the easy-to-miss rule followed, broken or not proven, each with its evidence or the gap. Without a note, the agent reconstructs the end checks and the rule from the job's `task.md`.
- **Before the finish.** The first `finish` call gets the check and does not end the job. A detached run that ends without `finish` gets the check as one more turn (Pi 1.2.0 or later, and OMP). A hosted job whose agent never calls `finish` gets no check. The log records `note check sent`. Devin jobs run no Limen hooks and get no note.
- **After the finish.** Each "Note check" line reads `- <check>: <mark>. <evidence or gap>`. A proven line names its evidence in backticks: a command that ran in the session, or a file. Before Limen records `done`, it writes `open-checks`: one line for each item marked not proven, changed, dropped or broken, and for each proven item with no proof that its command ran and no such file. A command counts when one recorded bash call ended with exit 0 and joined its simple commands only with `&&`; exit 0 of such a chain means each of them ran. A command before a pipe does not count, because a pipe exits with its last command's status. Quoted text, comments and heredoc bodies are no commands. A call with `;`, a line break, `||`, `&`, parentheses, backticks, `!`, `if`, a loop, `exit`, `eval`, `set` or a quoted command name proves nothing, and in OMP's persistent shell neither does any call after one that defined a function or set an option; name a saved log file instead. The open line says which of these held. A check that was sent and not answered is one open item. The job is then `done with open checks`: the coordinator's wake and the finish webhook's handoff list the items and ask the coordinator to continue the job, start a review, or accept each item with a reason. A done that the coordinator asked for with `limen stop <id> "done: <reason>"` writes no `open-checks`.

**Project reminders.** A project can name rules that every job must follow. Write them in `.agents/limen/reminders.md` and commit the file:

```markdown
- Every database migration has a down step.
- The staging database resets each night.
```

Limen adds the file to the first prompt and to the check before the finish, and the steer line asks the agent to record a changed reminder by reference in its note. The agent follows each binding reminder and does not copy the reminders into its note. Its "Note check" reports each binding reminder as followed, broken or not proven. When the file is absent or empty, no injection mentions reminders. Limen reads the file in the project root, so an edit applies to the next prompt, steer or check.

**How to measure, after about one week.** Compare the jobs that started before the start time with the jobs that started after it:

1. The share of finishes that report each end check and the easy-to-miss rule (each 🔴 point in an earlier note).
2. The end checks that were changed or dropped, and whether each names the instruction that changed it.
3. The reviewer FAIL rate.
4. The steers and `limen continue` runs for each job.
5. The share of notes written in the first turns of the job.

Read these files in each `.limen/jobs/<id>/`: `note.md` (the note at the end), `note.first.md` (its first version), `log` (the `note changed`, `note check sent` and `steered:` lines with their times, and the tool lines before the first `note changed`), and `result` (the final message with its "Note check"). `started-at` gives the start of the job, `role` marks a reviewer, and `parent` marks a continued job.

## Documentation

| Topic | Guide |
| --- | --- |
| Setup, models, skills, and project files | [Setup](docs/setup.md) |
| Jobs, reviews, continuation, and recovery | [Jobs](docs/jobs.md) |
| CLI commands and options | [Command reference](docs/commands.md) |
| Code structure, features, and journeys | [Picture](docs/picture.md) |
| Several teams on one feature | [Team groups](docs/groups.md) |
| Remote jobs and GitHub requests | [Remote seats](docs/remote.md) |
| Run Pi on another machine | [Host pool](docs/hosts.md) |
| Job and coordinator event webhooks | [Finish webhooks](docs/finish-webhooks.md) |
| Pane status and job status | [Herdr status](docs/herdr-status.md) |
| Optional Linear mirror | [Linear](templates/linear.md) |

See [Contributing](CONTRIBUTING.md) for development and checks.
