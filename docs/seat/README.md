# Seat bring-up

Operator checklist. Limen does not run these. Copy the units, set the drop-ins, enable the timers.

Units next to this file: `bell.sh`, `limen-bell.{service,timer}`, `limen-prune.{service,timer}`.

## Box

- Ubuntu LTS. 4 GB RAM minimum, 8 GB if you run browsers or Docker. 80 GB disk (worktrees are full copies on ext4).
- Public SSH only, key auth, no password. Everything else tailnet-only.
- Hostname you will type: the Tailscale MagicDNS name.

## On the box

1. `tailscale up`. Confirm you can `ssh you@that-name` from the Mac.
2. Node 24, Git, `gh`, `pi` on `PATH`. Install Herdr the same way you did on the Mac.
3. Clone limen, `npm install && npm link`. Clone **one** project. `limen init` there.
4. Keys live only here: model provider, `gh auth login`, deploy tokens. Same identity as the Mac, not a second one.
5. Disable automatic reboot under live jobs (`Unattended-Upgrade::Automatic-Reboot "false";`). Patch when you choose.
6. Start a persistent Herdr session (or `herdr server` under systemd) so attach works with the lid closed.
7. `herdr integration install pi` if hosted tabs are wanted later. First jobs: `limen spawn --detached`. `LIMEN_SPAWN` is not a flag yet.

## Bell

1. On the phone: ntfy app, subscribe to a long random topic. From the Mac: `curl -d test https://ntfy.sh/$topic` — phone must buzz **before** you move the coordinator.
2. Copy `bell.sh` onto the box. `chmod +x`.
3. Drop-in for `limen-bell.service`: `User`, `LIMEN_ROOT` (the project that contains `.limen`), `NTFY_TOPIC`, `ExecStart` → that script.
4. `systemctl enable --now limen-bell.timer`
5. `limen spawn --detached "echo seat-smoke && exit"` from the project. Close the SSH session. Phone should ring. `cat .limen/jobs/<id>/notify/bell` exists. Re-run the script: no second ping.

## Prune

Drop-in: `User`, `WorkingDirectory` = the project, `PATH` that includes `limen`. `systemctl enable --now limen-prune.timer`.

## From the Mac (window)

```bash
herdr --remote you@seat-name
# optional: --session <name> if the seat is not using the default session
```

Coordinator Pi runs **on the seat**. Do not `limen spawn` from a laptop clone of the same repo.

Preview: on the seat, bind the app to `127.0.0.1`, then `tailscale serve 3000`. Open the printed HTTPS URL. Do not `tailscale funnel` unless you mean the public internet.

## Prove, in this order

1. Detached job finishes with the lid closed; phone rings; `state` on the box is `done`.
2. `herdr --remote` → `limen jobs` shows that same id.
3. Preview URL opens on the Mac. No `git pull`.

If 1 fails, do not move the coordinator. If 1–3 work, the laptop is a window from then on.

## Linux stop

`limen stop` on Linux cannot use Darwin process identity. Treat it as best-effort. Job files are truth.

## Not yet

GitHub mention → spawn (F014, operator `gh` timer — not a GitHub App). `LIMEN_SPAWN` / `LIMEN_NOTIFY`. Hosted-by-default on a seat. Linux process-identity parity.

Pickup narrative and traps: [docs/remote.md](../remote.md).
