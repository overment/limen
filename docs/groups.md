# Collaborative feature groups

Groups are opt-in. One owner-facing lead starts a fixed roster of managed team coordinators pursuing the same feature through different approaches. Each coordinator has a total worker launch allowance. The lead remains the sole landing owner; group messages are informational data, not owner steering or permission to take over jobs.

Ordinary jobs keep their existing spawn, wake, steering and pruning behavior. A `group/` folder alone launches nothing. Groups use no runtime dependencies, database, remote transport, automatic merge, push or model fallback.

## Prepare and start

**Owner-facing lead = Herdr coordinator pane, not a limen job.** Open (or reload) the plant's interactive OMP/Pi coordinator with `LIMEN_COORDINATOR=1` and the candidate package hooks loaded. Existing project loader files that enumerate hooks must include `group-peer`, or load `hook/group-peer.ts` explicitly — `templates/limen-extension.ts` in this package already lists it. The lead hook registers its live session and process under `.limen/group-leads`. Pi passes `PI_SESSION_ID` to the lead's commands; OMP does not, so a command is recognized as the lead when that registered process is its ancestor. That ancestor check grants group authority only. Job wakes, `limen watch`, and `limen steer --running` from an OMP lead use its Herdr pane, as for any OMP coordinator.

Do **not** `limen spawn` a hosted "lead" job for this. Hosted jobs set `LIMEN_JOB=1`, so `group-peer` skips lead registration and `limen group start` refuses with guidance back to this pane. Managed team coordinators are created only by `group start`, never by ordinary spawn.

The lead registration is a heartbeat, not a pid file. `hook/group-peer.ts` refreshes `.limen/group-leads/SESSION` after each delivery sweep, about once a second. `group start` refuses a registration that the hook did not refresh in the last 30 seconds. Do not write that file by hand: a pane without the hook never receives group events. When a team coordinator finishes and the lead hook is not live, Limen prompts the lead pane through Herdr with the group status and the reload hint, so the lead still learns that the team finished. With a live hook, group events carry the finish and Herdr stays quiet. The project loaders that `limen init` writes (`.omp/extensions/limen.ts`, `.pi/extensions/limen.ts`) load `group-peer` with no skip, so a package without it fails at load time.

The default planning source is `committed`: commit the feature's `ticket.md`, `group/brief.md`, and `group/teams/team-1.md`, `team-2.md`, and so on for the requested team count. The brief states the shared outcome, constraints, distinct starting hypotheses and the lead's synthesis responsibility. Markdown is not executable configuration.

To keep group planning private, run `limen planning private` in the project root before activation. `limen planning` shows the setting stored in `.limen/planning-source`. `limen planning committed` restores the default for new runs. Each private packet file must be a readable file inside that root, also after symlinks resolve. A path that contains `..` or escapes the root fails before activation. Members receive absolute paths to the ticket, the brief, and their team note. They do not receive copies, and their task does not embed the private approach note. Jobs, their descendants, and their continuations keep the planning source recorded at spawn, even when the project setting changes. They read the vision and board in the canonical project root. Never copy, link, stage or commit private planning. Product-code Git checks, lead authority, and group limits do not change.

From the lead's tool, with the repository as its working directory:

```sh
limen group start spec/features/active/FNNN-name \
  --teams 2 --workers-per-team 2 \
  --timeout 30m --worker-timeout 20m \
  --engine omp --provider openai-codex --model gpt-6.1-sol \
  --thinking xhigh --worker-thinking high --detached
```

All machine settings and limits are required and recorded. `--provider` and `--model` are the default for every team; repeat `--team-model team-N=provider/model` to give a team its own model, for example `--team-model team-2=anthropic/claude-opus-5-5`. The engine and the two reasoning levels stay shared. `--detached` forces background members; `--tab` requires Herdr; omit both for the existing environment-dependent default. The final output line is the group ID. Activation selects the root from the feature and working directory, not an inherited `LIMEN_CONTEXT_ROOT`.

For Pi groups, repeat `--extension PATH` for trusted local extensions shared by every team, or `--team-extension team-N=PATH` for team-only additions. Common paths come first. Paths use the lead command's directory/home, resolve symlinks and deduplicate in first-seen order. Quote the whole `team-N=PATH` argument when it contains spaces; paths may contain `=`. All selections are checked before activation. OMP refuses these options. See [path rules and trust limits](commands.md#start-and-continue-jobs).

The run records complete effective `teamExtensions` lists, including empty lists. Coordinators, workers, authorized reviews and worker continuations inherit their team's list through the ordinary job record and loaders. Omit member `--extension` flags, or repeat the identical canonical list; a different list fails before consuming a launch slot. Continuation also checks the parent's list. Model flags remain explicit. Legacy runs without this map keep their prior spawn and continuation behavior; malformed maps are errors.

