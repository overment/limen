# Pi and OMP share one engine profile

Adam can run Limen jobs on Pi or OMP behind one flag, without a second wrapper or stream parser. The next slice lands that flag; this survey does not.

## Recommendation

Ship a profile table. The JSON event types Limen already parses (`tool_execution_start`/`end`, `message_end`, `agent_start`, `turn_start`, `message_start`, `message_update`) landed with the same field names on pi 0.84.2 and omp 18.2.9; extras (`agent_settled`, `advisor_cost_changed`) are already ignored. Do not add a Claude-style dual harness. Fill argv from a tiny table (binary, Herdr kind, drop `--name`, Pi `--approve` vs OMP `--auto-approve`). Continue must copy the parent engine and refuse a cross-engine resume — session jsonl headers already diverge. Auth stores are separate (the spike had to inject Pi's xAI OAuth into `XAI_OAUTH_TOKEN` for omp). Not implement-now.

## Profile

One module, one table, used by spawn, wrapper, and the hosted supervisor. Default `pi`.

| field | pi | omp |
|---|---|---|
| `id` | `pi` | `omp` |
| `binaryEnv` | `LIMEN_PI` | `LIMEN_OMP` |
| `binaryDefault` | `pi` | `omp` |
| `herdrKind` | `pi` | `omp` |
| `jsonMode` | `--mode json` when detached | same |
| `projectTrust` | `--approve` | omit |
| `toolYolo` | omit | `--auto-approve` |
| `sessionName` | `--name`, `limen: ${label}` | omit |
| `noTitle` | omit | `--no-title` |
| `noExtensions` | `--no-extensions` | same |
| `sessionDir` | `--session-dir`, `${jobDir}/session` | same |
| `appendSystemPrompt` | `--append-system-prompt`, preamble | same |
| `extension` | `--extension` (steering, communication; hosted adds hosted) | same |
| `provider` | `--provider` when set | pass when set (legacy on omp) |
| `model` / `thinking` | `--model` / `--thinking` when set | same |
| `continue` | `--continue`, instruction or `@file` | same |
| `task` | `@${taskFile}` | same |
| `preflight` | PATH; `pi auth check` when `LIMEN_PREFLIGHT=auth` | PATH only — omp has no `auth check` |

Public: `--engine pi|omp` (spawn already parses `--engine` and rejects anything but `pi`). `LIMEN_ENGINE` when `--engine` is omitted. Write `${jobDir}/engine`. Wrapper and supervisor look up that id. No `if (engine === "omp")` outside the table and `argvFor(profile, slots)`.

Do not pass `--approve` or `--name` to omp (unknown, exit 2). Do not pass `--auto-approve` to pi. `-p` is unnecessary with `--mode json`. Hosted stays interactive and omits json mode.

## Stream, continue, hosted

Keep `interpret()` as-is. Test that unknown types produce no events. Hosted result capture already walks `{type:message, message:{role:assistant}}`; both session files have those.

Continue copies the newest `session/*.jsonl` and does not copy `engine`. Copy `engine`, launch the same profile, refuse continue when `--engine` disagrees with the parent.

Hosted: `herdr agent start --kind <herdrKind>`. This plant's Herdr already lists `omp`.

## Change list

Shared: `src/stream.ts` (parser unchanged). Profile-only: new `src/engine.ts` (table + `argvFor`); `src/commands/spawn.ts` (allow `omp`, `LIMEN_ENGINE`, preflight, versions); `src/wrapper.ts` and `src/supervisor.ts` (binary + argv from profile; hosted omits json mode); `src/herdr.ts` (`--kind` from profile); `src/commands/continue.ts` (copy engine, same-engine only). Tests: spawn accepts `omp` / still rejects `claude`; wrapper argv per profile; continue copies engine; stream ignores extra types. Docs: `--engine pi|omp` and separate auth stores. `capturedVersions` records the selected binary.

## Acceptance

- Next slice: `limen spawn --engine omp` uses one wrapper, one parser, argv from the table.
- `limen spawn --engine claude` still fails before a job exists.
- Detached omp argv includes `--mode json --auto-approve --no-extensions --no-title --session-dir --append-system-prompt --extension` and never `--approve` or `--name`.
- Continue of an omp job launches omp with the copied jsonl; `--engine pi` on an omp parent fails closed.
- Focused spawn/wrapper/continue/stream tests plus typecheck. No second stream parser.

## Non-goals

Implementing `--engine omp` here. Restoring Claude or a second wrapper/parser. Merging `~/.pi` and `~/.omp` credentials. RPC/ACP, doorbell, unusable-route refusal.

## Risks

Operators must authenticate omp themselves. Pi `--approve` is project-trust and has no omp twin; omp jobs use omp's project-file defaults plus `--auto-approve` for tools. Hosted `--kind omp` and live `--continue` were not run in the spike. omp `--provider` is legacy; prefer `--model` when that is what the operator passed.
