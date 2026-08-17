# VPS walkthrough

What we actually did to stand up an always-on host. Flow and traps: [remote.md](remote.md). Checklist and leftover ntfy units: [seat/](seat/README.md).

Limen does not run this. The box is a plant (any product). Limen is a tenant you add later.

## Buy

- Ubuntu LTS, **8 GB RAM**, **≥ 150 GB disk**, 2+ vCPU. 4 GB / 50 GB dies under two agents + a TS server.
- **Basic / shared CPU**, not CPU-Optimized. Agents are bursty RAM + worktree disk, not dedicated cores.
- Region close to you. One public port: SSH, key only.
- Hostname of the *box*, not `limen`. Example: `alice`.
- GitHub runners and public APIs stay off this machine.

## 0 · SSH key and first login

On the laptop, a dedicated ed25519 (do not reuse a project key):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/alice -C "alice@$(hostname -s)" -N ""
cat ~/.ssh/alice.pub
```

Paste the **public** line into the provider. Never paste the private file.

```
Host alice
  HostName PROVIDER_PUBLIC_IP
  User root
  IdentityFile ~/.ssh/alice
  IdentitiesOnly yes
```

```bash
ssh alice   # as root, once
```

## 1 · Non-root user

As **root** on the box:

```bash
adduser --disabled-password --gecos "" overment
usermod -aG sudo overment
echo 'overment ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/overment
chmod 440 /etc/sudoers.d/overment

mkdir -p /home/overment/.ssh
cp /root/.ssh/authorized_keys /home/overment/.ssh/authorized_keys
chown -R overment:overment /home/overment/.ssh
chmod 700 /home/overment/.ssh
chmod 600 /home/overment/.ssh/authorized_keys

ufw allow OpenSSH
ufw --force enable

printf 'Unattended-Upgrade::Automatic-Reboot "false";\n' \
  > /etc/apt/apt.conf.d/51-no-auto-reboot
```

On the laptop, change `User root` → `User overment`. Keep a **second** terminal that can still reach root until this works:

```bash
ssh alice
whoami          # overment
sudo -n true
```

`ssh alice` still landing as `root` means the config was not saved. Root break-glass: `ssh -i ~/.ssh/alice root@PUBLIC_IP`.

## 2 · Tailscale

On the box as the non-root user:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Open the printed URL on the laptop, approve the node, name it to match the hostname.

```bash
# box
tailscale status
tailscale ip -4

# laptop
tailscale status
```

Laptop, box, and phone must all list each other. Then point SSH at MagicDNS, not the public IP:

```
Host alice
  HostName alice.YOUR_TAILNET.ts.net
  User overment
  IdentityFile ~/.ssh/alice
  IdentitiesOnly yes
```

First connect to a new name needs a new known_hosts line (`StrictHostKeyChecking=accept-new` once). Public IPv4 stays break-glass only.

## 3 · Moshi (the bell)

Skip ntfy if Moshi already reaches the phone. Herdr toasts on the box stay on the box; Moshi is what rings the phone.

The Mac `moshi-hook` binary is Darwin. Do **not** `scp` it. GitHub raw install.sh may 429 — use the CDN:

```bash
cd /tmp
curl -fL -o moshi.tgz https://cdn.getmoshi.app/hook/v0.2.73/moshi-hook_Linux_x86_64.tar.gz
sudo tar -xzf moshi.tgz -C /usr/local/bin moshi-hook
sudo ln -sfn /usr/local/bin/moshi-hook /usr/local/bin/moshi
moshi-hook version
```

`moshi-hook pair --token PASTE_TOKEN` fails on purpose — that string is a placeholder. Token comes from the iPhone app (Settings → Integrations / new host). Do not put it in chat.

Two Moshi verbs, do not confuse them:

| Command | What it is |
|---|---|
| `moshi-hook host setup` | Phone can **SSH/Mosh onto** the box |
| `moshi-hook pair --store file` | Phone gets **hook / approval / done** pings |

`host setup`: pick **MagicDNS**, not a `10.x` VPC address (the phone cannot route there). It requires `mosh`:

```bash
sudo apt-get update
sudo apt-get install -y mosh
moshi-hook host setup
```

Then pair (Linux has no Keychain):

```bash
moshi-hook pair --store file --name alice --token THE_REAL_TOKEN
moshi-hook install --target pi
moshi-hook service install
loginctl enable-linger "$USER"    # daemon survives SSH logout
moshi-hook status                 # must say paired; daemon running
```

`status` saying `unpaired` + `no HostID` means the daemon is socket-only. Phone SSH can work while the bell does not.

## 4 · First repo (not done in this pass)

One clone. Not five. Coordinator stays on the laptop until prove 1–2–3.

```bash
# still missing on the box: Node 24, Git, gh, pi, Herdr, limen
# then: clone ONE repo, limen init
# keys (model, gh) live only here — same identity as the laptop
```

Path convention we intended: `/home/overment/<product>`.

## 5 · Prove, then live here

1. Detached job finishes with the laptop lid closed; phone rings (Moshi).
2. `herdr --remote overment@alice.YOUR_TAILNET.ts.net` → `limen jobs` shows that id.
3. App bound to `127.0.0.1` + `tailscale serve` → HTTPS URL on the laptop. No `git pull`.

Until 1 works, do not move the coordinator. Do not run coordinators on both disks.

## Traps we hit

- CPU-Optimized / Premium Intel on DigitalOcean: wrong SKU, often out of stock, 50 GB disk, 5–8× the price.
- `ssh alice` after creating `overment` still as root: `User` in `~/.ssh/config`.
- New Tailscale / MagicDNS name: host key verification failed until accepted once.
- GitHub 429 on Moshi’s install.sh: CDN tarball instead.
- Darwin `moshi-hook` will not run on the VPS.
- `host setup` is not `pair`. `mosh` ≠ Moshi.
- systemd user service dies on SSH logout without `enable-linger`.
- `--tab` on Herdr 0.8 needs a tab that has been focused once (Limen now primes this). First smoke on a seat is still `--detached`.

## Not on this box

GitHub Action runners, `tailscale funnel`, extra public ports, a second `.limen/` on the laptop.
