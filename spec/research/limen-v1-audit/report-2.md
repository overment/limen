The pinned runtime is not ready to call v1.0-stable: isolated probes reproduced destructive spawn interference, shared-checkout continuations, stale Herdr control targets, and conflicting terminal outcomes.

The deciding tradeoff is not files versus a workflow engine. Files remain a good fit, but creation, ownership and finalization need a few atomic boundaries. Human-readable labels and tab locations must not double as process identity.

## Evidence surfaces

- **Limen implementation:** revision `5a00065c92d86cd2039149273095e4e470898418`, cloned into `/tmp/limen-runtime-audit.s79R5Y/limen`. Limen citations below refer to that revision.
- **Herdr upstream:** `https://github.com/herdrdev/herdr.git`, revision `6c52aad511b0fb601e6223bd6ad944f48cbdba6d`.
- **Installed Herdr:** `/opt/homebrew/bin/herdr`, version `0.8.2`. Fetched its skill and help. A scratch-socket probe established **client protocol 20**; upstream declares **protocol 22** (`Herdr src/protocol/wire.rs:20`). These are not interchangeable implementations.
- **Planning evidence:** the supplied worktree’s read-only `spec/build.md`, consulted separately from the pinned implementation.

## New findings

### 1. High — simultaneous spawns can delete each other’s worktrees before either creates a record

**Trigger:** two spawns overlap between worktree creation and job-record publication. Explicit prune can intersect the same gap.

Spawn creates the worktree, automatically prunes, reads its HEAD, and only then creates the job directory (`src/commands/spawn.ts:104–120`). Each prune protects its caller’s worktree and recorded live jobs, not another spawn’s unpublished checkout. It force-removes the other eligible worktrees (`src/commands/prune.ts:12–48`; `src/git.ts:65–66`).

**Reproduction:** two actual Limen CLI processes against one scratch Git repository, with a Git shim synchronizing their prune snapshots. Both exited 1 with:

> `git is not on PATH`

`/usr/bin/git` existed. No job records remained; both new worktrees were gone.

The error is misleading: Git’s wrapper classifies an `ENOENT` caused by a missing **cwd** as a missing executable (`src/git.ts:97–108`). This reproduces the reported symptoms without a third spawn. It does **not** establish the historical interleaving of the live incident.

There is a second exposed interval: prune deletes any stateless job directory immediately, while spawn writes state only after record population and `--prepare` (`src/commands/prune.ts:25–29`; `src/commands/spawn.ts:121–157`).

**Small correction:** serialize checkout reservation/publication against prune, or stop automatically deleting unpublished/stateless resources. Publish evidence before destructive housekeeping. Keep missing-cwd and missing-executable diagnostics distinct.

### 2. High — continuing the same finished parent twice runs two writers in one checkout

**Trigger:** issue another `continue <parent>` while an earlier continuation of that parent is running. Simultaneous invocation is unnecessary.

Continue checks that the **parent** is terminal and its worktree exists, then launches another job in that worktree. It never checks whether a child or another job already owns it (`src/commands/continue.ts:53–81,110–150`). Ordinary spawn at least checks live branch use (`src/commands/spawn.ts:259–269`).

**Reproduction:** two sequential continuations both returned success. Both child records said `running` and contained exactly the same worktree path.

This permits competing edits and commits while presenting separate jobs. The existing continuation refusal test covers a running parent, not a running sibling continuation (`test/continue-command.test.ts:94–112`).

**Small correction:** use the same atomic repository/check­out ownership boundary for spawn and continue. Preserve the explicitly non-independent `continue --review` behavior; that is a different contract.

### 3. High — pane relocation repairs supervision but leaves open/close targeting the old tab

**Trigger:** move a job pane out of its original tab, especially after adding another pane there.

The supervisor updates `herdr/agent` and `herdr/pane` after relocation, but leaves `herdr/tab` and `herdr/workspace` unchanged (`src/supervisor.ts:76–83`). Open focuses the recorded tab, and finalization closes it (`src/herdr.ts:277–285,322–331`). Neither checks its current occupants.

**Reproduction with a fake Herdr adapter:** relocate `w1:p1` to `w2:p2`, retaining an unrelated occupant in `w1:t1`. Limen recorded the new pane but retained the old tab/workspace. `open` reported success while sending `tab focus w1:t1`; completion sent `tab close w1:t1`.

