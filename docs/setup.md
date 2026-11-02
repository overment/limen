# Setup

[README](../README.md) · [Command reference](commands.md)

Install Limen, define the project, and ask an agent to do the work.

## Requirements

- **Operating system:** macOS or Linux. Limen does not support Windows.
- **Tools:** Node.js 24 or later, and Git.
- **Engine:** Pi (`pi`, the default) or OMP (`omp`) on `PATH`.
- **Last known-good versions:** pi 1.2.0, omp 18.4.4 and Herdr 0.9.1. Limen records the versions on each job, but it does not refuse other versions.

## Install

### 1. Install Limen

You do this part, one time:

```bash
git clone https://github.com/overment/limen.git
cd limen
npm install
npm link
```

For interactive jobs in Herdr, install the integration for each engine you use:

```bash
herdr integration install pi
herdr integration install omp
```

`npm link` puts that clone on `PATH`. The binary reads `hook/` and `templates/` from the directory next to it. Projects do not copy those files, so when you update the clone, every project on that computer gets the update. After `git pull` on the clone, `/reload` the coordinator.

### 2. Start each project

Open a terminal in the project's Git repository. Before you start a worker, the repository must have at least one commit.

```bash
cd /path/to/your-project
limen init
```

Before you assign work, define these two files:

- `spec/vision.md`: what the product should do, for whom, and within what scope.
- `.agents/limen/styleguide.md`: how to write and organize the code.

Start Pi in that directory with `pi`, or open an agent tab in Herdr with the project as its working directory. Describe the task to the agent in plain language, for example:

> Add a settings page. Follow the project vision and coding styleguide.

