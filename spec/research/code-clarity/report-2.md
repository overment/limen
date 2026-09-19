Limen is already locally inspectable: four phases, `state` as the commit point, job files as truth. The remaining opacity is split liveness predicates, two writers of the same files on hosted vs detached, and tests that lock source shape. Name the existing invariants; do not add states, validators, or a job-file schema.

**Tradeoff.** Process safety, notification ownership, and recovery already work because they refuse to guess (uncertain Herdr waits; wake claims are separate from `state`; `finalizeJob` is one-shot). Unifying those into a status machine or registry would hide the questions they answer. The cheap win is making those questions obvious at the call site and retargeting ceremony tests at observable records.

**Source.** Repository at `a1ebcf2`. Files read through: `src/` (job, recovery, reap, supervisor, wrapper, contain, finish-*, herdr, git, stream, view, lookup, main, commands spawn/stop/continue/jobs/steer/wait/watch/sweep/land/prune), `hook/` (wake, hosted, steering, inherit, seat, communication), named tests (reaper, recovery, finalize, hosted-*, wake-*, job, stream, spawn, jobs, stop, steer, finish-webhook, structure), `README.md`, `spec/vision.md`, `spec/build.md`, `.agents/limen/styleguide.md`. No test suite was run.

## Strengths

- **`state` is the observer commit point.** `finalizeJob` returns if already terminal, writes the log line, then flips `state` (`src/wrapper.ts:188-191`). Tests prove one finished-at and one terminal line under stop vs wrapper races (`test/finalize.test.ts`).
- **Four phases, no hidden workflow state.** `parseJob` is a discriminated union (`src/job.ts:1-51`). Unknown bytes stay on disk; `limen jobs` reports INVALID and does not rewrite (`test/jobs-command.test.ts`).
- **Recovery refuses to kill on uncertainty.** Cached Herdr status is for visibility; recovery uses a fresh probe (`src/recovery.ts:51-54`, `src/herdr.ts:218-225`). Competing sweeps replace a dead supervisor once and never restart the agent (`test/recovery.test.ts`).
- **Notifications do not own the job.** Wake claims live under `notify/`; a missed wake does not change `state`. Fallback, two unconfirmed attempts, and error-turns-not-counting are tested (`test/wake-hook.test.ts`, `test/wake-sweep.test.ts`). Finish webhooks never reclaim after a crash (`src/finish-webhook.ts:24-31`).
- **Process identity is checked, not just the PID.** Recycled groups cannot fake life when `born` mismatches (`test/reaper.test.ts`). Escaped descendants are snapshotted before TERM (`test/stop-command.test.ts`).
- **Hosted weaker guarantees are explicit** (`src/commands/spawn.ts:51-52`). Pulse is one function (`src/job.ts:derivePulse`), imported by wake and jobs.

## Findings

**1. Three liveness questions, two implementations.** Maintainability, not a demonstrated bug.

`liveJob` / `ownerAlive` / `wrapperAlive` consult `born` (`src/reap.ts:9-33`). Display and steer do not: jobs uses `processGroupAlive(job.pid)` (`src/commands/jobs.ts:151-155`); wake’s footer pulse does the same (`hook/wake.ts:675-683`); steer refuses only if the process group is gone (`src/commands/steer.ts:31-32`). Missing `born` is treated as alive (`src/reap.ts:24, 30`; `src/wrapper.ts:249-251` writes `born` in the background).

- **Cost.** “Is this job live?” has no single local answer. A recycled PID can look running in the footer while the reaper is confirming death.
- **Smallest correction.** A short comment above `liveJob` naming the three questions (cabinet liveness, owner identity, display pulse). Optionally have pulse/steer use `wrapperAlive` when `born` exists. Do not invent a Status type.
- **Regression risk.** Low if comments only. Wiring pulse through `born` must keep “running with no pid is starting” (`test/jobs-command.test.ts`, `test/job.test.ts`).
- **Discriminating test.** Already present for the reaper (`test/reaper.test.ts` recycled pgids). Missing: jobs/steer must not treat a live recycled PID with mismatched `born` as the job.

**2. Hosted and detached write the same names differently.** Maintainability. The split is intentional (no JSON stream on hosted).

Detached: wrapper `atomicWrite`s `activity`, `tool-calls`, `changed-files` from the stream (`src/wrapper.ts:216-239`). Hosted: the hook `writeFileSync`s `activity` / `last-tool` / `tool-calls` / `last-turn-tools` / `session-ended` (`hook/hosted.ts:71-76, 116-143`) and never writes `changed-files`. Supervisor idle logic reads `tool-calls`, not `last-turn-tools` (`src/supervisor.ts:208-211`). Claude uses the wrapper stream, no steering extension, no session transcript (`src/wrapper.ts:81-91`; continue refuses it).

