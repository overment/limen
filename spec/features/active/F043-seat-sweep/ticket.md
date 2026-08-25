# F043-seat-sweep · A launchd-swept seat notices what no open session can

[2026-08-25] [🟠] [ACTIVE] [COORDINATOR] ACTIVE · F043-seat-sweep

## Outcome

`limen sweep` walks every registered project, reaps dead jobs, and rings for anything unheard past a threshold. A launchd interval job runs it every minute and survives reboots — detection no longer depends on any session being open. The sweep never consumes a coordinator's wake.

## Scope

- Registry: wake-extension `session_start` and `limen init` upsert the project root into `~/.limen/projects` (one absolute path per line, deduped). `limen sweep` iterates it and prunes lines whose path is gone.
- Per project: run the existing reaper (`confirmDeadJobs`) — reboot-killed supervisors finalize within a minute of the machine returning. Then ring-check: a running job whose advisory has no `_advisory.*` in `notify/delivered`, or a terminal job with no completion delivered, past the threshold (`LIMEN_SEAT_RING_MS`, default 5 min) and with no `.limen/last-sweep` fresher than the threshold → ring.
- Ring bookkeeping under `notify/seat/` — timestamped marker per ring; re-ring at a 15-minute cadence while unheard. Extend `notifyBookkeeping` in `hook/wake.ts` to ignore `notify/seat` so coordinator watchers do not churn; keep the writer and the filter in lockstep.
- Ringing: herdr `notification show` when reachable from launchd context; else `osascript -e 'display notification …'`. Both system-present — runtime dependencies stay empty.
- `limen sweep --install` / `--uninstall`: write/remove `~/Library/LaunchAgents/limen-sweep.plist` with absolute paths (the current node executable, this checkout's `bin/limen`) and `StartInterval` 60. Install is explicit opt-in and prints what it wrote. `init` never auto-installs.
- Command surface: `main.ts`, help text, and the structure-test lockstep (command regex, commands-dir listing).

## Out of scope

- Acting on jobs. The seat rings; coordinators and humans act. `notify/delivered` stays coordinator-owned — the sweep never writes claims or delivered.
- A resident daemon. launchd is the event loop; `limen sweep` is one bounded pass.
- Linux/systemd (F013 documents the seat shape) and unregistered projects.

## Acceptance

- Fixture project, running job, stale advisory, no fresh `last-sweep`: first `limen sweep` rings once and writes a seat marker; an immediate second run is silent; a run past a shrunk cadence re-rings.
- Fresh `last-sweep` (a coordinator is alive) → the seat stays silent for that project.
- Reboot sim (recorded pid dead, supervisor gone): sweep finalizes `failed` via the reaper; the unheard completion rings on the next pass.
- `--install` writes a plist `plutil -lint` accepts, with absolute paths; `--uninstall` removes it; neither touches anything else.
- Registry: a new project's `session_start` adds its line once; a deleted path is pruned.
- A test asserts the sweep never writes under `notify/claims` or `notify/delivered`.
- `npm run check` green; source stays ≤ 2750 lines (if the budget pinches, F040's sign-off frees ~125).

## Notes

Found in the 2026-08-25 wake investigation. The blackout needed exactly one thing no session could give: a watcher whose liveness the OS guarantees. On macOS that is launchd — hence a cron-shaped command, not a daemon: no lifecycle to manage, and the only skew surface is the plist's absolute paths (moving the checkout means re-running `--install`; the install prints this).

This is limen's first global surface (`~/.limen/`, `~/Library/LaunchAgents`) — a deliberate bend of the files-live-in-the-project principle, requested by the operator on 2026-08-25 after the F006 blackout. Verify early that `herdr notification show` works without pane env from launchd; the osascript fallback is the floor.

After F045 and F042 — the thresholds read the stamps and delivered markers those tickets define.
