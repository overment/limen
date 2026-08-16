# Remote seat

The machine that runs jobs is not the machine you sit at.

A **seat** is one always-on host (typically a VPS on a Tailscale tailnet) that owns the Git checkouts, worktrees, and `.limen/jobs/`. Your laptop, phone, or studio Mac is a **window**: attach, look, type, leave. Closing the lid must not kill a worker.

This is operator guidance, not a provisioner. Limen does not install Tailscale or Herdr for you.

## Two layers

| Layer | Role | What it is not |
|---|---|---|
| **Seat** | Runs `pi`, `limen`, optional Herdr; holds job files and worktrees | A second clone you `limen spawn` from |
| **Doorbell** | GitHub mention or label that asks the seat to spawn | The coordinator, a merge gate, or CI |

Build the seat until it is boring. Then the doorbell. Auto-picking every PR is unsolicited ownership — keep it opt-in (`limen:triage` or equivalent) and last.

## One disk

Coordinator and workers must agree on the same `repoRoot` and `.limen/jobs/`.

```
Mac (window)                         VPS (seat)
────────────                         ──────────
Tailscale                            Tailscale + limen + pi [+ Herdr]
herdr --remote / session attach  ──► same session, same job cabinet
browser: tailscale serve URL         app, tests, workers
optional local git clone             never a second .limen/
```

Do not: SSHFS the worktrees; run a coordinator on the laptop against a different disk; copy `.limen/` between machines.

## Daily loop

1. **Direct agents** — Tailscale up, attach the seat’s Herdr session (or SSH). Coordinator Pi runs *there*. `limen spawn` (hosted by default inside Herdr). Close the window; jobs keep running.
2. **Judge** — wake, `limen jobs`, or `limen open`. Job files on the seat are truth; the footer can lag.
3. **See the product**
   - Usual: preview bound to localhost on the seat, published with `tailscale serve` — open that HTTPS URL. No pull.
   - Local feel (simulator, GPU, your browser profile): `git fetch` the **branch** into a disposable laptop clone and run the app. That clone is a viewer, not a Limen root.
4. **PR / mention** (once the doorbell exists) — comment on GitHub; the seat spawns; you attach later and see the same job record.
5. **Travel** — any tailnet device: attach, or just the preview URL.

## What you pull, and when

| Want | Do |
|---|---|
| Continue jobs, board, wakes | Attach to the seat. Do not pull `.limen/`. |
| Click the app the agent just built | Open the seat preview URL. |
| Device-specific UI | Pull the git branch to a normal clone. Do not `limen spawn` from it. |
| After merge | Pull `main` locally only if you still want a laptop checkout. |

## Seat notes (stolen from the field, not required by Limen)

These are operational facts that keep a seat alive. They are not Limen features.

- Tailnet-only services; one public port at most (SSH break-glass). Bind app servers to `127.0.0.1`. Docker `-p` bypasses the host firewall unless you pin `127.0.0.1:`.
- Do not let unattended OS upgrades reboot the box under live jobs. Patch the kernel when you choose.
- Many worktrees will fill a small ext4 disk. Plan disk (btrfs reflinks, or accept the tax).
- `limen prune` belongs on a timer so finished checkouts do not accumulate.
- Two jobs on one repo still share whatever database you pointed them at. Files isolate; schema may not.
- Herdr/`tmux` is the layer that survives a GUI dying. A browser IDE is a viewer.

F007 process containment is macOS-shaped. On Linux, treat stop as best-effort and lean on job files.

## Doorbell (not built)

A GitHub App or Actions workflow is ingress only:

- Mention or an explicit label → `limen spawn` on the seat.
- Comment back: job id, branch, checks, log pointer.
- Human merges. CI stays CI.
- Unlabeled PRs stay untouched.

See `spec/features/planned/F014-github-doorbell/ticket.md`.

## Related

- [Vision](../spec/vision.md) — durable intent, including the seat/window split.
- [F013 remote seat](../spec/features/planned/F013-remote-seat/ticket.md) — what Limen still owes the seat.
- [SECURITY.md](../SECURITY.md) — `pi --approve` is still you, wherever the seat is.