You can also ask the agent to help define the vision and styleguide before it changes code. Set the worker and reviewer model choices with the agent in `spec/build.md` (see [Models](#models)).

### What `limen init` does

- **Project files:** It creates the files that the project owns: the vision, the board, the feature lanes, and the styleguide (see [Project files](#project-files)). It does not overwrite existing project files.
- **Hook stubs:** It creates package-hook stubs in `.pi/extensions/` and `.omp/extensions/`. A Herdr coordinator needs its engine's stub for communication, wake, and steering, so in an existing project, run `limen init` again before you start one.
- **Old hook copies:** It deletes old `limen-*.ts` hook copies in both extension directories, so that they cannot load next to the stubs.
- **Leftover prompts:** `limen init --drop-leftovers` deletes only prompt copies that are still the same as the package.

### The coordinator session

The agent you talk to is the coordinator. Give it the task in plain language. It manages Limen jobs and reports the results in that session.

**Roles**

- Ordinary `limen spawn` starts workers and reviewers. It does not start a coordinator.
- Team groups have separate lead and hook requirements. Follow the [group setup](groups.md#prepare-and-start) before you use `limen group start`.

**Herdr layout**

- Use a Herdr space with the name of the plant (`limen`, or `alice limen`). Do not use a space with the name `workers` only.
- The coordinator gives its own tab the name of one stable subject (`chat settings`). Limen adds ` · N running` to that name while its jobs run.
- Worker tabs get their names from spawn labels (see [Job IDs and labels](jobs.md#job-ids-and-labels)).
- The inherited shop manual (`templates/agents.md`) has the same layout rules. A project `AGENTS.md` replaces it.

### Project skills

Put project skills in `.agents/skills/<name>/SKILL.md`. Each engine finds skills in these places:

| Location | Found by |
|---|---|
| `.agents/skills/<name>/SKILL.md` | All engines |
| `.omp/skills/<name>/SKILL.md` | OMP |
| `.pi/skills/<name>/SKILL.md` | Pi |
| `.pi/skills/<name>.md` (older flat files) | Pi |

**Old Pi skills in OMP jobs.** For OMP jobs, Limen makes a per-job view of old Pi skills outside the worktree. Limen gives that view to OMP as a skill directory. When two skills have the same name, the skill in `.agents/skills` or `.omp/skills` wins over the old copy. This applies to workers, reviewers, and continuations in both launch modes. It also applies to jobs in a repository next to a non-Git coordinator workspace.

The next launch finds new or changed old skills, so the plant needs no links that you keep by hand. Pi finds skills the same way as before.

## Models

Use this reference when you need to set model choices or run commands yourself.

Project choices are in `spec/build.md`. The board records the engine, provider, model, and reasoning level for each role, and who reviews. The coordinator reads those choices and passes them to the CLI as command flags. The CLI selects settings from flags, environment variables, and package defaults. A newer explicit instruction from the owner has priority over the board. Replace the placeholders in the commands with the project choices.

### Package fallbacks

The coordinator must pass the board choices explicitly. Package fallbacks apply when command flags and environment variables do not select a setting.

**Engine.** `--engine pi|omp|devin` selects the job's agent: the Pi or OMP binary on the seat, or a Devin cloud session (see [Devin cloud jobs](#devin-cloud-jobs)). The order of priority is:

1. `--engine pi|omp|devin`
2. `LIMEN_ENGINE` (for example, `LIMEN_ENGINE=omp` selects OMP)
3. Pi, for new jobs, when neither is set

Two exceptions apply:

- Old job records without an engine stay on Pi, for compatibility.
- A continuation keeps the engine of its parent. `limen continue` refuses a different `--engine`, so to continue a Pi transcript, you still need Pi.

**Model.** The order of priority is:

1. `--model`
2. `LIMEN_WORKER_MODEL` (or `LIMEN_REVIEWER_MODEL` for `--review`)
3. the built-in `openai-codex/gpt-6-astra:high`

A Devin job takes only `--model`: it names a Devin mode, and without it the organization's default mode runs.

**`pi-claude` on both engines.** A `pi-claude` model runs on the Claude Code bridge, which Limen names with `--extension`, because jobs otherwise start with `--no-extensions`. Pi loads the `pi-claude-bridge` package that `pi install` put under `~/.pi/agent/npm/node_modules` (scoped or not), and takes `--provider pi-claude --model claude-opus-5-5` or `--model pi-claude/claude-opus-5-5` as given. Current bridge releases register the Pi provider as `claude-bridge`; Pi treats `--provider claude-bridge` (or `claude-bridge/<model>`) the same way. OMP loads the local bridge at `~/.omp/local/pi-claude-bridge` and has no `pi-claude` provider: a command that requires `--provider` takes `--provider pi-claude`, and Limen keeps it in the job record and off the OMP command line, so `--provider pi-claude --model claude-opus-5-5` means `--model pi-claude/claude-opus-5-5`. `spawn`, `continue` and `group start` refuse a missing bridge before any job exists. On OMP they also refuse a `pi-claude` provider with another provider's model. With `LIMEN_PREFLIGHT=auth`, a bridged route skips `pi auth check`, because the bridge signs in through Claude Code.

**Auth.** Pi and OMP keep separate auth stores (`~/.pi` and `~/.omp`). Authenticate each engine you use. Limen does not change the settings or credentials of either engine. One wrapper and one stream parser serve both engines.

### Personal model routes and Pi extensions

An owner can describe an approved model route in their active personal coordinator instructions or a session handoff: the request name, exact engine/provider/model/thinking choices, and trusted local extension paths. Keep personal paths outside shared project Git. Limen does not parse aliases, scan installed packages, or choose a route from installation alone; the one package it looks up is the `pi-claude` bridge above, by its fixed name. Resolve conflicts with project policy before launching; do not silently substitute an engine, provider or model.

For a Pi worker, pass each selected path explicitly:

```text
limen spawn --engine pi --provider <provider> --model <model> --thinking <level> \
  --extension /path/to/trusted-entry.ts --label "what this changes" "instruction"
```

`--extension` accepts local files and package directories in both hosted and detached modes. Limen does not install or import them; Pi loads them. A directory can expose several extensions and other package resources, so prefer the exact entry file when that is the intended selection. Ambient extensions stay disabled. See [command details](commands.md#start-and-continue-jobs) for path rules and continuation replacement.

Extensions run with the worker process's permissions and can read files, credentials and session data. Path validation does not prove API compatibility, provider availability, instruction forwarding or successful inference. Keep installation, native model-catalog registration and a successful worker check as separate claims. The optional `LIMEN_PREFLIGHT=auth` check does not load session extensions and can reject an extension-only provider; Limen does not bypass it. For native Pi groups, the owner selects common or team-only extensions at `group start`; members inherit the fixed team lists. See [group selection](groups.md#prepare-and-start). Ordinary selections do not automatically propagate to GitHub launches, picture jobs or native subagents.

### Start a coordinator in a Herdr pane

To start a coordinator in an existing Herdr pane, use a shell prompt with the project as the working directory:

```bash
herdr agent start limen-peer --kind <engine> --pane <pane-id> -- \
  --provider <provider> --model <model> --thinking <level>
```

Herdr sends on the arguments after `--`, but Herdr does not select the model for Limen. Do not depend on old Pi project settings or a global default model.

### Start a worker

For an ordinary worker:

```bash
limen spawn --engine <engine> \
  --provider <provider> --model <model> --thinking <level> \
  --label "what this changes · FNNN" 'Implement FNNN: <outcome>. Ticket: spec/features/active/FNNN-slug/ticket.md'
```

This job is detached, also in Herdr: a log-tail tab, a 90-minute timeout (change it with `--timeout`), a tool-call cap and process containment. Use `--tab` when a person will type into the worker. In both modes, `--provider`, `--model`, and `--thinking` go to the selected engine as separate flag and value pairs. `limen continue` accepts the same flags.

### Devin cloud jobs

`--engine devin` runs the job's agent as a Devin cloud session on Devin's own virtual machine, macOS or Linux. The job's folder, branch and worktree stay on the seat, so `jobs`, `wait`, `diff` and `land` work as for any job.

```bash
limen spawn --engine devin --provider macos --model normal \
  --label "what this changes · FNNN" 'Implement FNNN: <outcome>. Ticket: spec/features/active/FNNN-slug/ticket.md'
```

- **Flags.** `--provider` is the Devin platform, `macos` or `linux`. `--model` is the Devin mode (`normal`, `fast`, `lite`, `ultra`, …), sent as `devin_mode`. Either one, when omitted, falls to the organization's default. Spawn refuses `--thinking`, `--tab` and `--extension`; `limen continue` and group teams refuse the engine. `LIMEN_DEVIN_ACU_LIMIT=<n>` caps the session at `n` ACUs (`max_acu_limit`).
- **Start.** The job pushes its branch with `git push origin <branch>`; a failed push fails the job with git's reason. Then it creates a session for the `owner/repo` that the `origin` URL names, so Devin needs access to that repository. The prompt is the role preamble, the task, and a fixed contract: start from the pushed branch, commit there, push with `git push origin <branch>` only (no force-push, no pull request), reply with the handoff and stop.
- **While it runs.** The job folder records the session in `devin-session` (its id) and `devin-url`. The log holds both, each status change, and every message Devin writes; Limen polls about every 30 seconds.
- **End.** When the session waits for the user or reports finished, Limen fetches the branch and fast-forwards the worktree with `git merge --ff-only FETCH_HEAD`, writes Devin's last message as the result, and ends the job `done`. A branch that does not fast-forward, such as rewritten history, fails the job and leaves the worktree unchanged. A session that suspends (inactivity, quota, an error), exits early or errors fails the job and names the reason. `limen stop` and the job timeout terminate the session. A finished session stays in Devin waiting for the user, and sleeps on its own.
- **Credentials.** `DEVIN_API_KEY` and `DEVIN_ORG_ID` when set; otherwise the Devin CLI login: the key in `~/.local/share/devin/credentials.toml` and the org id that `devin cloud drs whoami` prints (sign in with `devin auth login`). `DEVIN_API_URL` changes the API host from `https://api.devin.ai`. The key goes only into the Authorization header of each request, never into a log, a job file or the prompt.
- **The pushed branch stays on origin.** Delete it after you land or drop the job: `git push origin --delete <branch>`.

## Adjacent-repository workspaces

A parent directory that is not a Git repository can hold several independent Git repositories as children.

1. Run `limen workspace init` one time in the parent.
2. List the children in `spec/workspace.md`.
3. Tell the coordinator which repository the work is for.

The coordinator gives exactly one `--repo` to each job. Tickets stay in the parent. Branches, worktrees, diffs, and review stay in the selected child.

## Project files

The installed `limen` package supplies the default shop manual, role prompts, speech register, and hooks. `limen init` creates only the files that the project owns:

```text
.agents/limen/styleguide.md           project coding practice
spec/vision.md                        durable product intent
spec/build.md                         TRACK / NOW / NEXT / PROVEN; NOW and PROVEN generated from the lanes
spec/features/                        planned, active, done, and dropped work
.pi/extensions/limen.ts               Pi stub: load hooks from the package
.omp/extensions/limen.ts              OMP stub: load the same hooks
.limen/jobs/<id>/                     runtime evidence
```

### Overlays

Optional overlays replace a package default, one file at a time:

- `AGENTS.md`
- `.agents/limen/worker.md`
- `.agents/limen/reviewer.md`
- `.agents/limen/communication.md`

| File | Name | What happens |
|---|---|---|
| Same bytes as the package | Old copy | The coordinator names it. |
| Different bytes | Overlay | You can keep it, drop it, or edit it. **Never overwrite an overlay.** |

### Hooks

The communication hook puts the capability frame, the shop manual, the speech register, the vision, and the styleguide in the system prompt for each model call. The capability frame (`templates/capability.md`) tells every role that engineering time is abundant and the owner's attention is scarce; it comes from the package even when a project replaces the register. The board digest comes last, so a change to NOW or NEXT does not break the cached prefix.

A short note on each turn recalls the capability frame in one sentence and names the audience and the reply rules. The wake cue is in that note, not in the system prompt. After a write or an edit, the tool result repeats the rule that applies.

Every job also keeps a task note, checked once before the finish, and a project can add `.agents/limen/reminders.md` for every job. The [task-note experiment](../README.md#task-note-experiment-started-2026-10-22) describes both.
