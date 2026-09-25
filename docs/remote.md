# Remote seat

The machine that runs jobs is not the machine you sit at.

A **seat** is one always-on host (typically a VPS on a Tailscale tailnet) that owns the Git checkouts, worktrees, and `.limen/jobs/`. Your laptop, phone, or studio Mac is a **window**: attach, look, type, leave. Closing the lid must not kill a worker.

This is operator guidance, not a provisioner. Limen does not install Tailscale or Herdr for you. The walkthrough we actually ran is [vps.md](vps.md). The numbered box checklist and leftover ntfy units live in [docs/seat/](seat/README.md).

## Two layers

| Layer | Role | What it is not |
|---|---|---|
| **Seat** | Runs `pi`, `limen`, optional Herdr; holds job files and worktrees | A second clone you `limen spawn` from |
| **Doorbell** | An opt-in GitHub App poller, isolated under its own Unix user, routes one exact PR comment to the project's persistent Herdr coordinator | A runner, a merge gate, or CI |

The App identity is seat-scoped; each project opts in with `limen github connect`. No inbound port or laptop consumer. Never install the private key in a checkout or in an account that runs hosted workers.

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

Do not: SSHFS the worktrees; run a coordinator on the laptop against a different disk; copy `.limen/` between machines; `limen spawn` from a laptop clone.

## Daily loop

1. **Direct agents** — Tailscale up, attach with `herdr --remote you@seat-name` (optional `--session` if the seat is not the default). Coordinator Pi runs *there*. Spawn only on the seat: `--detached` unless you are attached and intend to type. Close the window; jobs keep running. No Limen command needs the laptop awake.
2. **Judge** — wake, `limen jobs`, or `limen open`. Job files on the seat are truth; the footer can lag.
3. **See the product**
   - Usual: preview bound to localhost on the seat, published with `tailscale serve` — open that HTTPS URL. No pull.
   - Local feel (simulator, GPU, your browser profile): `git fetch` the **branch** into a disposable laptop clone and run the app. That clone is a viewer, not a Limen root.
4. **PR command** (after setup below) — an authorized collaborator comments exactly `/limen review` on an open PR; the seat prompts its registered coordinator, which starts a hosted review. `limen github status` shows the latest delivery; attach to inspect the actual job.
5. **Travel** — any tailnet device: attach, or just the preview URL.

## What you pull, and when

| Want | Do |
|---|---|
| Continue jobs, board, wakes | Attach to the seat. Do not pull `.limen/`. |
| Click the app the agent just built | Open the seat preview URL. |
| Device-specific UI | Pull the git branch to a normal clone. Do not `limen spawn` from it. |
| After merge | Pull `main` locally only if you still want a laptop checkout. |

## Bring up

Buy the box, then follow [vps.md](vps.md). Short version:

1. Ubuntu LTS, 8 GB RAM, ≥150 GB disk, Tailscale, SSH key only. Node 24, Git, `gh`, `pi`, Herdr, `limen` linked from a clone of this repo.
2. Clone the work **branch** (not only `origin/HEAD`). `limen init` in that checkout. Keys stay on the seat.
3. Bell: Moshi (`moshi-hook pair --store file`, `service install`, `loginctl enable-linger`). ntfy is fallback — [seat/](seat/README.md).
4. Persistent Herdr session on the box. Attach with `herdr --remote`. For the GitHub doorbell, the registered coordinator must stay available in that session; ordinary seat jobs may still run detached.
5. `tailscale serve` for previews. `limen prune` on a timer. No unattended reboot.

Do not move the coordinator until a detached job finishes with the lid closed and the phone rings. Do not run a coordinator on the Mac **and** the VPS during migration.

## Seat notes (stolen from the field, not required by Limen)

These are operational facts that keep a seat alive. They are not Limen features.

