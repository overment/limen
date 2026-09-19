The reports diverged on whether to change liveness/prune behavior or only name existing boundaries, and report 1’s `string | "unknown" | undefined` adds no type safety.

They agree the runtime is already locally inspectable: four phases, `state` as the observer commit point, job files as truth, one `derivePulse`, inform-don’t-gate, no status machine, no wake split, no helper bag. Structure tests and the 4160-line `src/` cap are constraints, not proof of good boundaries.

**What they disagreed on**

- **Next repair.** Report 1: import cycle, lying `locateHostedAgent` comment, worker preamble, pulse comment, duplicate git retry. Report 2: three liveness predicates, unread `last-turn-tools`, README `done` paths, prune of empty `state`, shrink filename-`includes` tests. Overlap is comments and docs. Conflict is whether prune, pulse, or `born` should change runtime.
- **Locate type.** `locateHostedAgent` is declared `string | undefined` and documented “Undefined means genuinely gone,” but with `concrete === true` it returns `"unknown"` (`src/herdr.ts`). `"unknown"` is already a `string`; `if (located)` still treats uncertainty as a live target. The only `concrete=true` caller already branches on `=== "unknown"` (`src/recovery.ts`). JSDoc (and a direct test) is the fix. A tagged union is cost at the cap.
- **Prune guard.** Report 2: skip directories that have `task.md` or `started-at`. That contradicts `test/prune-command.test.ts` “prune deletes a job directory with no state,” which writes `task.md` and expects deletion. Spawn creates the worktree, prunes, then `mkdir`s the job dir, writes files, runs prepare (up to five minutes), then writes `state` (`src/commands/spawn.ts`). A `task.md` guard misses the worktree-only interval and would keep the half-written leftovers that test wants gone. The coordinator concurrent `git is not on PATH` is an observation, not a cause: `src/git.ts` maps every `spawnSync` ENOENT to that string, including a missing cwd.
- **`born` in display/steer.** Report 2 optionally wires pulse/steer through `wrapperAlive`. That is a behavior change. Recycled-PID display is hypothetical; steer already fails `steer/ready` if the owner is gone. Do not wire.
- **Ceremony tests.** Report 2 wants to drop spawn/continue/jobs filename `includes`. Report 1 treats them as a reason not to extract a writer. That is a policy change, not a cleanup. Leave the table; do not raise 4160.

**Ranked cleanups (benefit / cost / risk)**

1. **Worker preamble vs runtime (docs drift).** `templates/worker.md` says “Detached (default)”; `templates/agents.md` and `src/commands/spawn.ts` (`tab = parsed.detached ? false : parsed.tab || herdr`) host in Herdr unless `--detached`. README is incomplete, not the same claim. HOSTED_NOTE / shop-manual still say “no F007 process containment.”
   **Preserve:** hosted `finish` (`hook/hosted.ts`); detached timeout/cap/containment; closing a hosted tab still ends the agent.
   **Tests:** history-hash check in `test/structure.test.ts`; hosted finish and detached containment tests unchanged. Worker line becomes “Detached (`--detached`)”; HOSTED_NOTE names process-group containment of escaped descendants, not a bare feature number.

2. **README `done` terminals (docs drift).** Supervisor can finalize `done` for hosted session ended, hosted agent ended (tab gone), clean idle close, or `done:` stop (`src/supervisor.ts`, `src/wrapper.ts` `requestedTerminal`). README names Pi exited 0 or a hosted session ended. `land` accepts any `done` job with commits.
   **Preserve:** tab-close remains `done: hosted agent ended` until an owner call — that is product, not clarity (`test/hosted-spawn.test.ts`). Vision already says a tab is not the job and a closed tab is not proof; changing tab-close to `stopped` is a separate decision, not this slice.
   **Tests:** existing tab-close and clean-idle tests.

3. **`locateHostedAgent` JSDoc plus a direct `"unknown"` test (comment lie).**
   **Preserve:** cached status for visibility; recovery uses a fresh probe; reap does not finalize when target is `"unknown"`.
   **Tests:** existing recovery unknown/list-outage waits; add `locateHostedAgent(target, name, true) === "unknown"`. Do not change the return type to `string | "unknown" | undefined`.

4. **Move `hostedAgentName` to `src/job.ts` (maintenance debt).** `src/recovery.ts` imports it from `src/commands/spawn.ts`, closing spawn → reap → recovery → spawn, and pulling planning/Herdr/prune into recovery for an eight-line namer. `job.ts` has no `node:` imports; the namer is pure. `continue.ts` currently imports it from spawn — the extra import must be paid.
   **Preserve:** fallback name matches `agent-name` at spawn/continue; `makeJobId` stays in spawn (`node:crypto`).
   **Tests:** `test/hosted-spawn.test.ts` `hostedAgentName` cases (update the import); recovery uncertain/missing paths. Net `src/` lines ≤ 4160.

5. **Delete the duplicate git ENOENT `run` (maintenance debt; pays the cap).** `src/git.ts` runs `gitBin || "git"` twice, then PATH fallbacks.
   **Preserve:** `--no-optional-locks` status does not refresh the index (`test/git-status.test.ts`); existing “git missing from PATH falls back or leaves no job dir” (`test/spawn-command.test.ts`). This is not the concurrent-start fix.

6. **Comment on `pulseOf` in `hook/wake.ts` (maintainability; outside the cap).** Footer liveness is the owner pid so the 500ms sweep does not call Herdr. Jobs uses agent-not-missing **or** supervisor pid (`src/commands/jobs.ts`). Shop manual: footer is a hint.
   **Preserve:** jobs must not use `agentStatus === "working"` as pulse (`test/structure.test.ts`, `test/jobs-command.test.ts`). Do not add `hostedAgentStatus` to wake.

**Leave / reject**

- `last-turn-tools`: hook-only write; supervisor stall keys off `tool-calls`. Dead write, not a bug. Deleting is test churn (`test/hosted-hook.test.ts`). Comment later if a hook slice is already open.
- Split `hook/wake.ts` / `src/herdr.ts`; unify wake/steer claims; `writeJobFiles` / Status / `starting` phase; shared `text()`; `--review` forces `--detached`; `src/files.ts` to break wrapper↔contain/finish-webhook cycles; raise 4160; F090.
- Dropping the filename-`includes` table: explicit policy if the owner wants tests retargeted at records; do not do it as a cleanup. `finalizeJob`’s one-shot is tested for a second writer and stop-vs-wrapper (`test/finalize.test.ts`); that is not a lock for every race — do not “fix” it.

**Needs reproduction (possible bug, not a clarity slice)**

Concurrent spawn vs prune: worktree exists before the job dir; empty `state` during prepare is indistinguishable from garbage; `liveJob` requires `state === "running"`, so startup grace does not apply. Discriminating test: two overlapping `limen spawn`s (slow `LIMEN_PREPARE` optional); both job dirs and worktrees remain; a half-written dir with `task.md` and no `started-at` still goes (`test/prune-command.test.ts`). If ENOENT appears, assert the message names a missing cwd when the worktree is gone — today’s string cannot. Do not skip every `task.md` dir. Do not add a `starting` phase. A coherent fix, if the test fails, is: write `started-at` (and intended worktree path) before `executeWorktree`; prune keeps dirs whose `started-at` is within `STARTUP_GRACE_MS` even without `state`, and keeps that worktree; true leftovers without recent `started-at` still delete.

**Checks run.** Read the reports, coordinator notes, vision, board, and cited sources at `a1ebcf2` (`git show` / `git grep`). Counted `src/` at 4160. Did not run the test suite. Working tree `f98cbf1` only files this research.
