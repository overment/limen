# F012 seam map

Spawn now calls `openWatchTab` after writing `state=running` and before launching the wrapper.

## Layout

- `src/herdr.ts` — advisory Herdr calls. Skip unless `HERDR_ENV=1`. `LIMEN_HERDR=0` disables; otherwise that path or `herdr` on PATH.
- Record: `.limen/jobs/<id>/herdr/{workspace,tab,pane,mode}` with `mode=watch`.
- Workspace label is `basename(project root)`. Reuse a listed workspace with that label, else `workspace create --cwd --label --no-focus`.
- Tab: `tab create --workspace --label <job label> --cwd <project root> --no-focus`, then `pane run <pane> tail -f <job>/log`.
- Failure is one log line (`herdr skipped: …`), never a failed spawn.

## Tests

- `test/scratch.ts` strips Herdr env and sets `LIMEN_HERDR=0` so existing spawn/stop/jobs stay headless.
- `test/spawn-command.test.ts` puts a JSON-speaking fake `herdr` on PATH and asserts `--label` plus recorded tab/mode.
- Structure cap raised 1550 → 1650. `src/` is 1588.

## Not done

- Rename tab on `done` / `failed` / `stopped` (`finalizeJob` in `src/proc.ts`).
- `limen open` (recreate or focus; write new Herdr ids back).
- Close leftover tabs when a feature folder moves to `done/` or `dropped/`.
- F010 hosted `pi`.
