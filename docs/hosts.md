# Host pool

The seat stays one disk. Coordinators, Herdr, Moshi wakes, the Claude account rotator, and `.limen` stay on the mini. A **host** only runs Pi for a job the seat handed it.

With no `~/.limen/hosts.json`, `limen spawn` and `limen continue` behave exactly as they do today. Nothing dials out.

```
Mac mini (seat)                         MacBook Pro or Windows laptop (host)
───────────────                         ─────────────────────────────────────
.limen/jobs, start queue, wakes         no .limen that the seat trusts
git push of the job branch      ──ssh─► worktree + Pi --mode json
stream parser, logs, activity   ◄─ssh── Pi's JSON stdout
fetch, fast-forward, finalize           worktree removed when the job ends
limen stop  ──ssh kill──►               the Pi process
```

Do not `limen spawn` from a clone on the laptop. That would be a second cabinet. The laptop is a worker, the way a Devin session is a worker: the wrapper that owns the job never leaves the seat.

## Config

`~/.limen/hosts.json` (or `LIMEN_HOSTS_FILE`):

```json
{
  "overflow": false,
  "hosts": [
    {
      "alias": "mbp",
      "ssh": "ada@mbp",
      "platform": "darwin",
      "root": "/Users/ada/src/limen-sandbox",
      "hook": "/Users/ada/src/limen/hook",
      "maxConcurrent": 2,
      "enabled": true,
      "path": "/opt/homebrew/bin:/usr/local/bin"
    },
    {
      "alias": "win",
      "ssh": "ada@laptop",
      "platform": "windows-wsl",
      "distro": "Ubuntu",
      "root": "/home/ada/src/limen-sandbox",
      "hook": "/home/ada/src/limen/hook",
      "maxConcurrent": 1,
      "enabled": true,
      "path": "/usr/local/bin"
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `alias` | Short lowercase name for `--host`. |
| `ssh` | What the seat passes to `ssh`. Prefer an entry in `~/.ssh/config` (`Host mbp`). No spaces. |
| `platform` | `darwin` or `windows-wsl`. |
| `root` | Absolute POSIX path of a clone of the **same** repo on that host. On Windows this is the path **inside** Ubuntu, not a `C:\` path. |
| `hook` | Absolute POSIX path of this package's `hook/` on that host. Pi loads `finish.ts`, `steering.ts`, and `communication.ts` from it. |
| `maxConcurrent` | How many seat jobs may run there at once. |
| `enabled` | `false` keeps the entry but never selects it. Omitted means true. |
| `distro` | WSL distribution. Omitted means `Ubuntu`. Ignored on darwin. |
| `path` | Optional directories prepended to `PATH` for the job. Non-interactive ssh does not load zshrc or nvm. |
| `overflow` | Top-level. `true` lets the seat send a job to a free host when the **local** start gate is closed. Omitted or `false` means only an explicit `--host` leaves the seat. |

A bad file fails the job that tries to read it, with the path in the message. A missing file is not an error.

Send one job:

```bash
limen spawn --host mbp "Implement the slice. Ticket: spec/features/active/FNNN-slug/ticket.md"
limen spawn --host mbp --review --detached --branch <candidate> --label review "Review the candidate against the ticket."
limen continue <id> "follow-up" --host mbp
```

`--host` is detached Pi only. It refuses `--tab`, `--engine omp`, `--engine devin`, and a group launch. The seat still creates the local worktree and the job folder. `limen jobs <id>` shows `host <alias>` once the wrapper has reserved a slot.

Overflow, when `overflow` is true: the wrapper samples the seat. If the start gate would hold the job, it probes each enabled host (a short CPU sample, and on a Mac `memory_pressure` when the probe runs natively). A host is eligible when it is under `maxConcurrent` and its reading clears the same gate (default 25% CPU idle, 20% memory free). The freest host wins. If none qualifies, the job waits in the seat queue as usual. `LIMEN_HOST_READING` is a JSON file-less override of that probe (`{"cpuIdle":80,"memoryFree":80}`), for a trial or a test. `LIMEN_HOST_PROBE_MS` is the sample length (default 400).

## What each host needs

The host is not a seat. It does not run Herdr, Moshi, the GitHub doorbell, or the account rotator.

- Tailscale or the LAN, and an ssh key the seat already has. From the mini, `ssh <target>` once so `known_hosts` has the key. Batch mode is on; a prompt means the job fails.
- Node 24 on the **non-interactive** PATH (`ssh host node -v` must print v24, not "command not found").
- `git` and `pi` on that same PATH.
- Pi's `~/.pi/agent`, including the same `pi-claude-bridge` (or `claude-bridge`) install the seat uses. A bridged model looks the bridge up on the host, under `~/.pi/agent/npm/node_modules`.
- Claude Code CLI logged in **on that host** (`claude` / the bridge's login). The seat's login is not copied across.
- A clone of Limen at the `hook` path, the same revision the seat is running. Hooks import the package next to them.
- Git credentials that can `git fetch` and `git push` to HorizonFlex GitHub repos over HTTPS or ssh. The job branch is pushed by the seat, fetched on the host, and pushed back by the host when Pi exits.
- The clone at `root` stays on a branch that is not a job branch (`main` is right). The host creates a worktree beside it, the same way the seat does.
- For review jobs: Python 3.13 and Playwright's Chromium, if the review runs the browser. Install them inside the same environment Pi sees (on Windows, inside Ubuntu).

`path` covers Homebrew (`/opt/homebrew/bin`), a Node tarball in `/usr/local/bin`, and `~/.local/bin`. Use absolute paths. The job does not source `.zshrc` or `.bashrc`, so a login banner cannot corrupt Pi's JSON stream.

## MacBook Pro

On the MacBook:

```bash
# Node 24, git, and pi visible to non-interactive ssh. Prove it from the mini, not in Terminal.app.
ssh mbp 'echo "$PATH"; node -v; git --version; command -v pi'
```

If `node` is missing over ssh, install the Node 24 tarball (or Homebrew) and either symlink `node`, `git`, and `pi` into `/usr/local/bin` or set `path` in the hosts entry. Homebrew on Apple silicon is `/opt/homebrew/bin`.

```bash
# Claude Code and the bridge, in this user's account.
# Install Pi the same way as on the seat, then the bridge package the seat's Pi has.
pi install  # whatever you used on the mini; the host needs ~/.pi/agent to match
claude      # log in once; the bridge reads this account

