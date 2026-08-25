# F037-continue-record-parity · Continue writes a complete job record and follows spawn's Herdr default

[2026-08-25] [🟠] [ACTIVE] [COORDINATOR] ACTIVE · F037-continue-record-parity

## Outcome

`limen continue` is a first-class sibling of `limen spawn`. A workspace continue still diffs the child repository. A failed launch leaves a finished record, not a half-written `failed` with no `finished-at`. In Herdr, continue opens an interactive tab unless `--detached` is passed.

## Scope

- When the parent record has `repo`, the child gets the same `repo` file. `limen jobs` then diffs that Git child, not the workspace directory.
- Launch failure goes through `finalizeJob` the way `spawn` already does (terminal state, `finished-at`, leftover tmp sweep, tab settle).
- `LIMEN_PREFLIGHT=auth` runs `pi auth check` before any record is written — the same F026 gate spawn has, with the resolved model. A continue that cannot authenticate refuses; it does not leave a failed record.
- In Herdr, continue is hosted by default; `--detached` keeps today's wrapper; `--tab` forces hosted and refuses without Herdr. Hosted continue starts pi with `--continue` against the seeded child session dir — same seed rule F034 already landed, not a pointer at the parent transcript.
- The hosted path reuses spawn's `startHosted` (export it, or lift it — do not photocopy), varying only the task argument: `--continue <instruction>` in place of `@task.md`, mirroring `runInternalJob`'s `LIMEN_CONTINUE` branch. Same `hosted` note file, same supervisor launch, same recovered-agent fallback.
- Detailed `limen jobs <id>` names `parent` when that file exists.
- `--label` / session-id checks stay the same rules as spawn. Do not invent a third copy if one function in `spawn.ts` can serve both commands (already the pattern for `makeJobId` / `waitForHandshake`).
- Extend the job-file table test in `test/structure.test.ts` to continue: it writes the fields spawn writes (`repo` and `hosted` included) plus `parent`, and `jobs` reads `parent`. Photocopy drift is how this ticket's bug got in; the table is the guard.

## Out of scope

- Continuing a job that is still running (type into the tab, or `steer`). F034 already refused that.
- Copying `candidate` or `hosted` from the parent. A continued reviewer stays opt-in `--review` and is still not independent.
- Automatic chaining, transcript editing, or a shared `text()` helper.
- Changing prune, wake routing, or how `--session-dir` is seeded.

## Acceptance

- Workspace fixture: spawn `--repo api`, let it finish, `continue` from the workspace root. Child record has `repo` = `api`. `limen jobs <child>` diffs `api`, not the parent directory.
- Wrapper/supervisor launch throw: child `state` is `failed`, `finished-at` is present, no stray `.tmp` in the job dir.
- In a fake-Herdr environment, `continue` without flags writes `hosted` and starts the hosted path; `continue --detached` stays a log-tail wrapper with `--continue`.
- `limen jobs <child>` detailed view includes a `parent` line.
- Existing F034 refusals (running parent, pruned worktree) still refuse without writing a record.
- `npm run check` green.

## Notes

Found in the 2026-08-25 source review. `src/commands/continue.ts` photocopies spawn's job-file writes and misses `repo`. Launch catch writes `state=failed` and rethrows — no `finalizeJob`. There is no hosted path at all, so a Herdr continue is a detached worker even though spawn in the same conversation would have been a tab.

F034's out-of-scope line ("hosted sessions that are still open") is about a live tab, not about continuing a finished hosted job. This ticket is that follow-up.

Verify first, not last: the hosted path assumes interactive pi accepts `--continue <instruction>` the way `--mode json` does (`runInternalJob` relies on it; the fake-pi suite cannot prove it). One manual pi run against a seeded session dir settles it before any code moves. If interactive pi refuses, stop and bring the design question back — do not improvise a tab that replays `@task.md`.

Process-control adjacent (launch + hosted start). Fresh reviewer if the hosted path is in the diff; record-only `repo` + finalize is cheap enough to merge after a coordinator read.
