# Finish webhooks

`bin/tony-finish-ping.sh <label> <status> <branch>` sends one JSON POST containing
`job`, `status` and `branch`. It requires Node.js 24+ and Git, on macOS or Linux.
It uses Node's HTTP client, not curl; credentials never enter child-process
arguments. HTTP acceptance does **not** prove Tony woke or read the handoff.

## Install the reviewed helper

The repository file is the only sending implementation. From the reviewed Limen
checkout, an operator can install the standalone executable at the legacy path:

```sh
mkdir -p "$HOME/.overment"
install -m 755 bin/tony-finish-ping.sh "$HOME/.overment/tony-finish-ping.sh"
```

Repeat this after updating the reviewed helper. No env file is installed or
copied by this command. Installation and private configuration belong to the
operator/coordinator, not implementation workers. The helper can also be invoked
directly from the checkout; it does not need the rest of Limen beside it.

## Configuration selection

Selection is fail-closed, in this order:

1. If `TONY_FINISH_WEBHOOK_ENV` is set, it must be an **absolute env-file path**.
   Empty, relative, unreadable or invalid overrides fail; they never fall back.
2. Inside Git, resolve `git rev-parse --git-common-dir` to its real path. The
   selected file is `.limen/finish-webhook.env` beside that directory: for
   `/srv/project/.git`, use `/srv/project/.limen/finish-webhook.env`. Linked
   worktrees and their subdirectories therefore use the canonical checkout's
   file, not a worker's local `.limen` file. Missing/invalid project config fails;
   it does not inherit a home destination. For separate Git-directory layouts,
   use an explicit override if this location is not the intended project root.
3. Only a manual invocation **outside Git** can use the legacy
   `~/.overment/tony-finish-webhook.env` fallback. Git errors other than “not a git
   repository” fail instead of selecting a different destination.

Automatic delivery requires explicit per-project opt-in. Its caller owns
selection/persistence and must pass the selected absolute file through
`TONY_FINISH_WEBHOOK_ENV`; it must not invoke this helper with the home fallback
when a project is unconfigured. An override must be project-specific, not a
shared global setting. This helper does not implement job finalization, alter
job outcomes, queue deliveries or retry them. Routine automated completion must
not also ask the worker to send a duplicate manual ping.

The env file is dotenv **data**, not a sourced shell script. Use assignments,
optional `export`, comments and literal single/double-quoted values. Do not use
shell expansion, command substitution, shell-escaped spaces or executable setup
commands. Exported URL/auth variables are not a substitute for a selected file.

```dotenv
TONY_FINISH_WEBHOOK_URL='https://your-endpoint.example.invalid/finish'
TONY_FINISH_WEBHOOK_AUTH='Bearer REPLACE_WITH_TOKEN'
```

`AUTH` is the complete header value, including exactly `Bearer ` followed by a
nonempty token using `A-Z a-z 0-9 - . _ ~ + /` and optional trailing `=` padding.
Basic, raw tokens, extra whitespace, newlines and missing credentials fail before
sending. The URL must use HTTPS, without embedded username/password or fragment.
Response bodies, URLs and credential values are never printed by the helper.
Do not enable runtime network tracing, put secrets in command arguments, or
paste private env contents into job logs.

## macOS: configure a project

Use an editor to enter the private destination and credential; avoid shell
history. Run this from the intended project (the main checkout or any linked
worktree), **not** from the Limen installation:

```sh
COMMON=$(cd "$(git rev-parse --git-common-dir)" && pwd -P)
PROJECT=$(dirname "$COMMON")
CONFIG="$PROJECT/.limen/finish-webhook.env"
mkdir -p "$PROJECT/.limen"
printf '/.limen/finish-webhook.env\n' >> "$COMMON/info/exclude"
if [ ! -e "$CONFIG" ]; then
  (umask 077; printf '%s\n' \
    "TONY_FINISH_WEBHOOK_URL='https://your-endpoint.example.invalid/finish'" \
    "TONY_FINISH_WEBHOOK_AUTH='Bearer REPLACE_WITH_TOKEN'" > "$CONFIG")
fi
chmod 600 "$CONFIG"
"${EDITOR:-vi}" "$CONFIG"
git check-ignore "$CONFIG"
```

