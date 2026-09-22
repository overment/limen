# F727 spike

Parser verdict: **shared parser OK**. Ship a profile table. This spike supplied evidence only; the implementation decision lives in `spec.md`.

Binaries: `pi` 0.84.2 (`@earendil-works/pi-coding-agent`), `omp` 18.2.9 (`@oh-my-pi/pi-coding-agent`, installed this job via `curl https://omp.sh/install`). Docs read: omp `docs/cli-reference.md`, `docs/extensions.md`, `docs/session.md`, `docs/approval-mode.md`, `docs/porting-from-pi-mono.md`; pi `docs/json.md`. omp `docs/stream.md` is livestreaming, not JSONL.

Auth: `pi auth check --provider xai --model grok-4.6` → `ready`. `omp token xai` → no stored credential. Spike injected `XAI_OAUTH_TOKEN` from `pi auth print-bearer-token --provider xai` (OAuth, not an API key). Parent `PI_*` / `LIMEN_*` stripped via `env -i`.

## Commands

Cwd for tool runs: `tmp/evidence/f727-omp-spike/sandbox`. Prompt A: `Reply with exactly the word pong and nothing else. Do not use tools.` Prompt B: `Run the bash command \`echo spike-ok\` then reply with exactly the word done.`

```
pi --mode json --no-extensions --no-tools --thinking off --provider xai --model grok-4.6 \
  --session-dir …/print-pong/pi/session --append-system-prompt 'You are a test fixture. Obey the user exactly.' \
  '<prompt A>'
# exit 0

omp --mode json --no-extensions --no-tools --thinking off --model grok-4.6 --no-title \
  --session-dir …/print-pong/omp/session --append-system-prompt 'You are a test fixture. Obey the user exactly.' \
  '<prompt A>'
# exit 0; XAI_OAUTH_TOKEN set

pi --mode json --no-extensions --thinking off --provider xai --model grok-4.6 \
  --session-dir …/bash-echo/pi/session --append-system-prompt '… Use bash …' '<prompt B>'
# exit 0; tools ran without an auto-approve flag

omp --mode json --no-extensions --thinking off --model grok-4.6 --no-title --auto-approve \
  --session-dir …/bash-echo/omp/session --append-system-prompt '… Use bash …' '<prompt B>'
# exit 0

omp --mode json --approve --name 'limen: spike' …  # exit 2: unknown flags: --approve, --name

omp --mode json --auto-approve --no-extensions --no-tools … --extension hook/steering.ts '<pong>'
omp --mode json --auto-approve --no-extensions --no-tools … --extension hook/communication.ts '<pong>'
# both exit 0, empty stderr
```

`--mode json` without `-p` is print/JSON on both (matches Limen's wrapper). Logs: `tmp/evidence/f727-omp-spike/` (untracked).

## Event overlap

Limen `interpret()` keys: `tool_execution_start`, `tool_execution_end`, `message_end`, `agent_start`, `turn_start`, `message_start`, `message_update`.

| | pi | omp |
|---|---|---|
| session header stdout | `{type,version:3,id,timestamp,cwd}` | same |
| prompt A types | session, agent_start, turn_start, message_start/end, message_update, turn_end, agent_end, **agent_settled** | same minus agent_settled; plus **advisor_cost_changed** |
| prompt B tools | `tool_execution_start/update/end`, `toolName: bash`, `args.command: echo spike-ok` | same; `tool_execution_end.result` also has `details` |
| assistant `message_end` | `role:assistant`, `content[]` text/thinking, `stopReason: stop` | same |
| unknown types | already dropped by `interpret()` | already dropped |

Both answered `pong` / `done`. Grok still emitted thinking with `--thinking off` on both.

## Argv / session / continue

Current Limen launch (wrapper): `pi --mode json --approve --no-extensions --session-dir … --name … --append-system-prompt … --extension steering --extension communication` plus provider/model/thinking and `--continue` or `@task`. Hosted omits `--mode json`; Herdr `agent start --kind pi` (this plant's Herdr lists `omp` as a kind).

`--approve` on pi is project-trust, not tool yolo. omp has `--auto-approve` (tool yolo) and no `--name`.

Session jsonl: both write one `*.jsonl` under `--session-dir` with `{type:message, message:{role, content}}` entries `lastHostedAssistant` already reads. omp prepends `title`, uses `model_change.model` instead of `modelId`+`provider`, adds `custom` entries. Do not resume an omp transcript with pi.

Continue today copies the newest jsonl and does not copy `engine`. Same-engine continue is the only safe path.

Auth stores are separate (`~/.pi` vs `~/.omp`).

Unproven: hosted `--kind omp`; `--continue` live resume; `LIMEN_PREFLIGHT=auth` equivalent on omp.