Repeating start returns the recorded run without changing its extensions, rechecking old extension targets, launching another roster or repairing missing members. Each actual member launch checks its extension targets again. Restore a missing target before launching; do not edit the run's selection. A partial launch failure, including a target disappearing after activation, retains the cabinet, started jobs and an `activation-error.json`. Inspect and stop that run before explicitly authorizing `group start … --new-run`. A prior live or uncertain member prevents a new run. A coordinator gets exactly one launch; coordinator continuation is unsupported.

## Work and publish

Every member receives its canonical root, group and team IDs, feature pointer and approach note. Its task also names the exact `limen` executable of the package that started the group, because a member's shell may put another installed Limen first on PATH, and the team's exact worker launch settings. Its **first tool action** publishes its own initial hypothesis, before reading peer findings or using other tools. This independence ordering is prompt guidance, not a new workflow phase.

Only a team coordinator launches that team's workers, through ordinary `limen spawn` with the recorded engine, provider, model and worker reasoning explicitly supplied. Worker continuations and separately authorized reviews each consume another total launch slot, even if their predecessor finished. Reviews require a candidate branch owned by that team. Exhaustion asks the lead; it never replenishes a run. Built-in helper agents do not bypass the allowance.

Members use one canonical `.limen/jobs/` cabinet while each new candidate has its own Git worktree. Worker continuation retains its own worktree and same-engine session in a new linked record, without erasing predecessor receipts. Group members can read any job with `limen jobs` and `limen diff`. They cannot stop, steer, continue, watch, or land another team's job. This is process isolation, not a hostile-code sandbox.

Publish compact evidence when an assumption changes, an approach is disproved, help is needed or a checked candidate is ready:

```sh
limen group publish 'Finding: stale revisions can conflict. Check: … Commit/artifact: … Uncertainty: …'
limen group publish --team team-2 'Question for team-2: …'
limen group wait
limen group wait --timeout 5s
limen group status
```

Members inherit verified membership and omit the group ID. The lead supplies it after the subcommand, for example `limen group status GROUP-ID` or `limen group publish GROUP-ID 'Lead checkpoint: …'`.

Publication writes only `.limen/groups/GROUP-ID/`, never the primary checkout's tracked packet. Member starts, terminal states and advisory changes are derived automatically from job records. An uncertain tool-stall observation stays in the job record for the operator and is not broadcast to peers. Peer updates attach to normal tool results; the lead also receives compact, agent-attributed custom messages. No manual `watch` or `steer` setup is needed. Group lifecycle replaces ordinary landing-oriented completion wakes; recorded seat and finish-webhook opt-ins are not repurposed as peer transports.

Coordinators remain inside their turn while children are live. When idle, re-enter `group wait` after a normal timeout until their assignment is complete, the group stops or their deadline expires. Each call lasts at most 20 seconds, including an actual CLI-process watchdog. If that watchdog cuts off an in-flight cabinet operation, inspect its uncertain receipt before deliberate recovery. Waits and acknowledgments publish no new events. A hosted coordinator with live children is not idle-closed; unread events alone never keep a finished worker alive.

The group has a fixed wall-clock deadline. Each worker's deadline is the shorter of its role budget and the group deadline minus a recorded 60-second coordinator wrap-up reserve. A launch with no remaining worker time is refused. Detached wrappers and hosted supervision enforce the recorded deadline; hosted jobs do not receive unsupported ordinary `spawn --timeout` flags.

## Delivery evidence

`limen group status GROUP-ID` shows the feature, local deadline and minutes left, stopped and closed flags, and one state row per member. A reserved member without a published job state reads `no job record yet`. Use `limen group status GROUP-ID --json` for the full run, roster-derived states, events and receipt evidence. Members omit `GROUP-ID` in both forms. Job records remain authoritative for job state.

Each event has one receipt per recipient. A receipt moves from queued to accepted, observed and processed. None of these states proves that a member agreed with or acted on the event. A receipt marked `uncertain` means a delivery was interrupted, so the event may or may not have reached its recipient. Inspect it before you act on it. Limen tries each recipient and event at most twice automatically.

One message carries at most eight events and 8,000 characters of published text. Omitted detail stays in the cabinet, and the message names its location. Processed events are not delivered again. A finished member keeps its unread events for a deliberate continuation; Limen does not respawn it.

When the cabinet is busy, routine sweeps skip it instead of failing the member. A later sweep publishes the updates. Group spawn and continue wait for a launch in progress to finish. They have no timeout, so a launch that never finishes needs inspection.

## Stop, recover and close

```sh
limen group stop GROUP-ID
limen group status GROUP-ID
limen group close GROUP-ID
```

Stop blocks new launches, waits for a launch in progress to finish, and then stops the group's members only. `stop-report.json` lists the processes that survived or that Limen cannot confirm stopped. Stop keeps branches, worktrees, findings and unread events. A coordinator that exits early is terminal; inspect that incomplete team's job records and surviving children. There is no automatic coordinator continuation or roster repair.

Every unclosed group's member worktree and job record is protected from ordinary automatic pruning, explicit `prune`, and `prune --retire`. Close refuses while any member is live/uncertain or any retained worktree is dirty. Refusal preserves all protection. Commit or recover dirty work deliberately; never force-delete it to make close succeed. Successful close releases clean member paths for ordinary pruning, but retains the group cabinet and publications.