- **Cost.** Stall and “produced nothing” depend on files whose writer depends on the path. `last-turn-tools` is written and tested as a write, then ignored.
- **Smallest correction.** Stop writing `last-turn-tools`, or document that it is hook-only diagnostics. Do not merge hosted and detached into one supervisor class.
- **Regression risk.** Low for deleting an unread file. High if hosted activity is moved into the supervisor (loses in-turn updates while Pi is busy).
- **Discriminating test.** Hosted stall still keys off `tool-calls` when `last-turn-tools` is `0` (`test/hosted-spawn.test.ts` idle advisory). Hosted `jobs` omits live file counts — no test today.

**3. Hosted `done` is four exits; README names two.** Docs / product semantics. Current behavior is tested, not a silent bug.

Supervisor finalizes `done` unless stop was requested or the last assistant stop-reason is error/aborted (`src/supervisor.ts:106-113`). Reasons: `hosted session ended`, `hosted agent ended` (tab gone, `src/herdr.ts:138-141`), `closed a clean idle session` (`src/supervisor.ts:208`), or `stop` with a `done:` prefix (`src/wrapper.ts:188`). README says `done` means Pi exited 0 or a hosted session ended (`README.md:75`). Tab-close is tested as `done: hosted agent ended` (`test/hosted-spawn.test.ts`). `land` accepts any `done` job with commits (`src/commands/land.ts:16-26`).

- **Cost.** A closed tab with commits looks mergeable. Clean idle close is a third success path coordinators must inspect, not trust.
- **Smallest correction.** Extend the README sentence with the four hosted terminals. Do not change tab-close to `stopped` without an owner call — that test encodes today’s product.
- **Regression risk.** Doc-only is none. Changing tab-close would break the hosted-spawn close test and land’s `done` gate.
- **Discriminating test.** Existing tab-close and clean-idle tests. Missing: land must still refuse a tab-closed job if that becomes the rule.

**4. Empty `state` means both “spawn in flight” and “garbage.”** Race in source; not a failing test.

Spawn writes `started-at` / `task.md` / `notify/ready`, runs prepare (default 5 minutes), then writes `state` (`src/commands/spawn.ts:128-168`). Every spawn prunes first (`src/commands/spawn.ts:125`). Prune deletes any job directory whose `state` reads empty (`src/commands/prune.ts:25-29`). `textFile` maps every read error to `""` (`src/wrapper.ts:243-247`). Prepare failure is logged and spawn continues (`src/commands/spawn.ts:373-378`).

- **Cost.** Overlapping spawn with a slow prepare can delete the first job’s record. Empty-state orphans and in-flight spawns are indistinguishable.
- **Smallest correction.** Prune skip directories that already have `task.md` or `started-at`. Do not add a `starting` phase.
- **Regression risk.** Low: true empty leftovers still go. Do not fail spawn on prepare without deciding that prepare is a gate (styleguide: inform, do not gate).
- **Discriminating test.** Slow `LIMEN_PREPARE` plus concurrent `limen prune` / second spawn; first job dir still present. Prepare-failure-still-starts is a coverage gap, not a known defect.

**5. Some tests lock source shape instead of records.** Test ceremony.

`test/structure.test.ts:18-24` is a line budget. `test/structure.test.ts:84-105` asserts spawn/continue/jobs source strings `include` filenames. `test/structure.test.ts:79-95` asserts `derivePulse` import regex. Styleguide wants tests that exercise real Git and files (`.agents/limen/styleguide.md`). Spawn already writes a canonical record and asserts the files (`test/spawn-command.test.ts`).

- **Cost.** Harmless edits (rename, split, stop mentioning a filename) fail CI. The table does not catch hosted skipping `changed-files` or continue skipping `engine`.
- **Smallest correction.** Keep unique basenames, empty `dependencies`, no `index.ts`/`types.ts`/`utils.ts`. Drop or shrink the filename-`includes` table. Keep behavioral record tests.
- **Regression risk.** Low if the spawn/jobs file assertions stay.
- **Discriminating test.** Existing spawn canonical-record test. The structure table would still pass if hosted never wrote `tool-calls`.

## Tempting abstractions to reject

- A job Status machine or file-schema validator. `jobs` already surfaces INVALID; vision forbids hidden workflow gates.
- Unifying `liveJob` / `ownerAlive` / pulse / `hostedAgentAlive`. They answer cabinet liveness, owner identity, display, and Herdr presence.
- One supervisor class for hosted and detached. Hosted has no timeout, cap, or containment on purpose.
- A `starting` phase. No-pid running already renders `starting`.
- A shared `textFile` / helper bag. Styleguide prefers duplication.
- Splitting `hook/wake.ts` for size. Delivery is one job; the sweep tests are the spec.
- Counting wake errors toward the attempt ceiling. That change is parked (`spec/build.md` F090).

## Coverage gaps

Not demonstrated bugs: prune vs in-flight spawn; prepare failure; `last-turn-tools` unread; hosted `changed-files` absence; jobs/steer vs `born`; Linux `born` unavailable (reaper already treats that as group-check-only).

Not read in full: `src/commands/{init,diff,open,close,linear,ticket-author}.ts`, `hook/speak.ts`, and several command tests (land, prune, continue, communication, inherit).

**Checks run.** None. Read-only survey at `a1ebcf2`.