The final command should show that the file is ignored. `info/exclude` keeps the
credential file out of Git without a repository-wide tracked settings change.
Never add it with `git add -f`. If a config was previously committed, ignoring it
is not a remedy: the operator must remove it from tracking and address exposure.

After replacing the placeholders, deliberately test one request:

```sh
TONY_FINISH_WEBHOOK_ENV="$CONFIG" \
  "$HOME/.overment/tony-finish-ping.sh" setup-check done "$(git branch --show-current)"
```

This is a real request, not a dry run. Inspect HTTP acceptance and confirm the
owner's wake separately. A worker should not run it unless explicitly authorized.

## VPS: load only the selected path

Install Node.js 24+ and Git on the VPS, and install the reviewed helper there.
Keep a separate project-owned env file on that host; the Mac's private env does
not travel through Git. For a canonical checkout at `/srv/projects/my-project`,
run the same configuration block above from that checkout, as the account that
runs Limen. That account needs read access to the mode-600 file.

A service or noninteractive shell should supply an absolute path rather than
source the credential file or depend on login-shell exports:

```sh
cd /srv/projects/my-project
export TONY_FINISH_WEBHOOK_ENV=/srv/projects/my-project/.limen/finish-webhook.env
"$HOME/.overment/tony-finish-ping.sh" vps-setup-check done "$(git branch --show-current)"
```

For a project-specific systemd unit, the equivalent nonsecret setting is:

```ini
[Service]
WorkingDirectory=/srv/projects/my-project
Environment=TONY_FINISH_WEBHOOK_ENV=/srv/projects/my-project/.limen/finish-webhook.env
# Include the directory containing Node.js 24+ if it is not installed in /usr/bin.
Environment=PATH=/usr/local/bin:/usr/bin:/bin
```

Do not install this override in a shared service handling unrelated projects.
The automatic caller must select each project's own config. No `EnvironmentFile`
is required: the helper reads the selected dotenv file itself, including the
space in `Bearer …`.

## Inspect failures and deliberately retry

Exit 0 prints `finish webhook: accepted (HTTP NNN)` for 200–299 only. Other
responses print `finish webhook: HTTP NNN rejected` and exit 1. Redirects are not
followed. Network errors print `request failed`; a stalled request is forcibly
bounded to 10 seconds and prints `request timed out after 10000ms`. Git lookup
has a separate two-second limit. Config/usage errors exit 1 before transport.
No response body is read, so even a server that echoes credentials cannot put
them in a handoff.

Record the helper's sanitized stdout/stderr and exit status, not its config.
Check file existence/permissions and the selected absolute path privately when
configuration fails. To deliberately retry a failed delivery, keep the original
label, terminal status and branch; do not turn a failed job into `done`:

```sh
TONY_FINISH_WEBHOOK_ENV=/absolute/project/.limen/finish-webhook.env \
  "$HOME/.overment/tony-finish-ping.sh" 'original-label' 'failed' 'original-branch'
result=$?
printf 'finish sender exit=%s\n' "$result"
```

There is no automatic retry or idempotency guarantee in this helper. A timeout
can happen after the server accepted the request; a deliberate retry may produce
a duplicate. HTTP acceptance and an observed Tony wake must be recorded as two
separate facts. Finalizer job-record inspection belongs to the automatic-delivery
integration, not this standalone command.

## Synthetic checks

```sh
node --test test/finish-webhook-helper.test.ts
```

The tests execute the real helper with synthetic env files, an intercepted Node
transport (no sockets or endpoint calls), and real Git repositories/worktrees.
They verify payload round-trips, auth rejection before transport, no credential
output/argv, no redirect following, non-2xx failures, canonical project selection
and no home inheritance inside Git. The timeout fixture accelerates the timer
while asserting the requested production deadline is exactly 10,000 ms.
