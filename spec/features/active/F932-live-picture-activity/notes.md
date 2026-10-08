# F932 notes · live job activity on the picture

## Live signals today (studied 2026-10-08, OMP 18.4.4, Pi 1.0.0, Herdr 0.9.3)

| Signal | Where | What it says | Latency | Maps to a feature |
| --- | --- | --- | --- | --- |
| Job files | `.limen/jobs/<id>/activity`, `last-tool`, `tool-detail`, `tool-calls`, `log` | `think`, `tool`, `wait`; last tool name; bash command (80 chars, hosted only); tool count; log lines | One write per engine event | Yes: F-number in `label` or job id |
| Job state | `.limen/jobs/<id>/state`, `finished-at`, `stop-reason`, `result` | `running`, then `done`, `failed`, `stopped` | On exit | Same |
| Owner process | `.limen/jobs/<id>/pid`, `born` | Wrapper or hosted owner pid; `ownerAlive` checks pid and birth time | Polled | Same |
| Engine session JSONL | `.limen/jobs/<id>/session/<iso>_<uuid>.jsonl` (both engines, via `--session-dir`) | `model_change` (model id), `thinking_level_change`, one line per finished message; OMP also writes a `tool_execution_start` custom entry before each tool | Per finished message, not per token | Only through the job folder |
| Engine stdout (`--mode json`) | Detached wrapper only (`src/runtime/stream.ts`) | Every event, with deltas | Live | Only the wrapper can read it |
| Engine RPC (`--mode rpc`) | Both engines | `get_state`, entries, settled events | Live | Limen does not run engines in RPC mode |
| Herdr agent state | `herdr agent get <pane>` | `idle`, `working`, `blocked`, `done`, `unknown`, missing | Live | Hosted jobs only, through `herdr/agent` |

Who writes the job files:

- Detached jobs: `src/runtime/wrapper.ts` parses the engine JSON stream (`src/runtime/stream.ts`). It writes `activity`, `last-tool`, `tool-calls`, and `log` (log lines `<tool> <detail>`). It does not write `tool-detail`.
- Hosted jobs: the `hook/hosted.ts` extension, loaded into OMP and Pi alike. It writes the same files plus `tool-detail` and `last-turn-tools`. `wait` there means the turn ended.

Gaps that do not block this feature:

- OMP sets no `PI_SESSION_ID`, and `engine-session` is written only for Pi on Linux. Watch, steer, and wake fall back to the Herdr pane or the process ancestry. The live page does not need a session id.
- OMP may not emit `agent_settled`; `hook/hosted.ts` also refreshes Herdr metadata every second.
- No job record field names its feature. The F-number regex over label and id (`closedJobFeatures` in `src/job/job.ts`) is the existing convention; a label may name two features.

## Design

`limen picture serve` builds the picture page in memory and serves it on 127.0.0.1. It reads the job folders once per second and pushes a snapshot to the page over Server-Sent Events when the snapshot changes. The page shows the live layer only when the served HTML carries `data-live` and the page came over HTTP; the file that `limen picture build` writes stays offline.

Why the job folders, not engine sessions: they have the same shape for OMP and Pi, detached and hosted. They already carry the F-number. Reading them needs no engine-specific parser. The session JSONL is read only for its first `model_change` line.

Rejected or deferred:

- WebSocket: Node 24 has no built-in WebSocket server, so the handshake and framing would be hand code. The page sends nothing back, so a one-way stream is enough.
- Page polling of a JSON file: works, but repeats the change detection in the page and makes a request every tick. EventSource reconnects by itself.
- `fs.watch` instead of a poll: a dead process makes no file event, and atomic renames make noisy events. The one-second poll covers both, and liveness needs a timer anyway.
- Engine RPC or stdout taps: only the process that starts the engine can read them; Limen does not own a tap for hosted jobs.
- Herdr agent state: hosted only, and one CLI call per job per tick.
- Thinking text from the session JSONL: not shown. It can hold private reasoning, and the page needs the action, not the words.

## Activity words

One pure function maps a job's files to one state and one plain phrase (`src/picture/activity.ts`):

- `starting`: no state yet and the spawner is alive.
- `working`: owner alive, last event within five minutes. The phrase comes from the tool: editing files, reading code, running tests and checks, running a command, running helpers, reading the web, thinking.
- `waiting`: activity `wait`.
- `quiet`: owner alive, no event for more than five minutes.
- `dead`: state `running`, owner process gone. Never shown as running.
- `done`, `failed`, `stopped`: terminal, shown for one hour after the finish.

## Open questions

- The quiet threshold is five minutes. A long test run can cross it and show as quiet with its last action; that is honest, but Adam may want a longer limit for `bash`.