- Tailnet-only services; one public port at most (SSH break-glass). Bind app servers to `127.0.0.1`. Docker `-p` bypasses the host firewall unless you pin `127.0.0.1:`.
- Do not let unattended OS upgrades reboot the box under live jobs. Patch the kernel when you choose.
- Many worktrees will fill a small ext4 disk. Plan disk (btrfs reflinks, or accept the tax).
- `limen prune` belongs on a timer so finished checkouts do not accumulate.
- Two jobs on one repo still share whatever database you pointed them at. Files isolate; schema may not.
- Herdr/`tmux` is the layer that survives a GUI dying. A browser IDE is a viewer.

## Linux gaps

These change guarantees on a typical VPS seat. They are not a porting list.

- Process containment (F007) is macOS-shaped: Darwin process identity. `package.json` lists `linux`; the claim is “runs,” not containment parity.
- Hosted tabs (`--tab`, or spawn inside Herdr) already dropped it on every OS. Herdr owns that tree. Recorded on the job as `hosted`.
- On Linux, `limen stop` is best-effort and may write an `unavailable` cleanup note. Job files stay truth. Do not port a second identity stack unless stop-on-Linux actually hurts.

## Traps (will bite on day one)

- **Wake is not the bell.** Footer, toast, and `sendUserMessage` fire in the coordinator session *on the seat*. You are not looking at it. Moshi (`pair --store file` + linger) is the attention channel; ntfy is fallback. `host setup` is SSH/Mosh onto the box, not the hook. Do not wait for a Limen-owned notifier (`LIMEN_NOTIFY` does not exist).
- **Hosted on a seat remains an explicit choice.** Inside Herdr, `limen spawn` is hosted (`HERDR_ENV=1`). Ordinary unattended jobs may use `--detached`; the GitHub PR doorbell is different: it never falls back to detached when Herdr is unavailable.
- **`--tab` must start while the new tab is focused.** Herdr 0.8 will not launch an agent in a background pane (`not an available shell`, or a start that never lands). Limen focuses the new tab, starts `pi`, then restores the coordinator. First smoke on a seat is still `--detached`. Hosted tabs need `herdr integration install pi`.
- **Herdr `done` is unseen idle**, not process exit. On a seat you attach twice a day, so almost every tab reads `done`. Limen must not treat that as terminal (already true as of `c316fce`). A quiet think in a background tab is the same lie — no idle-after-tools timer. Complete on `session-ended` or a vanished agent. Do not “fix” `idle` vs `done` for headless.
- **A laptop clone is not a Limen root.** Attach; do not `limen spawn` from it. That is a second cabinet.
- **Checkout the work branch.** `origin/HEAD` plus `limen init` is a blank cabinet. `gh` on the box is HTTPS — do not `git@` unless you added a key. Do not copy `.limen/` to the laptop.
- **Two coordinators can double-deliver a wake.** A machine suspended mid-claim for over 30 s can produce a rare duplicate wake — at-least-once is the designed failure direction, not a bug to file.

## GitHub doorbell (opt in per project)

On the Alice VPS (SSH alias `alice`), **Alice** is the project checkout at `/home/overment/alice` (origin `https://github.com/iceener/alice.git`), not the Limen package checkout at `/opt/limen` and not a Mac clone. Its Herdr coordinator is Tony's persistent shepherding lane. Do not edit `alice/` to provision the doorbell. The root-owned `/opt/limen` poller and the coordinator's `limen` CLI must run the **same landed version**: deliberately update both when deploying or upgrading; mismatched claim and command protocols fail closed rather than being treated as a successful handoff.

Provision once **per seat**, as root. On the Alice VPS the worker/coordinator is `overment`; it must have **no sudo, wheel, or admin membership, no NOPASSWD rule, and no cached noninteractive sudo authority**. The old VPS recipe granted `overment ALL=(ALL) NOPASSWD:ALL`: run `rm /etc/sudoers.d/overment && gpasswd -d overment sudo` as root, audit `sudo -l -U overment`, and log out/in before connecting. A worker sharing that account can otherwise sudo-read any App key, regardless of its mode bits. Keep root administration on a separate SSH login/identity not available to hosted workers. `limen github connect` and `github deliver` refuse a privileged account.

