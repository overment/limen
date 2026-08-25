# F037 review · `62aad1235f533586de7f78697796054876a925a1`

**PASS.** Checkout matches the named candidate. Continue is a spawn sibling for the scoped contracts: `repo` copy, `finalizeJob` on launch fail, `LIMEN_PREFLIGHT=auth` before any record, Herdr-default hosted via exported `startHosted` (`--continue <instruction>`, not `@task.md`), `jobs` names `parent`. F034 refusals still write nothing. F038/F040 do not break those paths.

No prior `review-*.md` in the feature folder (this is review-1).

## Scope vs code

| Ticket claim | What the candidate does |
|---|---|
| Child copies parent `repo` | `continue.ts` reads `${parentDir}/repo` and writes it; `jobs.ts` diffs `workspaceRepository(root, repo)` when present |
| Launch fail goes through `finalizeJob` | Detached catch calls `finalizeJob(jobDir, "failed", …)`. Hosted fail is `startHosted`'s existing catch (`finalizeJob` + tab settle + tmp sweep) |
| `LIMEN_PREFLIGHT=auth` before any record | `preflightPi(chosenModel)` runs after flag parse, before `resolveJob` / `mkdir` |
| Herdr default hosted; `--detached` wrapper; `--tab` requires Herdr | `hosted = detached ? false : tab \|\| herdr`; `--tab && !herdr` throws before a record |
| Reuse `startHosted`, only task argv changes | Exported from `spawn.ts`; `continueText` → `["--continue", instruction]` else `@task` |
| Seeded child session dir (F034 rule) | Unchanged: copy parent's newest `.jsonl` into `${jobDir}/session`; `startHosted` always passes `--session-dir ${jobDir}/session` |
| `jobs <id>` names `parent` | Reads `parent` and prints `  parent …` |
| Same `--label` / `PI_SESSION_ID` checks | `normalizeLabel` + `currentNotificationSession` from `spawn.ts` |

Interactive `--continue` (the ticket's "verify first" gate): pi **0.84.2** (`@earendil-works/pi-coding-agent`) treats `--continue` as a boolean (`dist/cli/args.js`) and takes the instruction as a positional message. `createSessionManager` calls `SessionManager.continueRecent(cwd, sessionDir)` before the interactive/print split. `InteractiveMode` gets `initialMessage` / `initialMessages`. Help example: `pi --continue "What did we discuss?"`. Same shape as `runInternalJob`'s `LIMEN_CONTINUE` branch. Not a live TUI against a seeded dir.

## Findings

No blocking defects.

1. **unverified (acceptance harness, not a candidate defect).** `npm run check` as written is not runnable in this worktree: no `node_modules`, `sh: tsc: command not found`. Cabinet `tsc --noEmit` against this tree: `TS2688 Cannot find type definition file for 'node'`. Did not `npm install`.
2. **proven environmental, non-blocking.** Full `node --test test/*.test.ts` inside this hosted review job failed `test/communication-hook.test.ts` because `LIMEN_CONTEXT_ROOT=/Users/overment/.overment/limen` (cabinet). `hook/communication.ts` uses `process.env.LIMEN_CONTEXT_ROOT ?? context.cwd`, so fixtures ingested the live board (`landed at 62aad12; hosted review in flight`). Unsetting that env → those tests pass. Not F037.
3. **plausible / out of blast radius, non-blocking.** `test/prune-command.test.ts`, `test/reaper.test.ts`, `test/stop-command.test.ts` also failed here (atomicWrite `ENOENT` on `state`/`finished-at` tmp rename; prune assertion at line 42). F037 does not touch prune/reaper/stop/`atomicWrite`. A same-sequence repro of prune's `spawn "other work"` returned status 0. Not charged to F037.
4. **non-blocking suggestion.** `test/hosted-spawn.test.ts` "continue in Herdr…" does not `waitForState` / write `session-ended`, so the hosted supervisor can outlive the test. Product path is still the shared `startHosted`.
5. **non-blocking suggestion.** Wrapper launch-throw finalize is a copy of spawn's catch; only hosted start-fail is tested. `--tab` without Herdr is untested (throws before `mkdir`). Auth test does not assert `--model` is forwarded; `preflightPi(chosenModel)` does.

Pre-existing, not reopened: `currentNotificationSession()` still runs after `mkdir` on continue (spawn runs it before). Unsafe `PI_SESSION_ID` can leave a half-written dir. Same F034 call site.

## Checks actually run

| Check | Result |
|---|---|
| `git rev-parse HEAD` | `62aad1235f533586de7f78697796054876a925a1` (matches task) |
| `git status` | clean |
| Read `ticket.md`, `continue.ts`, `spawn.ts` (`preflightPi`/`startHosted`), `jobs.ts`, `proc.ts` `finalizeJob`/`LIMEN_CONTINUE`, `herdr.ts` `startHostedPi`, F034 ticket seed note | contracts hold |
| pi 0.84.2 `dist/cli/args.js` + `dist/main.js` `--continue` | boolean flag + positional message; interactive uses it |
| `node --test test/continue-command.test.ts test/structure.test.ts` | 10/10 pass |
| `node --test --test-name-pattern 'continue in Herdr\|LIMEN_PREFLIGHT'` on hosted-spawn + spawn-command | 3/3 pass |
| Same F037 tests inside the full-suite run | all ✔ (workspace `repo`, `--detached` wrapper, auth no record, hosted start finalize, Herdr `--continue` not `@`, F034 refusals, job-file table) |
| Cabinet `biome check .` | pass (49 files) |
| `npm run check` | **unverified** — `tsc: command not found` |
| Cabinet `tsc --noEmit` | **unverified** — `TS2688` missing `@types/node` |
| Full `node --test test/*.test.ts` | fail (communication-hook via `LIMEN_CONTEXT_ROOT`; prune/reaper/stop). F037 tests still passed |
| communication-hook with `LIMEN_CONTEXT_ROOT` unset | pass |

F038/F040: pulse/`[control` only. Continue does not use migrate. No F037 break.

Candidate commit: 62aad1235f533586de7f78697796054876a925a1.
