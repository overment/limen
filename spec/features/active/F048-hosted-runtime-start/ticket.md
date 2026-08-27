# F048-hosted-runtime-start · The hosted runtime starts its own agent

[2026-08-27] [🟠] [ACTIVE] [COORDINATOR] ACTIVE · F048-hosted-runtime-start

One law, already true for detached jobs: spawn plants the record and launches the runtime; the runtime starts pi and owns the job to its terminal state. Hosted jobs violate it — `startHosted` starts pi inline inside the caller's process, blocking up to ~125s in `waitForShell` + `herdr agent start --timeout 120000`. Any caller deadline (a coordinator's Bash tool timeout) kills spawn mid-start. Herdr still brings the worker up, but nothing after `startHostedPi` runs: no `herdr/agent`, no supervisor, no `pid`, no focus restore. The job stays `running` forever with no one to advise, finalize, or reap it. Sequenced with F049 before F013.

## Outcome

`limen spawn --tab` (and hosted `limen continue`) prints the job ID within seconds and exits. The detached supervisor starts pi in the recorded pane, records the agent, and owns the job to its terminal state. Killing the spawn process after the ID prints changes nothing about the job's lifecycle. A hosted start that genuinely fails records `failed` and delivers a wake like any other terminal state.

## Scope

- `startHosted` keeps only fast caller work: create the tab, persist the start contract, launch the detached supervisor, observe its bounded PID handshake, and return the ID. Nothing in spawn waits for a shell, focuses a tab, or starts an agent. Herdr refusing tab creation remains a synchronous spawn error and finalizes the planted record; after the supervisor launches, lifecycle errors belong to the supervisor and the job record.
- The supervisor has an explicit initial-start phase before its existing watch loop: `waitForShell` → focus the recorded job tab → `herdr agent start` (keep F044's one pane-shell retry) → write `herdr/agent` → restore focus per F033. It reads the coordinator tab from `origin-tab`, never the supervisor's environment. F049 adoption enters the watch loop directly and must not run this phase again.
- Readiness honesty: use a short, configurable-for-tests `agent start` timeout. On timeout/error, `locateHostedAgent` probes the recorded pane; a visible pi on that pane is a started worker. The current exception recovery becomes part of the one supervisor path; the 120s wait for an "idle" readiness that a busy worker never signals is gone.
- The start contract crosses the process boundary like the detached wrapper's: `LIMEN_JOB_DIR`, `LIMEN_WORKTREE`, `LIMEN_TASK_FILE`, `LIMEN_PREAMBLE` (a file path), model, role, agent name, and an explicit initial-start marker. Persist role and agent name with the hosted record so F049 can reconstruct watch-only supervision. Hosted continue writes its instruction to a durable `continue` file beside `task.md`; the supervisor passes that file's contents to `--continue`, never an inline caller argument.
- The supervisor writes its own PID handshake before the start phase. Spawn returns only after that PID is observable, but this is the only wait and is bounded in seconds. A caller killed any time after supervisor launch cannot take ownership back or strand the job.
- Stop honesty covers the whole start window. The supervisor checks `stop-requested` before each start step and again before entering the watch loop; if pi appeared meanwhile, it uses the normal hosted stop path. It finalizes `stopped` with the recorded reason rather than launching after a stop or leaving the record running.
- A start that fails after the retry finalizes `failed: hosted start failed: …` from the supervisor — durable and wake-delivered, not thrown into a caller that may already be gone.
- Delete, don't preserve: the duplicated recover-and-relaunch block in `startHosted`'s catch, the spawn-side focus dance, and every spawn-side path that starts an agent. One start path afterward; no flag and no fallback to the old shape.
- Update the hosted-start sentence in `templates/agents.md`: spawn returns the ID quickly; the runtime focuses, starts, and restores moments later.

## Out of scope

- Wake routing, advisory, or delivered-slot protocol changes (F030/F027/F042 ride on this unchanged — they become reliable, not different).
- Adopting jobs whose supervisor later dies (F049).
- The detached wrapper path, Herdr behavior, or worker prompts.

## Acceptance

- A fake Herdr start that remains busy beyond a 20s caller deadline cannot hold `limen spawn --tab`: the ID and supervisor PID are recorded first. Killing the caller immediately after observing the ID does not prevent `herdr/agent`, a later idle advisory, or terminal finalization. This replays and survives the live 2026-08-27 failure.
- `pid` names the live supervisor before successful hosted spawn and continue return. A start failure after supervisor launch is asynchronous: the already-returned job becomes `failed: hosted start failed: …` and its subscribed wake is eligible.
- `limen stop` both before pi starts and while Herdr is resolving start records `stopped` with the requested reason; it neither starts pi afterward nor leaves a live hosted agent unowned.
- Herdr refusing tab creation still makes spawn exit nonzero and finalizes `failed` (F026 spirit). An agent that cannot start after F044's retry finalizes `failed` from the supervisor.
- Hosted continue reads the durable `continue` file after the caller is gone and still passes `--continue`; ordinary hosted spawn still passes `@task.md`.
- F032 pane-follow, F033 focus-restore, F035 tab-close, F037 continue-parity, and F044 retry tests pass with their mechanisms relocated and semantics unchanged.

## Notes

Live evidence, alice-app coordinator session `01a03b51`, 2026-08-26/27: 13 of 13 hosted spawns ended `Command timed out` (caller timeouts 20–120s; even 120s lost to the ~125s block by ~5s). Six workers (f345–f350) finished their surveys and sat idle 25 minutes with records saying `running` until the human typed "check on the workers"; four wave-2 jobs orphaned the same way minutes later. The coordinator had adapted to symptoms it couldn't name: `herdr tab focus "$HERDR_TAB_ID"` prefixes (stolen focus never restored) and a `timeout 20s` wrapper (absent on macOS, exit 127).
