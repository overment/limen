# F027 review · PASS

Candidate `24ea29404d796b7707a9e85b86677e73a43246de` implements `F027-hosted-idle-advisory` against `spec/features/active/F027-hosted-idle-advisory/ticket.md`. Checkout matches that SHA. No blocking defect found.

The hosted supervisor writes one `advisory` marker on stall (`idle`/`done` past `LIMEN_HOSTED_IDLE_MS`, default 10m, requiring `tool-calls > 0`) or on `blocked` immediately; job `state` stays `running`. The wake hook delivers that marker on slot `_advisory.<session>` / `_advisory._fallback`, then still delivers a later completion on the ordinary slot. First idle `sendUserMessage` in a sweep has no `deliverAs`; later injects, and any inject while not idle, use `deliverAs: "followUp"`. `limen jobs` prints the advisory line for a running job.

## Findings

None blocking.

Non-blocking coverage (not defects):

- **unverified** — advisory fallback (`_advisory._fallback`) is implemented like completions and filtered out of completion fallback via `completionSlots` / `advisorySlots`, but no wake test drives an unsubscribed stalled job through that slot.
- **plausible, non-blocking** — supervisor re-arm (`working` deletes `advisory` and `_advisory.*` claims) and wake re-delivery are tested as separate pieces, not one live supervisor+hook loop.
- **plausible, non-blocking** — fake Herdr with `FAKE_HERDR_PERSIST=1` reports `idle` on every `agent get`, so the integration test never observes a real `working → idle` transition; `noteHostedIdle` unit tests cover that seam instead.

## Checks

| Check | Result |
|---|---|
| `git rev-parse HEAD` | `24ea29404d796b7707a9e85b86677e73a43246de` (matches task) |
| `git status -sb` | clean; detached HEAD |
| `npm run check` | **unverified** — worktree has no `node_modules`; `tsc: command not found` (exit 127). Not repaired. |
| `node --test --test-concurrency=1 --test-timeout=60000 test/hosted-spawn.test.ts` | pass, including `noteHostedIdle` unit tests, blocked-immediate, and `hosted supervisor writes one idle advisory and stays running` |
| `node --test … test/jobs-command.test.ts` | pass, including `jobs shows the advisory line on a running hosted job` |
| `node --test … test/wake-hook.test.ts` | 20/20 pass, including advisory-once + completion, re-arm wake, sweep followUp, busy followUp, muted advisory |
| `node --test … test/structure.test.ts` | pass (`src/` still under 2500 lines) |

Acceptance mapped: zero tools → no marker; tools + shortened idle → one marker, still `running`; `blocked` skips the timer; `working` re-arms; advisory claim does not block completion; two idle completions in one sweep serialize followUp; busy session always followUp; mute holds wake and toast. No path marks the job `done`/`failed`/`stopped` from this feature.

## Next

Coordinator can file this as PASS and merge. `npm run check` (tsc + biome + full suite) was not green in this worktree; run it where deps are installed if that gate matters before merge.

Candidate commit: 24ea29404d796b7707a9e85b86677e73a43246de.