git clone https://github.com/HorizonFlex/limen.git "$HOME/src/limen"
# Check out the revision the seat is running.

git clone git@github.com:HorizonFlex/limen-sandbox.git "$HOME/src/limen-sandbox"
cd "$HOME/src/limen-sandbox" && git checkout main

# Review jobs that drive a browser:
python3.13 -m pip install playwright && python3.13 -m playwright install chromium
```

On the mini, `~/.ssh/config`:

```
Host mbp
  HostName mbp.tailnet.ts.net
  User ada
  IdentityFile ~/.ssh/id_ed25519
```

`ssh mbp true` once. Then the `mbp` entry in `hosts.json` as above, with `root` and `hook` pointing at those clones.

## Windows laptop (WSL2)

The laptop runs Ubuntu under WSL2. Windows OpenSSH is the door. The job command is `wsl.exe -d Ubuntu -- bash -c …`, so the script, Pi, git, and the kill signal all run **inside Ubuntu**. Paths in `hosts.json` are Ubuntu paths. You do not point `root` at `C:\Users\...`.

Windows side, once:

1. Install WSL2 and Ubuntu: `wsl --install -d Ubuntu` (or the Microsoft Store Ubuntu). Reboot if Windows asks.
2. Install the Windows OpenSSH server. Settings → System → Optional features → OpenSSH Server, or:

   ```powershell
   Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
   Start-Service sshd
   Set-Service -Name sshd -StartupType Automatic
   ```

3. Confirm the seat can ssh to the Windows user (`ssh ada@laptop`). The default shell on the far side is `cmd.exe`. That is expected. Limen wraps the job in `wsl.exe` itself. You do not have to change the OpenSSH default shell.
4. Leave the laptop awake for the trial (see [Limitations](#limitations)).

Inside Ubuntu:

```bash
# Node 24 on the default non-login PATH. wsl.exe does not source nvm.
# A tarball unpacked to /usr/local is the reliable layout:
curl -fsSL https://nodejs.org/dist/v24.11.0/node-v24.11.0-linux-x64.tar.xz -o /tmp/node.tar.xz
sudo tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
node -v   # v24.x

sudo apt update && sudo apt install -y git python3.13
# Pi: install the same way as the seat, into a directory on the non-login PATH
# (for example a symlink in /usr/local/bin). Then the bridge and Claude Code login,
# as on the MacBook, but in this Ubuntu home.

git clone https://github.com/HorizonFlex/limen.git "$HOME/src/limen"
git clone git@github.com:HorizonFlex/limen-sandbox.git "$HOME/src/limen-sandbox"

