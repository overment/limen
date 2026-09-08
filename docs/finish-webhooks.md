# Finish webhooks

`bin/tony-finish-ping.sh <label> <status> <branch>` sends one JSON POST containing
`job`, `status` and `branch`. It requires Node.js 24+ and Git, on macOS or Linux.
It uses Node's HTTP client, not curl; credentials never enter child-process
arguments. HTTP acceptance does **not** prove Tony woke or read the handoff.

## Install the reviewed helper

The repository file is the only sending implementation. Keep the reviewed Limen
package installed at a stable path. Automatic finalization invokes that package's
`bin/tony-finish-ping.sh` directly, never the legacy home launcher.

Existing worker briefs may call `~/.overment/tony-finish-ping.sh` from inside Git
without an explicit override, deliberately relying on home config. Replacing
that path with the strict canonical helper would break those callers. Preserve
it as a thin launcher that selects the legacy manual default and execs the
absolute installed canonical executable. For an installation at
`$HOME/.overment/limen`:

```sh
mkdir -p "$HOME/.overment"
cat > "$HOME/.overment/tony-finish-ping.sh" <<'SH'
#!/bin/sh
export TONY_FINISH_WEBHOOK_ENV="${TONY_FINISH_WEBHOOK_ENV-$HOME/.overment/tony-finish-webhook.env}"
exec "$HOME/.overment/limen/bin/tony-finish-ping.sh" "$@"
SH
chmod 755 "$HOME/.overment/tony-finish-ping.sh"
```

If Limen is installed elsewhere, set the `exec` target to that absolute installed
path. This wrapper contains no HTTP, auth or JSON implementation. The `-` rather
than `:-` default preserves an explicitly empty override, which the canonical
helper rejects instead of falling back. Legacy manual home selection is an
intentional compatibility exception; it does not opt any project into automation.

Direct replacement of the legacy path is **opt-in only**, after migrating every
caller to the canonical strict selection rules or an explicit project override;
it is not a drop-in migration:

```sh
# Only after all legacy callers have been migrated:
install -m 755 bin/tony-finish-ping.sh "$HOME/.overment/tony-finish-ping.sh"
```

No env file is installed or copied by these commands. Installation and private
configuration belong to the operator/coordinator, not implementation workers.
The canonical helper can also run directly from the checkout; it does not need
the rest of Limen beside it.

## Standalone helper configuration selection

For a manual helper invocation, selection is fail-closed, in this order:

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

## Automatic job delivery

Both hosted supervisors and detached wrappers invoke the package's canonical
`bin/tony-finish-ping.sh` after writing durable terminal state. The job's label,
`done`/`failed`/`stopped` state and branch are passed unchanged as three arguments.
Sender failure never changes the job outcome or coordinator wake subscriptions.

At `limen spawn`, selection is deliberately narrower than the standalone helper:

- An explicit `TONY_FINISH_WEBHOOK_ENV` resolves relative to the spawn directory
  and is stored as an absolute path. An explicitly empty value disables automatic
  delivery; it is never passed to the helper. A nonempty missing path is retained
  so completion records a visible sender failure, not a fallback destination.
- Otherwise, opt in only if `.limen/finish-webhook.env` exists in the primary Git
  worktree. A linked worktree uses that primary checkout, not its local `.limen`
  directory. For a non-Git workspace, use the coordinator directory's config,
  not an immediate child repository's destination.
- Without either selection, do not invoke the sender. Automatic delivery never
  looks up home config. Keep overrides project-specific, not in a global shell
  or shared service configuration.

Only the selected path is written to the mode-600 job file `finish-webhook-env`;
credentials remain in the private dotenv file and are read by the helper at
completion. `limen continue` preserves its parent's selected path **or absence**,
regardless of the continuation caller's environment. A fresh `spawn --branch`
selects config at spawn as usual. Existing jobs without a snapshot stay opted out.
For unusual separate Git-directory layouts, an explicit override avoids differing
standalone-helper and primary-worktree discovery locations.

