# Remote seat

The machine that runs jobs is not the machine you sit at.

A **seat** is one always-on host (typically a VPS on a Tailscale tailnet) that owns the Git checkouts, worktrees, and `.limen/jobs/`. Your laptop, phone, or studio Mac is a **window**: attach, look, type, leave. Closing the lid must not kill a worker.

This is operator guidance, not a provisioner. Limen does not install Tailscale or Herdr for you. The numbered box checklist and systemd units live in [docs/seat/](seat/README.md).

## Two layers

| Layer | Role | What it is not |
|---|---|---|
| **Seat** | Runs `pi`, `limen`, optional Herdr; holds job files and worktrees | A second clone you `limen spawn` from |
| **Doorbell** | GitHub mention or label that asks the seat to spawn | The coordinator, a merge gate, or CI |

Build the seat until it is boring. Then the doorbell. Auto-picking every PR is unsolicited ownership — keep it opt-in (`limen:triage` or equivalent) and last.

Limen writes files. The seat consumes them. Do not add Tailscale, ntfy, or GitHub to `src/`.

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

1. **Direct agents** — Tailscale up, `herdr --remote you@seat-name`. Coordinator Pi runs *there*. On the seat, spawn `--detached` unless you are attached and intend to type. Close the window; jobs keep running.
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

## Bring up

Buy the box, then follow [docs/seat/](seat/README.md). Short version:

1. Ubuntu LTS, Tailscale, SSH key only. Node 24, Git, `pi`, Herdr, `limen` linked from a clone.
2. One project on that disk. `limen init`. Keys stay on the seat.
3. Prove ntfy on the phone, then enable `limen-bell.timer` against `docs/seat/bell.sh`.
4. Persistent Herdr session on the box. Attach with `herdr --remote`. First job: `limen spawn --detached`.
5. `tailscale serve` for previews. `limen-prune.timer` daily. No unattended reboot.

Do not move the coordinator until a detached job finishes with the lid closed and the phone rings. Do not run a coordinator on the Mac **and** the VPS during migration.

## Seat notes (stolen from the field, not required by Limen)

These are operational facts that keep a seat alive. They are not Limen features.

- Tailnet-only services; one public port at most (SSH break-glass). Bind app servers to `127.0.0.1`. Docker `-p` bypasses the host firewall unless you pin `127.0.0.1:`.
- Do not let unattended OS upgrades reboot the box under live jobs. Patch the kernel when you choose.
- Many worktrees will fill a small ext4 disk. Plan disk (btrfs reflinks, or accept the tax).
- `limen prune` belongs on a timer so finished checkouts do not accumulate.
- Two jobs on one repo still share whatever database you pointed them at. Files isolate; schema may not.
- Herdr/`tmux` is the layer that survives a GUI dying. A browser IDE is a viewer.

F007 process containment is macOS-shaped (`src/proc.ts` shells Darwin `proc_pidinfo`). On Linux, `limen stop` is best-effort and writes an `unavailable` cleanup note. Accept that. Do not port a second identity stack unless stop-on-Linux actually hurts. `package.json` lists `linux`; the claim is “runs,” not “containment parity.”

## Traps (will bite on day one)

- **Wake is not the bell.** Footer, toast, and `sendUserMessage` fire in the coordinator session *on the seat*. You are not looking at it. Phone push (`docs/seat/bell.sh`) is the attention channel. Do not wait for a Limen-owned notifier (`LIMEN_NOTIFY` does not exist).
- **Hosted-by-default is wrong on a seat.** Inside Herdr, `limen spawn` is hosted (`HERDR_ENV=1`) — no 90-minute timeout, no tool-call cap, no F007. That encodes “you are watching.” On the seat, pass `--detached` unless you are attached and intend to type. `LIMEN_SPAWN` is not a flag yet.
- **`--tab` needs a free shell that Herdr has seen.** `agent start` fails with `pane … is not an available shell` if the tab was never focused (Herdr 0.8 treats unseen `--no-focus` tabs as busy). Limen now focuses the new tab once, then restores the coordinator. First smoke on a seat is still `--detached`. Hosted tabs need `herdr integration install pi`.
- **Herdr `done` is unseen idle**, not process exit. On a seat you attach twice a day, so almost every tab reads `done`. Limen must not treat that as terminal (already true as of `c316fce`). Do not “fix” `idle` vs `done` for headless.
- **One repo first.** Do not sync the five consumer projects onto the box. Do not copy `.limen/` to the laptop.

## Doorbell (not built)

Stay outside `src/`. A systemd timer on the seat that `gh api`s mentions/labels, `limen spawn --detached`s, and `gh pr comment`s back is enough. Dedupe on disk (`comment_id` → job id) or a re-poll double-spawns. No GitHub App, no inbound webhook, no public port.

- Mention or an explicit label → spawn on the seat.
- Comment back: job id, branch, checks, log pointer.
- Human merges. CI stays CI.
- Unlabeled PRs stay untouched.

See `spec/features/planned/F014-github-doorbell/ticket.md`. Promote into Limen only if that script is copied to a third machine and still identical.

## When you come back

1. Buy: Ubuntu LTS, 4–8 GB RAM, 80 GB disk, public SSH key-only. Follow [docs/seat/](seat/README.md).
2. Prove ntfy from the Mac to the phone **before** moving keys or the coordinator.
3. On the box: Node 24, Git, `gh`, `pi`, Herdr, `limen` (`npm link` from a clone of this repo). One project. `limen init`.
4. Enable `limen-bell.timer` and `limen-prune.timer`. Persistent Herdr session. `herdr --remote you@seat-name`.
5. Prove, in order: lid-closed `--detached` job → phone rings → `limen jobs` on attach shows the same id → `tailscale serve` preview opens on the Mac.
6. Only then live on the seat. Do not write Limen code to “support the VPS.” Optional later, and only after you have typed them twice: `LIMEN_SPAWN=detached`, `LIMEN_NOTIFY=` exec after a wake claim.

## Related

- [Vision](../spec/vision.md) — durable intent, including the seat/window split.
- [F013 remote seat](../spec/features/planned/F013-remote-seat/ticket.md) — what Limen still owes the seat.
- [SECURITY.md](../SECURITY.md) — `pi --approve` is still you, wherever the seat is.
