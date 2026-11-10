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
      "roots": {
        "HorizonFlex/agent-pipeline": "/Users/ada/src/agent-pipeline",
        "https://github.com/HorizonFlex/jira-ops.git": "/Users/ada/src/jira-ops",
        "HorizonFlex/JiraOrchestrator": "/Users/ada/src/JiraOrchestrator"
      },
      "hook": "/Users/ada/src/limen/hook",
      "maxConcurrent": 2,
      "enabled": true,
      "path": "/opt/homebrew/bin:/usr/local/bin",
      "model": "claude-bridge/claude-sonnet-5-5"
    },
    {
      "alias": "win",
      "ssh": "ada@laptop",
      "platform": "linux",
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
| `platform` | `darwin`, `linux`, or `windows-wsl`. `linux` is ssh straight into bash (a Mac is `darwin`; WSL sshd is `linux`). |
| `root` | Optional shorthand for one clone. Absolute POSIX path on that host (inside Ubuntu on Windows, not a `C:\` path). The seat reads that clone's `origin` and uses the path only for a job from the same repo. |
| `roots` | Optional map of origin to clone. Each key is an `owner/repo` name or the remote url (`https://github.com/HorizonFlex/jira-ops.git` and `HorizonFlex/jira-ops` are the same repo). The value is an absolute POSIX path of that repo's clone on the host. A host needs `root`, `roots`, or both. One origin is listed once. |
| `hook` | Absolute POSIX path of this package's `hook/` on that host. Pi loads `finish.ts`, `steering.ts`, and `communication.ts` from it. |
| `maxConcurrent` | How many seat jobs may run there at once. |
| `enabled` | `false` keeps the entry but never selects it. Omitted means true. |
| `distro` | WSL distribution for `windows-wsl`. Omitted means `Ubuntu`. Ignored on darwin and linux. |
| `path` | Optional directories prepended to `PATH` for the job. Non-interactive ssh does not load zshrc or nvm. |
| `model` | Used when `--model` is omitted. A bridged id such as `claude-bridge/claude-sonnet-5-5` is resolved on the host. Omitted means the seat default, which the host may not be logged into. |
| `overflow` | Top-level. `true` lets the seat send a job to a free host when the **local** start gate is closed. Omitted or `false` means only an explicit `--host` leaves the seat. |
| `pruneBranches` | Top-level. `true` deletes `origin/limen/<id>` after that host job fast-forwards. Omitted means leave the branch; `limen hosts prune` deletes it later. |

A bad file fails the job that tries to read it, with the path in the message. A missing file is not an error.

Send one job:

```bash
limen spawn --host mbp "Implement the slice. Ticket: spec/features/active/FNNN-slug/ticket.md"
limen spawn --host mbp --review --detached --branch <candidate> --label review "Review the candidate against the ticket."
limen continue <id> "follow-up" --host mbp
```

`--host` is detached Pi only. It refuses `--tab`, `--engine omp`, `--engine devin`, and a group launch. The seat does not need `pi` on its own PATH for that job: before the record exists it asks the host, over the same BatchMode ssh, whether `pi` is on the host PATH and whether a bridged model has `pi-claude-bridge` under the host's `~/.pi/agent/npm`. A job that might still run on the seat (no `--host`) keeps the local check. The seat still creates the local worktree and the job folder. `limen jobs`, `limen status`, and `limen jobs --json` name the machine (`on win`, or `on mini` / `on seat` locally). `limen queue` lists each host's reach, load, and whether overflow is on.

Host stderr in the job log is prefixed with `[alias]`, one line at a time. The seat's own push is a separate line from the host's fetch and worktree. A `git fetch` complaint is a host line, not a failed push on the mini.

The seat matches the job's origin (`git remote get-url origin` in that project) to a host clone. `roots` matches the key. `root` matches only after the seat reads that clone's origin over ssh. A host with no clone of the project is never an overflow candidate. `--host` refuses before a job record exists, and the message names the origin and the clones that host does have. A jira-ops job does not run in an agent-pipeline clone.

Overflow, when `overflow` is true: the wrapper samples the seat. If the start gate would hold the job, it keeps the hosts that have a clone of this project and probes those (a short CPU sample, and on a Mac `memory_pressure` when the probe runs natively). A host is eligible when it is under `maxConcurrent` and its reading clears the same gate (default 25% CPU idle, 20% memory free). The freest host wins. If none of those hosts is free, the job waits in the seat queue as usual. If none has this repo, the log says `none have a clone of <origin>` and the job stays on the seat too. `LIMEN_HOST_READING` is a JSON file-less override of that probe (`{"cpuIdle":80,"memoryFree":80}`), for a trial or a test. `LIMEN_HOST_PROBE_MS` is the sample length (default 400).

## What each host needs

The host is not a seat. It does not run Herdr, Moshi, the GitHub doorbell, or the account rotator.

- Tailscale or the LAN, and an ssh key the seat already has. From the mini, `ssh <target>` once so `known_hosts` has the key. Batch mode is on; a prompt means the job fails.
- Node 24 on the **non-interactive** PATH (`ssh host node -v` must print v24, not "command not found").
- `git` and `pi` on that same PATH.
- Pi's `~/.pi/agent`, including the same `pi-claude-bridge` (or `claude-bridge`) install the seat uses. A bridged model looks the bridge up on the host, under `~/.pi/agent/npm/node_modules`.
- Claude Code CLI logged in **on that host** (`claude` / the bridge's login). The seat's login is not copied across.
- A clone of Limen at the `hook` path, the same revision the seat is running. Hooks import the package next to them.
- Git that can `git fetch` and `git push` the job branch. The seat pushes first. For a GitHub origin, the seat asks the token broker for an installation token and the host uses that for its fetch and push. Without a broker, the host uses its own credentials.
- Each clone in `root` or `roots` stays on a branch that is not a job branch (`main` is right; not `limen/<id>`, and not detached). The host creates a worktree beside the clone whose origin is the job's project, the same way the seat does.
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

The laptop runs Ubuntu under WSL2. Paths in `hosts.json` are Ubuntu paths. You do not point `root` at `C:\Users\...`.

An Azure AD (Entra) account cannot use key authentication with Windows OpenSSH. The server answers `unable to get security token for user azuread\...` and the key never gets that far. Do not use that door. Run sshd inside Ubuntu, with keys only, and publish it on the tailnet:

```bash
# Inside Ubuntu, once.
sudo apt update && sudo apt install -y openssh-server
sudo ssh-keygen -A
# sshd in WSL does not use port 22 if Windows already owns it. 2222 stays inside Ubuntu.
sudo tee /etc/ssh/sshd_config.d/limen.conf >/dev/null <<'EOF'
Port 2222
PasswordAuthentication no
PubkeyAuthentication yes
EOF
sudo service ssh start
```

From Ubuntu, `tailscale serve --tcp 2222 tcp://localhost:2222` publishes that port on the tailnet. WSL's sshd dies when the distro stops, so a Windows logon task keeps it up. Task Scheduler, at log on, hidden:

```powershell
wsl.exe -d Ubuntu sleep infinity
```

On the mini, `~/.ssh/config`:

```
Host laptop
  HostName laptop.tailnet.ts.net
  User ada
  Port 2222
  IdentityFile ~/.ssh/id_ed25519
```

`ssh laptop true` lands in Ubuntu bash. The hosts entry uses `"platform": "linux"`. Load is read from `/proc/meminfo` (MemAvailable), not macOS `memory_pressure`.

`windows-wsl` is the other door: ssh to Windows OpenSSH, then `wsl.exe -d Ubuntu`. Use it only for a local Windows account that accepts keys. The remote command is base64 with no `$` in it, so it does not matter whether that OpenSSH default shell is cmd.exe or PowerShell. PowerShell would expand `$(mktemp)` inside the double quotes a cmd-shaped command used to use. `distro` must match `wsl.exe -l -q` (`Ubuntu`, `Ubuntu-24.04`, …). The default is `Ubuntu`.

Inside Ubuntu, for either door:

```bash
# Node 24 on the default non-login PATH. A non-interactive ssh does not source nvm.
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
ssh laptop 'node -v; command -v pi; command -v git'
```

If `node` is only on PATH after nvm starts, set `path` to the nvm node `bin` directory (an absolute Ubuntu path) or symlink `node` and `pi` into `/usr/local/bin`. Leave the laptop awake for the trial (see [Limitations](#limitations)).

## Credentials on a Mac host

Non-interactive ssh does not unlock the macOS login keychain. `gh`, Git HTTPS, and Claude Code then fail with `User interaction is not allowed` (keychain error `-25308`). A Terminal.app window on the laptop is not the session the job gets.

Give Git and `gh` a file credential, not the keychain:

```bash
# On the MacBook, in the account ssh lands in.
gh auth login
gh config set git_protocol https
gh auth setup-git
# gh 2.40 and later can keep the token in a file instead of the keychain:
gh auth login --insecure-storage
git config --global credential.helper 'cache --timeout=1'
# or a store file the ssh user can read, mode 0600:
git config --global credential.helper store
```

`--insecure-storage` writes the GitHub token under the user's config instead of the keychain. `git credential.helper store` writes `~/.git-credentials` (mode 0600). Do not point those files at a world-readable path. Confirm from the mini, not from Terminal.app:

```bash
ssh -o BatchMode=yes mbp 'git -C ~/src/limen-sandbox ls-remote origin HEAD'
```

Claude Code's own keychain login is not something Limen can read. On the seat or the host, a login that lives only in the macOS keychain is invisible to a host job. `limen hosts check mbp` prints the host's `claude auth status` text, and when that text is error `-25308` it adds the keychain hint.

## The seat's Claude account

Host jobs bill a **file token on the seat**, not the Mac mini's keychain and not a login stored on the laptop. Limen does not call `security` and does not read the login keychain. A seat whose only Claude Code login is that keychain gets `no seat Claude account`.

Put the token in a file. On the mini:

```bash
mkdir -p ~/.claude-accounts
chmod 700 ~/.claude-accounts
claude setup-token
# The command prints one line, sk-ant-oat01-... . Save that line and nothing else.
# The file is flat, beside active: acc4.token, not acc4/token. That is what the seat rotator writes.
umask 077
printf '%s\n' 'sk-ant-oat01-...' > ~/.claude-accounts/acc4.token
chmod 600 ~/.claude-accounts/acc4.token
printf '%s\n' acc4 > ~/.claude-accounts/active
```

`active` is one line, the account name. The token is `~/.claude-accounts/<name>.token`. Switching accounts is rewriting `active` (the live test moved from `acc4` to `acc5` that way). A directory `~/.claude-accounts/<name>/token` is only a fallback. `claude-account-rotate` does not print a token; its commands are check, dry-run, status, coordinators, mark, and clear. Limen reads the files the rotator updates. A credentials file `~/.claude/.credentials.json` (`claudeAiOauth.accessToken`) is used only when those files are absent. `LIMEN_CLAUDE_ACCOUNTS` points at another directory and, when set, is the only source.

At the start of each host job, and again at `limen continue --host`, the seat reads that token.

The token goes to the host on ssh's stdin, into a `0600` file under `/tmp`, then into `CLAUDE_CODE_OAUTH_TOKEN` for that Pi process only. The file is removed before Pi is exec'd, and again when the worktree is cleaned up. It is not an ssh argument, not a job-log line, and not left on the host. The log names the account (`seat Claude account work for this job`) and never the token.

A quota swap while Pi is already running does not retarget that process. The next `limen continue --host` reads the rotator again and sends the new token. A job with no seat account still runs, and the host's own login is what Claude Code uses; the log says so.

## GitHub identity on a host

Commits on a host job use the seat checkout's repo-local `user.name` and `user.email` (the bot, when that is what the seat clone records). A broker JSON line `{"token","name","email"}` overrides that pair. The name is a log line. The token is not.

The App key stays with the `limen-github` user. Limen does not read it. For a job whose origin is `github.com/owner/repo` it runs:

```bash
sudo -n -u limen-github -- node /usr/local/libexec/limen-token-broker.mjs owner/repo
```

`LIMEN_GITHUB_BROKER` points at another script. The broker's stdout is only the installation token, or one JSON object with `token` and optional `name` and `email`. Anything else it prints goes to stderr. A missing file, or a repo that is not on github.com, skips this and the host uses its own git credentials. The log says which.

The token goes over ssh stdin into a `0600` file under `/tmp`, then into `GH_TOKEN` for that job only. A git credential helper answers `x-access-token` from that variable, and `git@github.com:` is fetched as `https://github.com/` for that process, so the host's personal `gh` token is not what pushes. The file is removed before Pi starts, and again when the worktree is cleaned up. It is not an ssh argument and not a log line. The helper is process config (`GIT_CONFIG_*`), not a line written into the host's git config.

## Check and prune

```bash
limen hosts check mbp
limen hosts prune --dry-run
limen hosts prune
```

`check` uses BatchMode ssh. It must find `node`, `pi`, and the configured `hook/finish.ts`. It lists every clone (`root` and each `roots` path) and checks that the clone's origin matches the configured repo, that `git ls-remote origin HEAD` works, and that the checkout is on a non-job branch. A mismatch looks like `root fail <path> origin is foo/bar, want horizonflex/jira-ops`. A job branch looks like `root fail <path> on job branch limen/<id>`. It also runs `claude auth status` and prints that command's own output, so a failure is `claude fail` plus the reason (for example `User interaction is not allowed` and `-25308`). Exit 0 when node, Pi, the hook, and every clone check out, and either Claude answers or the seat has a file token. A locked host keychain is a note when the seat token is present, and a failure when it is not.

`prune` deletes `origin/limen/<id>` for terminal jobs whose branch is still on origin (`git ls-remote`). A branch already deleted is not listed, including by `--dry-run`. It does not delete review branches that are not `limen/<id>`. The delete runs in the recorded worktree when that directory still exists, and in the repo when it does not. `"pruneBranches": true` deletes the origin branch after a successful fast-forward. The host clone's own `limen/<id>` branch is removed with the worktree.

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
2. The wrapper pushes `limen/<id>` (or the review branch) to `origin`, then logs that the host will fetch it.
3. Over ssh it fetches that branch into the clone of this project, adds a worktree, and writes a minimal `.limen/jobs/<id>/` so the hooks have a folder. `finish` does nothing when that folder is missing; creating it is what makes the handoff stick. Those host lines in the job log start with `[alias]`. The worktree path names the clone.
4. Pi runs `--mode json` in the worktree. Stdout is parsed on the seat with the same stream parser as a local job, so `log`, `activity`, and `last-tool` update on the mini.
5. On exit the host pushes the branch. The seat copies `result`, `session-ended`, `session/`, `note.md`, and `note.first.md` back, fetches, and fast-forwards the local worktree (a detached review updates the branch ref too). Then the host worktree and, for a `limen/<id>` branch, that local branch on the host clone are removed.
6. `finalizeJob` runs on the seat. The coordinator wake is the normal one. The host worktree and the temporary job folder are removed.

`limen stop` signals the seat wrapper, which ssh's `kill` for the recorded pid and its children, then finalizes `stopped` on the seat. The wrapper has about four seconds before `limen stop` records the terminal state itself, and five before the process group is killed. That is the same budget a Devin session gets.

Steers written on the seat (`limen steer`, and the timeout warning) are copied to the host's inbox every second (`LIMEN_HOST_STEER_MS`). When the host's hook delivers one, the seat moves its copy to `steer/delivered`. Seat-only extension paths in `extensions.json` are not loaded on the host; the log says so. The three Limen hooks come from `hook`.

## Limitations

- **Claude accounts.** The seat token is `~/.claude-accounts/<name>.token` with `active` naming `<name>`, not the macOS keychain and not a `claude-account-rotate` subcommand. A keychain-only login on the mini is `no seat Claude account` until `claude setup-token` is saved in that flat file. The running Pi keeps the token it was given. A swap on the seat is picked up by the next `continue`, not by the process already on the host. Sharing one account across machines still burns the limit.
- **GitHub token.** The installation token lives for that one job. A push after the wrapper exits uses the host's own credentials again. The broker has to be runnable as `limen-github` with `sudo -n`. A token that the broker prints with other words on the same line is refused.
- **Steers.** Inbox sync is polled, not instant. A host that is asleep keeps the steer in the seat inbox until a later poll. Delivery still happens on the host, because that is where Pi is.
- **Sleep.** A closed laptop fails the ssh connect (20s) or the server-alive check (about a minute) and the job is `failed`. Wake the machine, or disable that host, before you send it work. Overflow skips a host that does not answer and leaves the job on the seat queue.
- **Liveness.** Stall detection and `limen stop`'s escaped-child search see the ssh client on the seat, not Pi's children on the host. A tool that hangs inside Pi is not reaped by the seat's CPU-idle watch. `limen stop` kills the recorded pid and its direct children (`pkill -P`); a deeper grandchild can survive. The log's activity is real (it is Pi's stream). A picture that keys off the local process tree will show the ssh client.
- **Branches.** The seat pushes `limen/<id>` and the host pushes it again. `limen hosts prune` deletes those remote branches for terminal jobs. `"pruneBranches": true` deletes one after a successful fast-forward. Review branches that are not named `limen/<id>` stay.
- **Seat extensions and prepare.** `--extension` paths stay on the seat. `--prepare` runs on the seat worktree before the push, and it is not committed for you, so a prepare that only edits the worktree does not reach the host.
- **Groups, tabs, OMP, Devin.** Not on a host. Group members share a deadline and a cabinet on the seat. A hosted Herdr tab is a person typing on the seat.
- **Wrapper death.** If the seat wrapper dies, the host's Pi can keep running until someone kills it. The seat reaper does not have a remote pid. The job looks dead on the seat while the laptop is still busy.
- **Argument size.** The script travels on ssh's stdin, so the task can be large. The session upload and the handoff copy are base64 in that stream. A huge session makes a huge copy; it is not chunked.
- **One clone per repo.** `roots` maps each origin to a path, and `root` is the shorthand for one more clone. A host that does not list the job's project is skipped for overflow, and `--host` stops with no job record. Two keys for one origin, or two paths for one origin, are a configuration error. Workspace `--repo` jobs use that child repository's origin.

`LIMEN_SSH` overrides the ssh binary. The tests point it at a fake. Leave it unset on the seat.