The checked-in [root setup](seat/github-setup.sh) is the repeatable alternative to manually transcribing steps 2–6 below. On Alice, stop the timer before repairing any worker-owned binary; mode 0755 does not make worker-owned interpreter or Herdr code safe. The verified setup replaced both with root-owned Node 24 and Herdr 0.9.1. On future upgrades, stage trusted binaries under root-owned paths first. **Never** link the poller interpreter to `~overment/.nvm`, run `limen github poll` as a proof, or enable the timer until both binaries and their parents are root-owned and not group/other writable.

For Alice x86_64, stage the sources as root from official releases before setup (versions verified 2026-09-25). Compare the Node archive checksum with [Node's published list](https://nodejs.org/dist/v24.19.0/SHASUMS256.txt) and the Herdr digest with [its release asset](https://github.com/herdrdev/herdr/releases/tag/v0.9.1); never promote a worker-owned binary from `/usr/local/bin` into a trusted source:

```bash
install -d -o root -g root -m 0700 /root/install
curl -fsSL https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz -o /root/install/node.tar.xz
echo '14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647  /root/install/node.tar.xz' | sha256sum -c -
tar -xJf /root/install/node.tar.xz -C /root/install --strip-components=2 node-v24.19.0-linux-x64/bin/node
curl -fsSL https://github.com/herdrdev/herdr/releases/download/v0.9.1/herdr-linux-x86_64 -o /root/install/herdr
echo '2a02fed16beb651ef006e1d43f048f652ca4dc58ad053cd2d44450563d5c54b7  /root/install/herdr' | sha256sum -c -
chown root:root /root/install/node /root/install/herdr
chmod 0755 /root/install/node /root/install/herdr
```

```bash
# On the seat, root shell; never execute setup or units from a worker-writable checkout.
systemctl stop limen-github.timer limen-github.service
LIMEN_REV=<landed-40-hex-commit>
git clone https://github.com/overment/limen.git /root/limen-deploy # first run only
git -C /root/limen-deploy fetch origin "$LIMEN_REV"
git -C /root/limen-deploy checkout --detach "$LIMEN_REV"
# Trusted Node/Herdr sources and this installer now live only under root-owned directories.
WORKER=overment APP_ID=<numeric-app-id> PEM_SOURCE=/root/app.pem \
  LIMEN_REPO=https://github.com/overment/limen.git LIMEN_REV="$LIMEN_REV" \
  NODE_SOURCE=/root/install/node HERDR_SOURCE=/root/install/herdr \
  /root/limen-deploy/docs/seat/github-setup.sh
# From the Mac, verify a fresh noninteractive SSH shell finds the installed CLI:
ssh alice 'cd /home/overment/alice && command -v limen && limen github doctor'
# In a new login for overment, inside Alice's persistent Herdr coordinator:
cd /home/overment/alice
limen github connect             # if not already bound to this live pane
limen github doctor              # inspect all registered repositories; no PEM bytes
# As root only after every FIX line except the expected stopped timer has been repaired:
systemctl enable --now limen-github.timer
# In the coordinator again:
limen github doctor && limen github status
```

The setup requires the worker to have no sudo/admin grant; remove the old `overment` sudo rule first. It does not start the poller. A stopped timer is the expected doctor finding until the operator deliberately enables it; all other findings must pass first. Keep the CLI and `/opt/limen` at the same landed commit when upgrading. To add another repository on this seat: run `limen init` in that checkout (registry entry), rerun root setup for its traverse ACL, then `cd` there **in the same warm coordinator pane** and run `limen github connect` and `limen github doctor`. Both bindings may name the same pane; no second key, unit, or coordinator tab is needed. Reopen/reload that coordinator after a package upgrade so its guidance matches the new command contract.

1. Create a GitHub App for this seat, installed **only** on repositories this seat owns. Set repository permissions **Metadata: read, Issues: read and write, Pull requests: read** (and the GitHub collaborator-permission endpoint must return the actor's effective repository role). Disable webhooks; polling needs no inbound port. Record App ID; generate a private key. A second VPS gets its own App and key.
2. Install an immutable, root-owned Limen release at `/opt/limen` (`git clone` as root; the runtime has no npm dependencies, so the poller does not run `npm ci` or need npm in its PATH). Create Unix group and service user: `groupadd limen-github`; `useradd --system --home-dir /var/lib/limen-github --create-home --shell /usr/sbin/nologin --gid limen-github limen-github`; `usermod -aG limen-github overment`. Keep `/opt/limen` and every parent root-owned and not group/other writable. Polling refuses worker-owned code or an unsafe parent.
3. As root: `install -d -o root -g limen-github -m 0750 /etc/limen-github`; put the App PEM there **without first staging it in overment's home**, then `chown limen-github:limen-github /etc/limen-github/app.pem && chmod 0600 /etc/limen-github/app.pem`. Verify as the worker `test ! -r /etc/limen-github/app.pem` and as root `sudo -u limen-github test -r /etc/limen-github/app.pem`; stop if either fails. The worker may traverse this directory but cannot read the key. Do not give the worker the App key or an installation token in its environment, task, log, or worktree.
4. The poller reads the seat's existing project registry (`/home/overment/.limen/projects`). Grant `limen-github` traverse ACLs on `/home/overment`, each checkout parent, and each project root (`setfacl -m u:limen-github:--x /home/overment /path/to/project`); the registry must be readable. Project `.limen/` must already exist from `limen init`; `connect` gives the shared group access to only `.limen/github/` and read/traverse access to `.limen/`. Provision the authoritative state separately: `install -d -o limen-github -g limen-github -m 0700 /var/lib/limen-github/state`. Its parents must not be worker-writable. The poller refuses any other owner or group/other access; workers cannot read or write accepted claims or cursors. Do not put the key in the group-readable checkout.
5. Permit **only the poller** to check the coordinator and invoke the narrow Herdr handoff as its Unix account. A root-owned sudoers file (mode 0440, validate with `visudo -cf`) contains `limen-github ALL=(overment) NOPASSWD: /opt/limen/bin/limen github ensure *` and `limen-github ALL=(overment) NOPASSWD: /opt/limen/bin/limen github deliver *`. Give `overment` traverse-only ACL on `/etc/sudoers.d` so worker-side doctor can inspect the policy file metadata without reading its contents. This does **not** grant `overment` sudo. Install a root-owned `/etc/limen-github/poller.env` (0600) with `LIMEN_GITHUB_APP_ID=<numeric-id>`, `LIMEN_GITHUB_KEY_FILE=/etc/limen-github/app.pem`, `LIMEN_GITHUB_PROJECTS_FILE=/home/overment/.limen/projects`, `LIMEN_GITHUB_STATE_DIR=/var/lib/limen-github/state`, `LIMEN_GITHUB_WORKER_UID=<id -u overment>`, `LIMEN_GITHUB_LIMEN_BIN=/opt/limen/bin/limen`. Do not place private key bytes or a token in this file.
6. Install the checked-in [service](seat/limen-github.service) and [timer](seat/limen-github.timer) as root-owned files under `/etc/systemd/system/`. The service invokes `/usr/bin/node` explicitly, with a safe PATH for the narrow Herdr handoff. Install `acl` for `setfacl`; install root-owned Node 24 at `/usr/bin/node` and `/usr/local/bin/node`, and root-owned Herdr at `/usr/local/bin/herdr`. Expose the root-owned `/opt/limen/bin/limen` through a root-owned `/usr/local/bin/limen` symlink for fresh SSH shells. Run `systemctl daemon-reload`, but do not enable the timer until all doctor findings other than the stopped timer are repaired. One service invocation scans all registered projects; systemd serializes its timer. Inspect `journalctl -u limen-github.service` for failures.
7. In **each project's persistent Herdr coordinator** (with `LIMEN_COORDINATOR=1` and its own `HERDR_PANE_ID`), run `limen github connect` from its initialized Git checkout. This detects `origin`, writes a private, ignored `.limen/github/binding.json` and enables that repository for the already running seat timer. `limen github status` shows the binding and an explicitly unverified local handoff copy without credentials; authoritative receipts belong to the poller. A laptop clone has no registration and consumes nothing. For a move: `limen github disconnect` on the old seat **before** `connect` on the new seat; it removes the binding and waits for an in-flight poll. If `.limen/github/poll.lock` persists after a crash, inspect the old poller before clearing it or connecting elsewhere. Never copy `.limen/`.

**Live trial, after doctor passes on the seat:**

```bash
# Mac window: leave this connected to the existing seat coordinator; do not run limen in a Mac clone.
herdr --remote alice
# Mac GitHub CLI, as a write-authorized collaborator on an open PR:
gh pr comment <pr-number> --repo iceener/alice --body '@limen Please review this PR; do not edit the app.'
# `/limen` also wakes the coordinator; free text after either token is optional.

# Alice VPS, in /home/overment/alice:
limen github doctor
limen github status
limen github ensure              # warm interactive agent, including Herdr's done/idle state
limen jobs --all
# Root operator, only if diagnosing the service:
journalctl -u limen-github.service -n 50 --no-pager
```

`@limen` or `/limen` in a PR conversation comment reaches the registered coordinator; `@limenology` and issue-only comments do not. The App checks the author's effective write-or-higher role and the installed repository. A warm Herdr agent with `agent_status: done` and `interactive_ready: true` is live; a bare shell is not. The PR title, body, discussion, triggering text, real base/head and links are supplied as bounded, explicitly untrusted context. One coordinator may be registered by several projects on this seat.

The coordinator chooses a hosted review (`limen github review <root> <comment-id>` with explicit board model flags), a different hosted task (`limen github work … --task <instruction>`), or an explicit no-job answer (`limen github resolve …`). Review fetches and verifies the pinned PR head and real base; work uses a separate branch from the registered project, not a claim of having reviewed the PR. The poller posts a start reply only after observing a matching hosted job and a terminal reply after actual completion; prompt acceptance alone is never success. `done` does not mean approval.

No-job answer text is written under the coordinator's Unix identity, which hosted workers share. The poller's private nonce prevents a forged checkout claim from creating a new App request, but it does not authenticate that answer against a compromised worker account; the PR reply labels this limit and is never an approval.

Accepted claims and cursors live under `/var/lib/limen-github/state/<sha256-of-absolute-project-root>/`, private to the poller. `.limen/github/claims/<comment-id>.json` is a worker-readable status copy without the no-job nonce, never posting authority. A missing or rejected bare-shell coordinator gets one pending notice and a safe retry after it becomes live; an ambiguous accepted prompt is not automatically replayed. Inspect `limen github status`, `limen github doctor`, `limen jobs --all`, and the coordinator tab before deliberate recovery. If the handoff is truly unresolved, submit a new mention rather than deleting private state; a moved PR head/base needs a new review request. No detached fallback, automatic approval, or merge.

## When you come back

1. Buy and walk through [vps.md](vps.md). Ubuntu LTS, 8 GB / 150 GB+, public SSH key-only, Tailscale MagicDNS.
2. Pair Moshi on the box (`--store file`, linger) **before** moving the coordinator. ntfy only if Moshi is out.
3. Node 24, Git, `gh`, `pi`, Herdr, `limen` (`npm link` from `~/limen`). Checkout the work branch. `limen init`.
4. Persistent Herdr session. `herdr --remote alice` (or your `Host` alias). First smoke: `--detached`.
5. Prove, in order: lid-closed `--detached` job → phone rings → `limen jobs` on attach shows the same id → `tailscale serve` preview opens on the Mac.
6. Only then live on the seat. The opt-in PR doorbell needs the separate App-user setup above; `LIMEN_SPAWN=detached` and `LIMEN_NOTIFY=` remain unbuilt seat conveniences.

## Related

- [Vision](../spec/vision.md) — durable intent, including the seat/window split.
- [F013 remote seat](../spec/features/done/2026-09/F013-remote-seat/ticket.md) — shop manual names seat vs window; Linux containment port is still out of scope.
- [SECURITY.md](../SECURITY.md) — `pi --approve` is still you, wherever the seat is.
