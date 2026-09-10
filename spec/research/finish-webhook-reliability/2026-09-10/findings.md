# Finish-webhook failures: sender, opt-in, and receiver

The reported Grok Bot `[unauthenticated] Error` most likely belongs to the receiver routine, not a rejected Limen Authorization header. A manual Alice finish ping at the reported time was accepted with HTTP 200. The receiver run ID and failed step are unavailable, so this is a strong temporal correlation, not a proven match. Two independent delivery gaps are established locally: absent project opt-in and a reproducible Node/PATH exit 127.

## The 10:30 Warsaw signal

The Alice web-search timeout job (`2026-09-10-f719-2026-09-10---openrouter-web-4ea22796`) invoked the home launcher at `2026-09-10T08:30:27.877Z` (10:30:27 Warsaw). Its payload label was `openrouter-websearch-timeout`, with literal status `done`; the command did not specify `TONY_FINISH_WEBHOOK_ENV`. The tool result one second later contains exactly `finish webhook: accepted (HTTP 200)`, not `[unauthenticated]`. The job reached durable `done` at 08:31:19 UTC and has no automatic config, attempt, or receipt files.

This establishes an accepted manual request near the failure notification. It does not establish the inherited environment, a matching receiver run, or successful bot execution. `isError: false` is only the outer tool status; no separately captured helper exit was found for this invocation. Source event addresses and job branch are in `correlation-1030.json`.

A bounded scan of nine September 10 Alice job-session files (16.4 MB) found six literal manual helper invocations: five report HTTP 200, one has no classified HTTP result. None of those session tool results contains `[unauthenticated]`. This is a lower bound: the scanner does not recognize dynamically assembled commands or sends outside these sessions. The API has no September 10 job sessions. See `today-pings.json` and its scanner.

## Failure classes

| Class | Evidence and ownership |
|---|---|
| Receiver routine authentication | Leading explanation for the 10:30 alert: the contemporaneous request was HTTP 200, while the operator reports a failed Grok routine. Inspect the matching run's failed step; webhook ingress credentials and provider/account credentials are different. No receiver auth repair is proven or attempted. |
| Project opt-in | At 08:52 UTC, Alice app, Alice API, and canonical Limen all lack `.limen/finish-webhook.env`. All nine September 10 app jobs and this Limen job lack automatic config snapshots and attempts. Automatic silence is expected, not an HTTP failure. |
| Manual sender runtime / ops PATH | The installed home launcher exactly matches the documented three-line wrapper, and its canonical target exists, is executable, and matches the checkout. No-argument invocation with the inherited PATH reaches usage (exit 1, no send); `/usr/bin:/bin` instead produces missing-Node exit 127. Node 24.1.0 is installed under NVM, not `/usr/bin` or `/usr/local/bin`. This reproduces a mechanism for the historical exit 127, not its original environment. |
| Automatic sender runtime | A new test starts Limen through its absolute Node executable but supplies an unusable child `node` on PATH. Before repair, finalization records `sender exited 127`; after prepending Limen's runtime directory it records HTTP-only acceptance and exactly one intercepted request. |
| Wrong header / HTTP 401 or 403 | The current private home config is mode 600, single-target, with valid HTTPS and complete Bearer syntax. Values were not printed. Synthetic tests verify the exact header in memory, rejection of malformed auth before transport, and nonzero exits for 401/403. Valid syntax does not prove a credential is current. No local live 401/403 was found in this bounded scan. |
| Timeout / network / partial fan-out | Existing synthetic tests reproduce failure and timeout, concurrent second-target delivery despite first-target failure, aggregate failure after partial acceptance, and bounded automatic shutdown. No live multi-target config or live timeout was observed here. Automatic `sender exited 1` discards per-target detail and cannot identify auth failure on its own. |
| Wake not observed | Local `jobs.sqlite` has zero jobs/tasks/wakes/runs/fires. Accessible `sessions.sqlite` has 125 sessions and 1,244 undeleted turns, with no matches for the reported routine, probe label, or `[unauthenticated]`. These stores do not expose the remote Grok routine; absence here does not prove nobody woke elsewhere. |

## Checks and evidence

- Baseline: 70 focused tests passed before changes. This did not reproduce the remote Grok error.
- Discriminating runtime regression: failed with `sender exited 127` before the fix; passed after it, with exactly one intercepted request and unchanged `done` state.
- Candidate: 73 focused tests passed. The added auth-boundary check supplies a synthetic `[unauthenticated] Error` body under HTTP 200/401/403, verifies status-only reporting and the exact Bearer header, and rejects reading or leaking response text. It does not simulate or prove a completed bot turn.
- Lockfile install: `npm ci` succeeded, 0 vulnerabilities; npm warned about the existing user setting `min-release-age`. Scoped Biome check: three changed TypeScript files checked, no fixes needed.

Evidence is retained outside the worktree at `/Users/overment/.overment/limen/tmp/evidence/finish-webhook-failures/9766a0a7/`. `local-metadata.json`, `correlation-1030.json`, `today-pings.json`, and `receiver-before.json` contain sanitized observations; adjacent scripts reproduce the bounded scans. `baseline.log`, `runtime-red.log`, `runtime-green.log`, `focused.log`, and `install.log` retain real outputs. Prior context remains in `alice-finish-reliability-notes.md` and the earlier `tmp/evidence/F702b/1d77c03b/` directory.

## Full native lane and controlled finish ping

At clean candidate `5783a88`, `npm run check` completed in 770 seconds: TypeScript passed, Biome checked 73 files without changes, and 360/361 tests passed. The sole failure was the source-line budget: 3,642 lines against a 3,641 cap. Removing the new explanatory comment from `src/finish-webhook.ts` restored the budget without changing behavior or raising the cap. The subsequent scoped structure and runtime regression checks both passed (2/2), and scoped Biome passed. The full native lane was not rerun after this comment-only correction. See `native-candidate-commit`, `native-result.json`, `native-check.log`, and `final-scoped.log`.

The one authorized final request ran at `2026-09-10T09:14:17.816Z` through `~/.overment/tony-finish-ping.sh`, using `{job: "limen-webhook-reliability", status: "done", branch: "limen/2026-09-10-2026-09-10-limen-webhook-reliabi-9766a0a7"}`. Immediately before sending, this job still had no automatic selection, attempt, or receipt. The launcher and installed canonical sender matched the inspected files; the controlled environment supplied the installed Node directory without network tracing or a config override.

The helper exited **0** and printed **`finish webhook: accepted (HTTP 200)`** at 09:14:18 UTC. No unexpected output was suppressed. **Owner wake remains unobserved.** The immediate read-only local-store check still has no matching probe turn; it is not remote Grok history and cannot establish the receiver's eventual outcome. The full payload, timestamps, actual exit, and HTTP-only result are in `live-ping.json`; `live-ping-attempt.json` prevents accidental replay by the evidence script. Do not rerun the ping to compensate for missing receiver visibility.

No private config, receiver credential, Alice checkout, or tab was changed by this diagnosis. No VPS check or remote receiver repair was performed.
