# Outside Limen: T3 coordinator practice

**Not this repository.** This note records practice for T3 and the shepherds. It creates no Limen task, and no Limen code, doc or message names T3. Source: `~/Downloads/t3-limen-handling-system-diff.html` (2026-10-30).

## Launcher

T3's Pi settings offer only a binary path and launch arguments, not environment variables. So the binary path points to a small launcher:

```sh
#!/bin/sh
# T3 starts every Pi thread through this script.
export LIMEN_COORDINATOR=1
exec /absolute/path/to/pi "$@"
```

A running thread picks up the switch only when its Pi process restarts. Not known yet: whether T3 restarts it on a settings change or only on an app restart.

## Shepherd rules (Tony, Johnny)

- One top-level T3 thread per lane is the coordinator session. Workers come only from `limen spawn` in that thread.
- The first message to a moved lane says: run `limen watch` on each running worker of this lane, then end your turn.
- No `limen wait`, `sleep` or polling loop in a coordinator. No `--tab` jobs from T3.
- Hand over once: the old Herdr coordinator runs `limen unwatch --all`, then its tab is closed. After that, no Herdr action for that lane.
- T3 helper threads do read-only research and reports only. Code changes go through `limen spawn`.
- Only the lane's coordinator lands.

## Open check

With the launcher, T3 helper threads on Pi also get `LIMEN_COORDINATOR=1`. Check that they do not register as a second coordinator: after a helper starts, `.limen/coordinators/` in the project holds no new session for it. Read in the code at `3419a4c`, not run: registration skips a session whose agent kind is `sub` (`start` in `src/integrations/coordinator-signal.ts`). Not known: whether T3 starts its helpers that way.
