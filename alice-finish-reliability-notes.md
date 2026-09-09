# Alice finish delivery: observed reliability and multi-bot boundary

## What the local evidence establishes

This scan covers job directories dated September 5–9, 2026 in `/Users/overment/playground/alice-app/alice/.limen/jobs` and `/Users/overment/playground/alice-app/api/.limen/jobs`. It also reads the earlier finish-delivery evidence under `/Users/overment/.overment/limen/tmp/evidence/F702/`. It does not contact a webhook, read credentials into output, modify either Alice checkout, or connect to a VPS.

| Local source | Observed result | What it does not prove |
|---|---|---|
| Alice app: 528 jobs (462 done, 44 stopped, 21 failed, 1 running) | Zero `finish-webhook-env`, `finish-webhook-attempt`, or `finish-webhook` files | Automatic webhook delivery was not opted in; absence is not a failed HTTP request |
| Alice API: 82 terminal jobs | Zero files of those same three kinds | No automatic bot notification evidence |
| Project config existence checks | `.limen/finish-webhook.env` absent in Alice app, Alice API, and canonical Limen | Installing sender code does not enable any project |
| Legacy home private config | Present; legacy URL/auth keys present; multi-target key absent (values never printed) | A home Tony destination does not select either Grok bot or opt a project into automation |
| Earlier landing record (`F702/landing.json`) | Mac manual `limen-finish-webhooks` request: HTTP 200, `ownerWakeObserved: false`, no projects enabled | No observed Tony/Grok turn; record explicitly says VPS pattern documented, not run |
| Earlier helper and finalizer workers' `authorized-finish-ping.log` | Two distinct manual invocations exited 0 with output suppressed | Their handoffs explicitly leave HTTP status and owner wake unobserved |

## Actual Alice manual invocations

The session scan searched all 157 app and 2 API job-session files dated September 8–9 (approximately 218 MB), deduplicating tool-call IDs copied by continuations. It found 13 app bash calls mentioning the helper; five match a literal helper invocation at a shell command boundary. No API invocation matched. This is a lower bound, not a census of requests: commands constructed dynamically or invoked outside these worker sessions are not included.

| Job suffix / source event | Tool result | Evidence class |
|---|---|---|
| `chat-motion-attach-polish-bc962f0e`, `af17be45` | `Tony finish ping exit=127` | Reported command failure; no send proven |
| `f699-legacy-mcp-connect-repair-1-d1ad5a12`, `6dcc678c` | `finish webhook: accepted (HTTP 200)` | HTTP acceptance only |
| `f705-refresh-sits-on-the-right-3c39f676`, `a7570664` | `success: true`, run UUID `73e8b5f2-964a-4998-928d-6ded6a8e4969` | Receiver returned a run ID; its completed bot turn was not available |
| `limen-steering-retro-bf1a34be`, `1308ea2e` | helper exit 0; recorded HTTP 200; `owner_response_observed: false`; no automatic records before send | Explicitly HTTP-only |
| `thinking-row-fix-commit-local-2480a221`, `1c5123af` | `PING_EXIT=0`; HTTP 200 | HTTP acceptance only; the job was still running at scan time |

Full job IDs, timestamps and tool-call IDs are retained in `session-pings.txt` in the evidence directory below. An `isError: false` tool result did not catch the reported exit 127: the wrapper command succeeded while its ping failed. Do not equate a successful outer shell with a successful request.

## Native Pi notifications are not webhooks

`hook/wake.ts` promotes a native claim to `notify/delivered/<session>` only after accepted injection, entry into the turn, an answer, and turn settlement. That `accepted` file means Pi injection acceptance, **not HTTP**. `_advisory.*` slots are not completion receipts.

The app has 429 jobs with 457 native completion slots; API has 82 jobs with 83 slots. Multiple slots occur on 28 app jobs and one API job. Inspected examples have two different subscribed session IDs, so the multiplicity is legitimate fan-out, not evidence of duplicate webhook sends. The app has 103 jobs with blocked native completion claims, including 10 that also have another delivered completion slot; 99 retain `_completion = 2` unconfirmed-injection counters. Those records establish accepted-but-unconfirmed native injections, not failed Grok webhooks. There are 3,794 seat notification files across 89 app jobs; these repeated alerts likewise do not count as HTTP requests or bot turns. No same-bot duplicate webhook was established by this scan; absent request/turn correlation prevents ruling duplicates out.

## Receiver-history limits

Read-only inspection of accessible `/Users/overment/.overment/jobs.sqlite` found no job/task/wake rows matching finish-ping or finish-webhook, and no wake-fire/job-run rows. Indexed searches in accessible `sessions.sqlite` (125 sessions, 1,244 turns) found no finish-ping, Grok Bot, or earlier F702 probe labels. `history.sqlite` could not be opened read-only. These stores therefore cannot confirm the receiver run above; they are not evidence that Tony or Grok never responded elsewhere. No VPS history or remote session was examined.

## Implications folded into this candidate

- Keep opt-in explicit. A private project target list replaces the legacy Tony pair; there is no silent home fallback or implicit Tony recipient. Configure each authorized bot route, even when two bots share one project.
- Start all target requests concurrently. An unreachable first bot must not block the second. Validate the complete list before sending and require all requests to be accepted for sender exit 0. The new failure/stall and automatic partial-failure tests exercise these distinctions.
- Preserve the existing once-only automatic claim and bounded shutdown. Blind retries could duplicate a bot turn after an accepted-but-unobserved request. A retry of the full target list may also repeat successful destinations. The operator guide describes deliberate target-only retries without changing automatic claims.
- Keep HTTP status separate from an observed wake, and native Pi receipts separate from both. The operator guide now requires a matching completed turn for each bot and warns against counting a receiver run ID, multiple subscription slots, or HTTP 200 as a two-bot wake.
- Installation and explicit project configuration remain necessary. This worker does not retrofit the historical jobs or mutate private project config. Sender fan-out alone cannot repair a receiver that routes every request to Tony.

## Remaining acceptance question

Which two authorized Grok Bot endpoints (or documented receiver routing fields) consume `{job, status, branch}`, and where can each resulting bot turn be inspected? The assigned ticket `spec/features/active/F702b-grok-bot-multi-wake/ticket.md` is absent in the worktree. The current candidate supports distinct URL/auth routes without inventing a Grok API. Live two-bot acceptance must wait for that contract and observer. If routing requires a request-body bot/session identifier rather than destination URL/auth, adapt the sender to that verified contract before configuring production; do not assume the placeholder routes in the docs exist.

Evidence retained outside the worktree: `/Users/overment/.overment/limen/tmp/evidence/F702b/1d77c03b/`. `scan_finish.py` and `scan_session_pings.py` preserve the bounded scan methods; `scan-finish.txt`, `notify-classification.txt`, and `session-pings.txt` preserve safe findings. Counts are a local snapshot, not remote or historical delivery guarantees.
