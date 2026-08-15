# F012 seam map

Spawn calls `openWatchTab` after writing `state=running` and before launching the wrapper.
`finalizeJob` renames the recorded tab to `<label> · done|failed|stopped` before writing terminal state.
`limen open <id>` focuses a live recorded tab or recreates watch/log and writes new Herdr ids.
`limen close <FNNN>` closes leftover job tabs only after that feature folder is under `done/` or `dropped/`.

## Layout

- `src/herdr.ts` — advisory Herdr calls. Skip unless a binary is available (`LIMEN_HERDR=0` disables). Spawn also requires `HERDR_ENV=1`.
- Record: `.limen/jobs/<id>/herdr/{workspace,tab,pane,mode}` with `mode=watch` or `mode=log`.
- Workspace label is `basename(project root)`. Reuse a listed workspace with that label, else `workspace create --cwd --label --no-focus`.
- Tab: `tab create --workspace --label --cwd --no-focus` (spawn) or `--focus` (`limen open`).
- Watch pane: `pane run tail -f <job>/log`. Finished reopen: `tail -n +1`.
- Failure is one log line (`herdr skipped: …`), never a failed spawn.
- Close never targets `HERDR_TAB_ID` and never deletes `.limen/jobs`.

## Tests

- `test/scratch.ts` strips Herdr env and sets `LIMEN_HERDR=0` so existing spawn/stop/jobs stay headless.
- `test/spawn-command.test.ts` asserts `--label`, recorded tab/mode, and `tab rename … · done`.
- `test/open-command.test.ts` covers focus, recreate watch/log, missing Herdr, and proven-feature close.
- Structure cap 1650 → 1750. `src/` is 1695.

## Not done

- F010 hosted `pi`.
