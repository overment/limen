# F032-hosted-supervisor-target-truth · Finalize reflects the worker, not Herdr's degraded view

[2026-08-20] [🟢] [PROVEN] [COORDINATOR] PROVEN · F032-hosted-supervisor-target-truth

## Outcome

The hosted supervisor never stalls forever on `unknown`, and never declares `done: hosted agent ended` for a worker that is still alive. Two observed-or-demonstrable failure modes close:

- **Stuck running:** repeated `herdr agent get` CLI errors cache status `unknown`, which counts as neither `session-ended` nor `missing`×3 — finalize never fires, no wake ever.
- **Premature done:** moving the job pane to another workspace gives it a new pane ID; the recorded ID stops resolving, `target_not_found` reads as `missing`×3, and the supervisor finalizes `done` while the worker lives elsewhere.

## Evidence

Herdr 0.8 skill semantics (`herdr --skill`): `done` is unseen idle; `unknown` means present-but-unclassifiable and "does not prove completion"; moved panes receive new workspace-qualified IDs and old IDs stop resolving. Limen side: `runHostedSupervisor` (`src/proc.ts`) polls `hostedAgentStatus` only; `noteHostedFault` caches last-known status on CLI faults; `liveHostedTarget` (`src/herdr.ts`) already contains a `pane process-info` probe that sees through `unknown`, but the supervisor loop never calls it.

## Scope

- Supervisor treats sustained `unknown`/CLI-fault streaks as indeterminate: before acting, re-resolve the target via `agent list` (recorded name and pane) and probe `pane process-info` for a live pi/node foreground process.
- Stale pane ID after a move: if `agent list` locates the agent under a new pane ID, update the job's `herdr/` record and keep supervising — no finalize.
- Truly gone (no agent anywhere, no foreground pi) still finalizes within the existing 3-sample window.
- One durable log line per re-resolution or fault streak, so degraded-Herdr periods are visible in the job record.

## Out of scope

- Changing what `idle`/`done` mean (settled by F017/F020).
- Detached-wrapper supervision (different seam, has its own containment story).

## Acceptance

- With a fake herdr that errors: no premature finalize; when the fault clears, finalize proceeds normally.
- With a fake herdr reporting the agent under a new pane ID: supervisor follows, updates `herdr/pane`, does not finalize.
- Agent genuinely gone: finalize at ~3 samples as today.
- `npm run check` green.

## Notes

Depends on nothing pending; pairs naturally with F031 in one reliability pass. Process-control adjacent — fresh reviewer when implemented.