python3.13 -m pip install playwright && python3.13 -m playwright install chromium
# Playwright's Linux dependencies, if install asks: sudo python3.13 -m playwright install-deps chromium
```

From the mini, this must print v24 before you send a job. It is the command Limen will use, not an interactive Ubuntu terminal:

```bash
ssh ada@laptop "wsl.exe -d Ubuntu -- node -v"
ssh ada@laptop "wsl.exe -d Ubuntu -- bash -lc 'command -v pi && command -v git'"
```

If `node` is only on PATH after nvm starts, set `path` to the nvm node `bin` directory (an absolute Ubuntu path) or symlink `node` and `pi` into `/usr/local/bin`.

`distro` must match `wsl.exe -l -q` on the laptop (`Ubuntu`, `Ubuntu-24.04`, …). The default is `Ubuntu`.

## Smoke test (limen-sandbox)

On the seat, in a checkout of `HorizonFlex/limen-sandbox` that already has `origin` and a Limen cabinet (`limen init` has been run there, not on the laptop):

```bash
# Seat: one host, no overflow, so only this flag leaves the mini.
limen spawn --host mbp --label sandbox-smoke "Add a file SMOKE.txt containing the word pong. Commit it on this branch. Do not open a pull request."
```

Watch the seat, not the laptop:

```bash
limen jobs <id>
# `host mbp` while it runs. The log grows from Pi's JSON stream.
limen wait <id>
```

A finished smoke looks like this:

- The job on the seat is `done`, with a result written from the host's `finish` hook.
- The seat worktree fast-forwarded to the commit the host pushed.
- The host's worktree for that id is gone (`../*-limen-worktrees/<id>`).
- `limen jobs` on the laptop's clone does not show the job. The laptop has no cabinet.

Repeat with `--host win` after the WSL checks above. Then one review, if the sandbox has a branch to read:

```bash
limen spawn --host mbp --review --detached --branch <branch> --label sandbox-review \
  "Read the branch. Do not edit. Say what the diff does."
```

Stop in the middle of a longer job and confirm the host's Pi is gone:

```bash
limen stop <id> enough
ssh mbp 'pgrep -af "limen: sandbox" || echo stopped'
```

## How a job moves

1. The seat creates the job folder and the local worktree, as always, and prints the id.
2. The wrapper pushes `limen/<id>` (or the review branch) to `origin`.
3. Over ssh it fetches that branch, adds a worktree, and writes a minimal `.limen/jobs/<id>/` so the hooks have a folder. `finish` does nothing when that folder is missing; creating it is what makes the handoff stick.
4. Pi runs `--mode json` in the worktree. Stdout is parsed on the seat with the same stream parser as a local job, so `log`, `activity`, and `last-tool` update on the mini.
5. On exit the host pushes the branch. The seat copies `result`, `session-ended`, and `session/` back, fetches, and fast-forwards the local worktree (a detached review updates the branch ref too).
6. `finalizeJob` runs on the seat. The coordinator wake is the normal one. The host worktree and the temporary job folder are removed.

`limen stop` signals the seat wrapper, which ssh's `kill` for the recorded pid and its children, then finalizes `stopped` on the seat. The wrapper has about four seconds before `limen stop` records the terminal state itself, and five before the process group is killed. That is the same budget a Devin session gets.

Steers written on the seat (`limen steer`, and the timeout warning) are copied to the host's inbox every second (`LIMEN_HOST_STEER_MS`). When the host's hook delivers one, the seat moves its copy to `steer/delivered`. Seat-only extension paths in `extensions.json` are not loaded on the host; the log says so. The three Limen hooks come from `hook`.

## Limitations

- **Claude accounts.** Rotation lives only on the seat. A host uses whatever Claude Code login is on that machine. Pointing every host at the same account burns the limit faster, because the rotator cannot see the host's traffic. Two follow-ups, neither in this proof: pass the seat's active account (a `CLAUDE_CONFIG_DIR` the seat exports, or a short-lived token) into the remote environment, or give each host its own `account` in `hosts.json` and accept that those accounts are outside the rotator. Until then, set the host's own login and watch the limit.
- **Steers.** Inbox sync is polled, not instant. A host that is asleep keeps the steer in the seat inbox until a later poll. Delivery still happens on the host, because that is where Pi is.
- **Sleep.** A closed laptop fails the ssh connect (20s) or the server-alive check (about a minute) and the job is `failed`. Wake the machine, or disable that host, before you send it work. Overflow skips a host that does not answer and leaves the job on the seat queue.
- **Liveness.** Stall detection and `limen stop`'s escaped-child search see the ssh client on the seat, not Pi's children on the host. A tool that hangs inside Pi is not reaped by the seat's CPU-idle watch. `limen stop` kills the recorded pid and its direct children (`pkill -P`); a deeper grandchild can survive. The log's activity is real (it is Pi's stream). A picture that keys off the local process tree will show the ssh client.
- **Branches.** The seat pushes `limen/<id>` to `origin` and the host pushes it again. Nothing deletes that remote branch when the job ends. Prune and land on the seat do not know about the host. Delete stale `limen/*` branches on the remote when you delete them locally.
- **Seat extensions and prepare.** `--extension` paths stay on the seat. `--prepare` runs on the seat worktree before the push, and it is not committed for you, so a prepare that only edits the worktree does not reach the host.
- **Groups, tabs, OMP, Devin.** Not on a host. Group members share a deadline and a cabinet on the seat. A hosted Herdr tab is a person typing on the seat.
- **Wrapper death.** If the seat wrapper dies, the host's Pi can keep running until someone kills it. The seat reaper does not have a remote pid. The job looks dead on the seat while the laptop is still busy.
- **Argument size.** The script travels on ssh's stdin, so the task can be large. The session upload and the handoff copy are base64 in that stream. A huge session makes a huge copy; it is not chunked.
- **One repo per host entry.** `root` is one clone. A second repo needs a second alias (or a later config shape). Workspace `--repo` jobs use the seat's layout and are not remapped.

`LIMEN_SSH` overrides the ssh binary. The tests point it at a fake. Leave it unset on the seat.