Upstream confirms that moves preserve the terminal, can change the tab without changing the pane ID, and change public pane IDs across workspaces (`Herdr src/app/api/panes.rs:3129–3242,3292–3340`). Closing a tab removes its terminals, not just Limen’s former occupant (`Herdr src/app/api/tabs.rs:217–285`).

Actual unrelated-terminal shutdown was **not** exercised; the wrong control commands were reproduced safely.

**Small correction:** retain the returned terminal identity and full current place. Resolve the owned terminal before control. Close only the owned pane when the tab has other occupants.

### 4. High impact, uncommon trigger — stop trusts a recycled process-group ID

**Trigger:** an unfinished record retains a PID after its original owner dies, and that PID becomes another process-group leader.

Stop reads the PID, discovers descendants and signals the group without comparing the recorded `born` identity. Its later KILL also lacks that comparison (`src/commands/stop.ts:37–49`). Birth checks exist in reaper liveness and escaped-descendant cleanup, but do not protect this group signal (`src/reap.ts:19–23`; `src/contain.ts:80–107`).

**Reproduction:** planted a stale scratch record pointing at a separately spawned fixture process group with a deliberately different birth value. Stop returned success and killed that unrelated fixture process.

This simulates the state after PID reuse; it does not claim natural OS PID recycling was observed. The accompanying `liveJob` probe returned true, so this run does not demonstrate successful reaper birth validation.

**Small correction:** verify the recorded owner identity before both TERM and KILL. An unavailable identity should produce an explicit unconfirmed-stop result, not permission to signal an arbitrary group.

### 5. Medium — finalization is sequentially idempotent, not safe against competing writers

**Trigger:** wrapper completion, stop or reaper finalization overlap.

`finalizeJob` checks state once, then performs several awaited operations before writing terminal state. Two callers can both pass the initial check (`src/wrapper.ts:183–190`).

**Reproduction:** two processes finalized one scratch record, synchronized after the state check through their Git-log calls. Both exited 0. The log contained:

```text
failed: failed contender
done: done contender
```

Final state was `done`. Thus a completed failure can be replaced by a competing success, with two terminal stories available to observers.

**Small correction:** make finalization a single-winner operation. Atomic replacement of individual files does not make this multi-file transition atomic.

### 6. Medium — a recovered hosted session can retain its old answer and old error

**Trigger:** a stall snapshots a result or error, the agent resumes successfully, and supervision later captures its final transcript.

Stall handling calls `writeHostedResult`. Recovery clears advisory markers but not the captured result or stop reason (`src/supervisor.ts:209–236`). Capture preserves any existing result and writes a stop reason only when the newest reason is nonempty (`src/supervisor.ts:262–267`).

**Reproduction:** capture an interim answer with `error: temporary`, append a successful final answer, capture again. Files still contained:

```text
result: interim summary
stop-reason: error: temporary
```

The supervisor subsequently uses that stale error to choose `failed` (`src/supervisor.ts:99–103`). Existing tests cover recovery before the first capture and preserving a tool-written result, not recovery after a stall snapshot (`test/hosted-spawn.test.ts:23–43`).

**Small correction:** distinguish an explicit finish handoff from an advisory snapshot. Refresh fallback snapshots and remove obsolete fallback stop reasons.

### 7. Medium — log and diff launch arguments cross an unquoted shell-text boundary

**Trigger:** repository/log paths contain spaces, or a path/branch contains shell metacharacters.

Limen passes separate arguments to `herdr pane run` (`src/herdr.ts:318,411–412`). Herdr joins them with spaces and submits the resulting shell text; it is not an argv-preserving execution API (`Herdr src/cli/pane.rs:1047–1060`).

**Installed-CLI reproduction:** pointed Herdr 0.8.2 exclusively at a scratch Unix socket. The captured request contained:

```text
tail -n +1 /tmp/.../has spaces/log
```

Executing that captured command in an isolated shell failed because tail received two paths. The fixture file itself existed. No Herdr tab was created.

**Small correction:** encode one correctly quoted shell command for `pane run`, or use an argv-preserving upstream API if supplied. Do not apply that encoding to `agent start`, whose argument contract is different.

### 8. Medium cost — detached streaming launches Git for every message update

Every `message_update` becomes an activity event (`src/stream.ts:108`). Every activity event writes/fsyncs activity, runs `git status`, and writes/fsyncs the changed-file count—even when activity has not changed (`src/wrapper.ts:215–218,228–231`).

**Reproduction:** a fake Pi emitted one `agent_start` and 50 `message_update` events. The actual detached wrapper launched **51 `git status --porcelain` calls**.