Automatic sending has a stricter three-second process-group deadline than the
standalone helper's ten-second request bound. During detached stop/exhaustion it
uses only the remaining shutdown grace, reserving 500ms to record the result;
with no time left it records `not sent`. No timeout extends job shutdown.

Routine workers should omit a manual finish-ping before exit or `finish`:
automation handles configured jobs. A coordinator uses the deliberate fallback
below after a failed or absent automatic send, never as a routine duplicate.

## Private env format

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

Automatic delivery discards sender stdout/stderr and records only safe status.
Inspect `limen jobs <id>` for the log summary, then the plain job records:

| Job file | Meaning |
|---|---|
| `finish-webhook-env` | Selected absolute private env path only; absence means not opted in. |
| `finish-webhook-attempt` | Flushed timestamp claiming the one automatic attempt. |
| `finish-webhook` | Timestamped `attempting`, `accepted`, or `failed`, plus retry guidance. |
| `state` / `finished-at` | Job outcome and completion time, independent of delivery success. |

`accepted: sender exited 0 (owner wake unobserved)` means the canonical sender
reported HTTP success, not an observed Tony wake. `failed` identifies a nonzero
exit, launch failure, deadline, or invalid recorded path without exposing sender
output. After the finalizer is gone, a remaining `attempting` or a claim without
a result is ambiguous: the endpoint may already have accepted the request.
Repeated or concurrent finalization never reclaims an attempt and never retries.
A terminal job without a claim can also mean the finalizer died before sending;
wait for finalization to settle before deciding it needs a manual fallback.

To inspect without printing config, set `job` to the absolute job directory:

```sh
job=/absolute/project/.limen/jobs/JOB_ID
for record in state finished-at finish-webhook-attempt finish-webhook; do
  if [ -f "$job/$record" ]; then printf '%s: ' "$record"; cat "$job/$record"; fi
done
```

After deliberately deciding to retry, run this from the installed Limen package.
It uses the recorded path and original fields, never a home fallback or a
replacement `done` state for a failed job:

```sh
TONY_FINISH_WEBHOOK_ENV="$(tr -d '\n' < "$job/finish-webhook-env")" \
  bin/tony-finish-ping.sh "$(tr -d '\n' < "$job/label")" \
  "$(tr -d '\n' < "$job/state")" "$(tr -d '\n' < "$job/branch")"
result=$?
printf 'finish sender exit=%s\n' "$result"
```

A manual retry does not rewrite the automatic receipt. Record its sanitized
stdout/stderr and exit status in the handoff, not the private config. If the job
never opted in, the operator must explicitly authorize a project-specific config
before using the fallback; do not select a home destination on its behalf.
For a standalone manual request without a Limen job record:

```sh
TONY_FINISH_WEBHOOK_ENV=/absolute/project/.limen/finish-webhook.env \
  "$HOME/.overment/tony-finish-ping.sh" 'original-label' 'failed' 'original-branch'
result=$?
printf 'finish sender exit=%s\n' "$result"
```

There is no automatic retry or idempotency guarantee in this helper. A timeout
can happen after the server accepted the request; a deliberate retry may produce
a duplicate. HTTP acceptance and an observed Tony wake must be recorded as two
separate facts. Do not delete a claim to trigger automatic retries: there is no
queue or retry daemon.

## Synthetic checks

```sh
node --test --test-concurrency=1 test/finish-webhook-helper.test.ts test/finish-webhook.test.ts
```

The tests execute the real helper with synthetic env files, an intercepted Node
transport (no sockets or endpoint calls), and real Git repositories/worktrees.
They verify payload round-trips, auth rejection before transport, no credential
output/argv, no redirect following, non-2xx failures, canonical project selection
and no home inheritance inside Git. The timeout fixture accelerates the timer
while asserting the requested production deadline is exactly 10,000 ms.
Lifecycle tests additionally exercise automatic hosted/detached finalization,
worktree/workspace selection, continuation, one-send claims, safe failures and
bounded shutdown with synthetic executables. A combined test invokes the actual
canonical helper through automatic finalization with intercepted transport.
