# F013-remote-seat · One disk, attach don’t clone

[2026-08-16] [🔴] [PLANNED] [COORDINATOR] PLANNED · F013-remote-seat

Human-owned map: [docs/remote.md](../../../../docs/remote.md). This ticket is what Limen still owes that map. Sequenced before F014.

## Outcome

An operator can run the coordinator and every job on one always-on host, attach from another machine, and leave. Job files, worktrees, and Herdr session stay on that host. A laptop checkout is optional and is never a second Limen root.

## Scope

- Keep `docs/remote.md` accurate as the operator flow (seat vs window, one disk, preview vs local pull).
- Document attach (`herdr --remote` / session attach) and the rule: spawn only on the seat.
- Call out Linux gaps that change guarantees: F007 is macOS-shaped; hosted `--tab` already dropped containment; `stop` is best-effort.
- Optional: a short “am I on the seat?” advisory (e.g. warn if `.limen/jobs` and the worktree disagree about host), never a gate.
- Notes in the shop manual pointing at `docs/remote.md` — do not dump the whole remote guide into `AGENTS.md`.

## Out of scope

- Provisioning Ubuntu, Tailscale, btrfs, or a browser IDE.
- Implementing the GitHub doorbell (F014).
- SSHFS, sync daemons, or multi-master job directories.
- Changing default spawn, wake routing, or Herdr tab policy except where a seat-specific lie appears.

## Acceptance

- A reader of `docs/remote.md` plus this ticket can put Limen on a VPS and attach without inventing a second `.limen/`.
- Shop manual names the seat/window split and links the doc.
- No Limen command requires the operator’s laptop to stay awake.

## Notes

Field constraints that belong in the doc, not in `src/`: tailnet-only bind, no unattended reboot under live jobs, worktree disk tax, `limen prune` on a timer, Docker port pinning.
