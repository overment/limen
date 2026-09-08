# Automatic terminal finish delivery (F702)

Candidate scope: shared terminal/config wiring, lifecycle tests, worker/coordinator fallback reminders, README link, and exact delivery-record inspection docs. This commit sits on the helper peer's inspected commit `5b7cf1e0147d58db9ce47839a951a514a9037837`, which supplies `bin/tony-finish-ping.sh` and the standalone setup docs. The canonical helper owns HTTP, Bearer validation, JSON encoding, and private env loading. This slice never reads credentials or records helper output.

## Integration contract

- `src/commands/spawn.ts` snapshots only an absolute path in the private-mode job file `finish-webhook-env`. Explicit `TONY_FINISH_WEBHOOK_ENV` resolves against the spawn cwd; an explicitly empty value disables opt-in. Otherwise use the primary Git worktree's `.limen/finish-webhook.env`, or the non-Git workspace coordinator's equivalent. No home lookup. Worktree-local decoys are ignored.
- `src/commands/continue.ts` inherits the parent's path or its absence, never the continuation caller's environment. A fresh `spawn --branch` selects configuration at spawn as usual.
- `src/wrapper.ts` finalizes both detached and hosted jobs. After terminal state and pid cleanup, `src/finish-webhook.ts` executes the package-relative canonical sender with exactly `<label> <state> <branch>` and the snapshotted path in `TONY_FINISH_WEBHOOK_ENV`.
- `finish-webhook-attempt` is an exclusive, flushed claim. Never reclaim it automatically: HTTP acceptance followed by a crash is ambiguous. A later finalizer cannot double-send. A crash before a claim can leave terminal state without an attempt; inspect and retry deliberately, not through finalization.
- `finish-webhook` holds `attempting`, `accepted`, or `failed` plus timestamps and manual retry guidance. `log` carries safe status summaries visible through `limen jobs <id>`. Sender stdout/stderr are discarded. `accepted` means sender exit 0, not an observed owner wake. No coordinator notification/subscriber files change.
- The sender process group has a 3000ms cap, shortened to the detached wrapper's remaining termination grace with a 500ms reserve. If no budget remains, record not sent. No daemon, queue, retry command, extra runtime dependency, or installed/home changes.

## Deliberate retry

Inspect terminal `state`, `finish-webhook`, and `finish-webhook-attempt` after the finalizer has settled. An interrupted attempt may already have sent. From the installed Limen package, with `job` set to the absolute job directory:

```sh
TONY_FINISH_WEBHOOK_ENV="$(tr -d '\n' < "$job/finish-webhook-env")" \
  bin/tony-finish-ping.sh "$(tr -d '\n' < "$job/label")" \
  "$(tr -d '\n' < "$job/state")" "$(tr -d '\n' < "$job/branch")"
```

Only use the recorded opt-in, or an explicitly authorized private config when automation was absent. A manual invocation does not rewrite the automatic receipt. Record its actual result in the handoff; do not print config. Routine workers omit manual sends because finalization handles configured jobs.

## Evidence and next worker

Retained output: `/Users/overment/.overment/limen/tmp/evidence/F702/delivery-00dbd938/`. The synthetic lifecycle test copies this candidate's runtime into a temporary package with a fake canonical executable; it cannot call the real sender or inherit live `TONY_*`, `LIMEN_*`, `PI_*`, or `HERDR_*` configuration.

The first test runs exposed missing fixture hook files, a Node entrypoint extension mistake, and macOS `/var` vs `/private/var` path expectations. The exhaustion regression then found a real bug: commit recording can consume over three seconds of the five-second termination grace, so a separate fixed three-second send timeout was unsafe. `focused-repair.tap` preserves the failure with terminal state followed only by `attempting`; `exhaustion-repair.tap` proves the remaining-budget correction. One leaked synthetic sender group from that failed fixture was killed; synthetic hang fixtures now have their own 15-second backstop.

The architecture line ceiling is adjusted for this slice and 44 lines of already-present workspace runtime above the prior ceiling (baseline 3557; candidate 3641). The helper peer updates the architecture test's exact `bin` listing; both changes are combined here.

Before helper integration, the focused lifecycle/finalization lane passed 19/19 (`focused-final.tap`) and typecheck passed. Peer evidence is copied under `helper-retained/`: 38 focused helper tests passed; its broader candidate check had 59 pass / 1 pre-existing source-budget fail. The peer's clean-commit `npm run check` passed TypeScript and Biome but was killed at 420 seconds without a suite summary; it reported failures in continuation refusal and two Hunk/Herdr diff tests before timeout. Those failures are not attributed or repaired here. The coordinator explicitly requested no repeat full-suite run; combined helper/lifecycle/structure and typecheck are the final relevant checks, with actual results retained separately.

The combined focused run passed all 50 helper/lifecycle tests and 21/22 structure checks; the sole failure was stale shipped hashes for the changed worker/coordinator templates. The prescribed history generator passed 3/3 tests and updated only those two histories. Final structure/typecheck results are retained separately. Installation docs preserve the legacy home command as a thin exec wrapper with an explicit legacy config default; automatic delivery invokes the canonical package helper directly and never uses that wrapper. No home change was performed.

Coordinator owns installation and live end-to-end acceptance. This worker's separately authorized final ping is not evidence that this uninstalled automatic path reached the real owner. Adam reviews; no reviewer spawn. Existing dirty installed-source jobs/workspace tests remain untouched.