This is a demonstrated amplification factor, not a measurement of live Pi’s event rate or the coordinator CPU problem.

**Small correction:** coalesce unchanged activity and sample changed files at tool boundaries or a bounded cadence, rather than text-delta frequency.

## Herdr API and handoff improvements

- **Preserve observations instead of discarding identity.** Herdr’s `AgentInfo` already returns `terminal_id`, name, workspace, tab, pane and readiness (`Herdr src/api/schema/agents.rs:186–223`). Limen reduces this to a status or target string. Upstream’s own agent waits pin the terminal when names are reused (`Herdr tests/cli/agents.rs:1294–1382`). Exact identity is safer than Limen’s name-prefix recovery or “foreground node means Pi” fallback (`src/herdr.ts:145–169`).

- **Do not key role spaces solely by display label.** `ensureWorkspace` matches `${basename(cwd)} ${role}s` and otherwise performs list-then-create (`src/herdr.ts:437–449`). Different roots with the same basename co-locate; concurrent first-use calls can create duplicates. These are source-derived risks, not live reproductions. Keep readable labels, but associate reuse with canonical root and role; an upstream atomic ensure operation would remove the creation race.

- **Avoid paying twice for observation.** Healthy supervision executes one Herdr CLI every second; relocation repeats `agent get` before listing agents, and stalled supervision republishes metadata every loop (`src/supervisor.ts:64–106,215–225`; `src/herdr.ts:145–150`). Upstream CLI calls also perform a protocol-status request before their requested operation (`Herdr src/cli.rs:762–795`). The installed scratch-socket probe likewise observed ping plus the operation. Cache a full observation per pass and publish metadata only when its displayed value changes.

- **Treat focus removal as a compatibility change, not a proven installed fix.** Limen focuses every hosted tab before start and conditionally restores afterward (`src/herdr.ts:62–125`). Upstream explicitly tests background start without stealing focus (`Herdr tests/cli/agents.rs:63–139`). I did not verify that behavior against the installed server. Upstream `tab focus` already switches workspace and tab, making the preceding workspace-focus call redundant there (`Herdr src/app/api/tabs.rs:133–141`).

## Known work, not newly discovered scope

The board already names hosted-start ownership (F048), unusable-route preflight/argument transport (F081), and Claude execution (F074) as active; owner-truth recovery (F049) and history retirement (F086) are planned (`spec/build.md:13–24`).

Relevant implementation gaps remain:

- **Hosted-start ownership:** tab creation still happens in the caller before supervisor launch, with synchronous Herdr calls defaulting to 180 seconds (`src/commands/spawn.ts:214–245`; `src/herdr.ts:464–465`). This belongs beside F048, not a duplicate finding.
- **Owner-truth recovery:** reaper skips malformed/missing-PID running records indefinitely and does not adopt supervisors. Its hosted fallback checks only the stored target, not relocation (`src/reap.ts:8–17,25–53`). Transport uncertainty is treated as alive (`src/herdr.ts:134–146,202–229`). These are F049 handoff cases.
- **Remote containment:** process identity uses a Darwin-specific Ruby helper; the tests explicitly expect identity to be unavailable elsewhere (`src/contain.ts:114–125`; `src/proc-pidinfo.rb:22–29`; `test/stop-command.test.ts:252–266`). Linux containment parity was not demonstrated.
- **History retirement:** the destructive unpublished-worktree race above is separate from F086’s finished-record retention policy.

## Checks, coverage and uncertainty

Read all `src/*.ts`, `src/commands/*.ts`, the process-identity helper, their corresponding tests, and matching Herdr launch, identity, layout, control and CLI implementations/tests. Hooks, prompts and Pi wake delivery remain the other researcher’s ownership. Herdr upstream was not built.

Targeted command `node --test test/job.test.ts test/stream.test.ts` passed **8/8**. The broader runtime attempt was interrupted after roughly 301 seconds: **24 passed, 3 failed, 17 cancelled**. The three failures were scratch jobs not reaching `done` within test deadlines; they are not attributed here to a specific defect. No full-lane pass is claimed, and no full rerun followed the coordinator’s instruction.

Reproduction scripts and raw outputs remain under `/tmp/limen-runtime-audit.s79R5Y/`: `reproduce.ts`, `reproduce-herdr.ts`, `finalize-race.ts`, and `installed-cli-fixture.mjs`. All used isolated fixtures. No real cabinet, live experimental tab, production source, board, commit or report file was changed.