Resume the original lead session to recover its subscription and bounded catch-up. A different session does not silently inherit lead authority. A command that prints `group lock busy or uncertain` names a cabinet lock. Read its `.lock/owner` before you recover the lock by hand. Limen recovers a lock whose owner died; it never evicts a live owner. An uncertain or interrupted recovery is evidence to inspect, not a reason to launch a replacement roster. Retained evidence is addressed by group ID, independently of the feature's current lane.

The lead puts selected findings and team summaries in the feature's `group/findings/` and writes `group/synthesis.md`. In committed mode, the lead commits them as an ordinary documentation change. In private mode, the lead keeps them in the canonical project root and does not stage or commit them. Moving the feature does not move or strand its live cabinet.

The lead lands through the spec keeper. After merging the team branches it keeps onto one integration branch, the lead starts one keeper for the feature ticket: `limen keeper <ticket> --group GROUP-ID --candidate <integration branch> --engine E --provider P --model M --thinking T`. `--group` lists every member job in the packet, so the keeper can read each transcript. The keeper refuses while a member runs and fixes ticket, board and map links on its own branch at the integration tip. The lead then lands the keeper job, which carries the integration and the fixes. Members cannot start a keeper or land.

## Reproducible proof setup

The real-agent proof is separate from native regressions. Prepare, but do not automatically launch, its disposable repository:

```sh
node /path/to/candidate/bin/limen-group-fixture.mjs /absolute/new/disposable/repository
```

The generator commits the shared job-summary task, deterministic acceptance checks and two approach notes, with no remote or finish webhook. It prints the exact interactive-lead setup and two-team/one-worker launch command. The task source intentionally does not exist yet; members implement it. No dependency install is needed for the fixture's native Node tests.

Follow `spec/features/active/F740-collaborative-groups/scenario.md`. Retain the candidate SHA, fixture path, command, engine/provider/model/reasoning, group/member IDs, candidate SHAs, real check output, finding/response event IDs and observed transcript excerpts. Each member's initial hypothesis must precede its first observed peer delivery. The lead must compare evidence and write synthesis, then prove stop and deliberate clean close. Queue acceptance or a clean worker exit is not a pass. Quota or engine failure preserves evidence without changing models. Detached proof does not establish hosted real-agent transport.

## How it works

You do not need these mechanics to run a group. They explain the evidence that status, receipts and errors show.

- **Cabinet:** the group's folder, `.limen/groups/GROUP-ID/`. It holds `run.json`, immutable event files and `receipts/RECIPIENT/EVENT.json`.
- **Occurrence:** one observed lifecycle transition. An unchanged advisory produces no new event, but the same advisory after an observed clear is a new occurrence. Limen records a pending occurrence before it publishes it. After an interruption, the next sync finishes that event and its missing recipient receipts before it observes the next value. It keeps receipts that are already accepted or processed.
- **Lock:** a `.lock` folder in the cabinet, so that one process at a time changes the cabinet. Its `owner` file holds the owner's PID. A command waits up to ten seconds for it, then fails with `group lock busy or uncertain`. Routine supervisor, hook and finalization sweeps skip a held lock. Unchanged state and advisory markers do not take the lifecycle lock; delivery and lifecycle publication share one hold when work is pending.
- **Inode-specific claim:** how Limen recovers the lock of a dead owner. It takes over only the same lock folder (same inode) that the dead owner held, so two recoveries cannot both win.
- **Launch lock:** a second lock that one launch holds while it publishes. Membership is claimed only after Limen takes this lock, so the allowance, stop and deadline checks run against the current roster. Spawn, continue, stop and close wait for it with no timeout. A dead owner is recovered as above; a stuck live owner is never evicted.
- **Launch fence:** the `stopped` flag in `run.json`. Stop sets it first, so no new launch starts while stop drains the launch lock.
- **Delivery claim:** a token and owner PID written into a receipt while one process delivers that event to that recipient. Claims run one at a time per recipient. Continuation inherits proven processing from its predecessor chain.
- **Lease:** the 30 seconds after a claim during which no other process retries it. After the lease, a dead owner's claim becomes retryable; a live owner is not displaced.
- **Transport acceptance:** the point at which the transport took the message: CLI output was produced, a tool or custom message was emitted, or the lead transport accepted the custom message.

The receipt states mean:

- **Queued:** durable event and recipient work, including a claimed delivery whose transport has not accepted it yet.
- **Accepted:** transport acceptance happened. This does not prove that a model consumed the message.
- **Observed:** `observedAt` records that the delivery token appeared in the hook's next model-context event.
- **Processed:** a non-errored assistant response followed that observed context. It does not prove agreement, adoption or successful collaboration.

A crash between transport and observation is ambiguous; delivery is not exactly once. Retained tokens, owners and `uncertain` receipts expose that ambiguity. The two automatic attempts count separately for each recipient. Receipt processing never publishes another event.
