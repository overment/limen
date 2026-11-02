# Seat bring-up

Operator checklist and the current setup steps. Limen does not run these. Copy the units, set the drop-ins, enable the timers.

The seat owns the project copy (the Git checkout), the worktrees, and the job files in `.limen/jobs/`. The laptop is only a window. [vps.md](../vps.md) is an old record of one setup pass, not this checklist.

Units next to this file: `bell.sh`, `limen-bell.{service,timer}`, `limen-prune.{service,timer}`.

## Box

- Ubuntu LTS. 4 GB RAM minimum, 8 GB if you run browsers or Docker. 80 GB disk (worktrees are full copies on ext4).
- Public SSH only, key auth, no password. Everything else tailnet-only.
- Hostname you will type: the Tailscale MagicDNS name.

## On the box

1. `tailscale up`. Confirm you can `ssh you@that-name` from the Mac.
2. Node 24, Git, `gh`, and the engine on `PATH`: `pi`, or `omp` with `export LIMEN_ENGINE=omp` in the worker's `~/.bashrc`, because new jobs run Pi when no engine is named. Install Herdr the same way you did on the Mac.
3. Clone limen, `npm install && npm link`. Clone **one** project. `limen init` there. This is the only project copy that runs jobs.
4. Model provider, `gh auth login`, and deploy tokens stay on the seat. The **GitHub App key** for the optional PR doorbell is different: it belongs only to the separate `limen-github` Unix user, never to the worker/coordinator account.
5. Disable automatic reboot under live jobs (`Unattended-Upgrade::Automatic-Reboot "false";`). Patch when you choose.
6. Start a persistent Herdr session (or `herdr server` under systemd) so attach works with the lid closed.
7. `herdr integration install pi` (or `omp`) for hosted tabs. First smoke job: `limen spawn --detached`.

## Bell

Prefer **Moshi** if the phone already gets Herdr pings: pair `moshi-hook` on the box (`--store file` on Linux), `service install`, `loginctl enable-linger`. Steps: [vps.md](../vps.md).

ntfy is the fallback when Moshi is not in play:

1. On the phone: ntfy app, subscribe to a long random topic. From the Mac: `curl -d test https://ntfy.sh/$topic` — phone must buzz **before** you move the coordinator.
2. Copy `bell.sh` onto the box. `chmod +x`.
3. Drop-in for `limen-bell.service`: `User`, `LIMEN_ROOT` (the project that contains `.limen`), `NTFY_TOPIC`, `ExecStart` → that script.
4. `systemctl enable --now limen-bell.timer`
5. `limen spawn --detached "echo seat-smoke && exit"` from the project. Close the SSH session. Phone should ring. `cat .limen/jobs/<id>/notify/bell` exists. Re-run the script: no second ping.

## Prune

Drop-in: `User`, `WorkingDirectory` = the project, `PATH` that includes `limen`. `systemctl enable --now limen-prune.timer`.

## Picture

Optional, per project, off by default. After the coordinator has started the first architecture map by hand, run `limen picture watch on --engine E --provider P --model M --thinking T` once from the project's primary checkout on the seat, with the board's picture engine, provider, model, and reasoning. It installs a Git hook, not a timer. Each move of the top branch starts one background `limen picture tick`. A move with no structural or cited code change since the map's revision prints nothing and calls no model. `limen picture watch off` removes it. A seat that still runs the retired `limen-picture.timer` should disable it: `systemctl disable --now limen-picture.timer`.

## From the Mac (window)

```bash
herdr --remote you@seat-name
# optional: --session <name> if the seat is not using the default session
```

The coordinator runs **on the seat**, on the board's engine. Do not `limen spawn` from a laptop clone of the same repo.

Preview: on the seat, bind the app to `127.0.0.1`, then `tailscale serve 3000`. Open the printed HTTPS URL. Do not `tailscale funnel` unless you mean the public internet.

## Prove, in this order

1. Detached job finishes with the lid closed; phone rings; `state` on the box is `done`.
2. `herdr --remote` → `limen jobs` shows that same id.
3. Preview URL opens on the Mac. No `git pull`.

If 1 fails, do not move the coordinator. If 1–3 work, the laptop is a window from then on.

## Linux process identity

Linux reads process identity from `/proc/<pid>/stat`. `limen stop` and process containment use the same code as on macOS. Job files are truth.

## GitHub doorbell

Use the checked-in [GitHub seat setup](github-setup.sh) and [remote operator trial](../remote.md#github-doorbell-opt-in-per-project). Run the installer and adjacent units only from a root-owned checkout of the pinned release, never from the worker checkout. It installs a root-owned release and `/usr/local/bin/limen` symlink, root-owned Node 24 and Herdr binaries, a private poller key/state, narrow sudo handoff, registry ACLs, and a stopped timer. In a fresh noninteractive SSH shell, `command -v limen` must resolve to that symlink. Do not put the App PEM in a checkout or worker home. Do not run `github poll` until all doctor findings except the stopped timer are repaired, enable the timer, then rerun doctor. A second registered repository uses the same seat App/timer and its own `github connect` in its persistent coordinator.

**macOS seat.** Use [github-setup-macos.sh](github-setup-macos.sh) under the same rules. Differences from Linux:

- **Groups and accounts.** Groups come from Directory Services (`dscl`). A new poller account is a hidden service account below uid 500.
- **Access.** ACL entries are `chmod +a "user:limen-github allow search|read"`, read back from `ls -le`.
- **Node.** Node is the root-owned `/usr/local/bin/node`; `/usr/bin` is system-protected.
- **Poller.** The poller is the launchd job `dev.limen.github` (`/Library/LaunchDaemons/dev.limen.github.plist`, `StartInterval` 60). The installer leaves it disabled and unloaded.
- **Poller settings.** launchd has no environment file, so the poller settings sit in that root-owned plist. They hold no key bytes.
- **Enabling it.** Enable the job with `launchctl enable system/dev.limen.github && launchctl bootstrap system /Library/LaunchDaemons/dev.limen.github.plist`.
- **Doctor.** `limen github doctor` reads the plist with `plutil` and the job with `launchctl`.

The historical Alice draft under `tmp/` is not a deployment source. Use a root-owned Node 24 binary source, not a symlink to `~overment/.nvm`; a worker-owned Node or Herdr binary is unsafe even at mode 0755. A poller can execute worker-owned code and expose its key.

## Not built

`LIMEN_SPAWN` and `LIMEN_NOTIFY` do not exist.

Pickup narrative and traps: [docs/remote.md](../remote.md).
