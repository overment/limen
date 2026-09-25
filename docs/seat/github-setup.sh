#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin

# Root-only, repeatable seat installation. No PEM bytes are printed or staged in a worker home.
# Required: WORKER, APP_ID, PEM_SOURCE, LIMEN_REPO, LIMEN_REV, NODE_SOURCE, HERDR_SOURCE.
[[ $(id -u) == 0 ]] || { echo 'run as root' >&2; exit 1; }
: "${WORKER:?set the existing coordinator Unix user}"
: "${APP_ID:?set the numeric GitHub App ID}"
: "${PEM_SOURCE:?set an absolute root-controlled PEM source outside worker homes}"
: "${LIMEN_REPO:?set the trusted Limen Git URL}"
: "${LIMEN_REV:?set the landed Limen commit SHA}"
: "${NODE_SOURCE:?set the root-owned Node 24 executable source}"
: "${HERDR_SOURCE:?set the root-owned Herdr executable source}"
[[ $APP_ID =~ ^[0-9]+$ && $LIMEN_REV =~ ^[0-9a-f]{40}$ && $PEM_SOURCE == /* ]] || { echo 'invalid App ID, revision, or PEM path' >&2; exit 1; }
getent passwd "$WORKER" >/dev/null || { echo 'unknown worker' >&2; exit 1; }
worker_home=$(getent passwd "$WORKER" | cut -d: -f6)
worker_uid=$(id -u "$WORKER")
[[ $worker_uid -gt 0 && $PEM_SOURCE != "$worker_home"/* ]] || { echo 'key must never be in worker home' >&2; exit 1; }
if id -nG "$WORKER" | tr ' ' '\n' | grep -Eq '^(sudo|wheel|admin)$' || sudo -n -u "$WORKER" sudo -n -l >/dev/null 2>&1; then
  echo 'remove worker sudo/admin membership and noninteractive sudo before provisioning' >&2
  exit 1
fi

# Existing timers must not run while an interpreter is unsafe or being replaced.
systemctl stop limen-github.timer 2>/dev/null || true
systemctl stop limen-github.service 2>/dev/null || true
root_path() {
  local path parent mode
  path=$(realpath "$1")
  [[ -f $path && $(stat -c %u "$path") == 0 ]] || return 1
  mode=$(stat -c %a "$path")
  (( (8#$mode & 022) == 0 )) || return 1
  parent=$(dirname "$path")
  while :; do
    [[ $(stat -c %u "$parent") == 0 ]] || return 1
    mode=$(stat -c %a "$parent")
    (( (8#$mode & 022) == 0 )) || return 1
    [[ $parent == / ]] && break
    parent=$(dirname "$parent")
  done
}
for source in "$NODE_SOURCE" "$HERDR_SOURCE"; do
  [[ $source == /* && ! -L $source ]] && root_path "$source" || { echo 'binary source and every parent must be root-owned, not writable by workers' >&2; exit 1; }
done
[[ $(realpath "$NODE_SOURCE") != /usr/bin/node && $(realpath "$HERDR_SOURCE") != /usr/local/bin/herdr ]] || { echo 'use independent trusted source paths, not the installation destinations' >&2; exit 1; }
install -d -o root -g root -m 0755 /usr/local /usr/local/bin
install -o root -g root -m 0755 "$NODE_SOURCE" /usr/bin/node
# Replace the former worker-owned executable too: other services may name it explicitly.
[[ ! -L /usr/local/bin/node ]] || rm /usr/local/bin/node
install -o root -g root -m 0755 "$NODE_SOURCE" /usr/local/bin/node
install -o root -g root -m 0755 "$HERDR_SOURCE" /usr/local/bin/herdr
[[ $(/usr/bin/node -p 'process.versions.node.split(".")[0]') == 24 ]] || { echo 'Node 24 required' >&2; exit 1; }
npm_bin=/usr/bin/npm
[[ -x $npm_bin ]] || npm_bin=/usr/local/bin/npm
root_path "$npm_bin" || { echo 'npm must be installed from a root-owned system package' >&2; exit 1; }

if ! getent group limen-github >/dev/null; then groupadd limen-github; fi
if ! id -u limen-github >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/limen-github --create-home --shell /usr/sbin/nologin --gid limen-github limen-github
fi
usermod -aG limen-github "$WORKER"
install -d -o root -g root -m 0755 /opt
if [[ ! -d /opt/limen/.git ]]; then
  [[ ! -e /opt/limen ]] || { echo '/opt/limen exists but is not a Git checkout' >&2; exit 1; }
  git clone "$LIMEN_REPO" /opt/limen
fi
[[ $(stat -c %u /opt/limen) == 0 ]] || { echo '/opt/limen must be root-owned' >&2; exit 1; }
git -C /opt/limen remote set-url origin "$LIMEN_REPO"
git -C /opt/limen diff --quiet && git -C /opt/limen diff --cached --quiet || { echo 'refusing dirty release' >&2; exit 1; }
git -C /opt/limen fetch origin "$LIMEN_REV"
git -C /opt/limen checkout --detach "$LIMEN_REV"
(cd /opt/limen && "$npm_bin" ci)
chown -R root:root /opt/limen
chmod -R go-w /opt/limen
[[ $(stat -c %u /opt/limen/bin/limen) == 0 ]] || exit 1
ln -sfnT /opt/limen/bin/limen /usr/local/bin/limen
install -d -o root -g limen-github -m 0750 /etc/limen-github
install -d -o limen-github -g limen-github -m 0700 /var/lib/limen-github/state
[[ -f $PEM_SOURCE && ! -L $PEM_SOURCE && $(stat -c %u "$PEM_SOURCE") == 0 ]] || { echo 'PEM source must be a root-owned regular file' >&2; exit 1; }
install -o limen-github -g limen-github -m 0600 "$PEM_SOURCE" /etc/limen-github/app.pem
registry="$worker_home/.limen/projects"
[[ -f $registry ]] || { echo "run limen init in each project before setup; missing $registry" >&2; exit 1; }
command -v setfacl >/dev/null || { echo 'install acl before setup' >&2; exit 1; }
setfacl -m u:limen-github:--x "$worker_home" "$worker_home/.limen"
setfacl -m u:limen-github:r-- "$registry"
while IFS= read -r project; do
  [[ -z $project ]] && continue
  [[ $project == /* && -d $project/.limen ]] || { echo "invalid registered project: $project" >&2; exit 1; }
  parent=$project
  while [[ $parent != / ]]; do
    setfacl -m u:limen-github:--x "$parent"
    parent=$(dirname "$parent")
  done
done < "$registry"
install -o root -g root -m 0600 /dev/null /etc/limen-github/poller.env
{
  printf 'LIMEN_GITHUB_APP_ID=%s\n' "$APP_ID"
  printf 'LIMEN_GITHUB_KEY_FILE=/etc/limen-github/app.pem\n'
  printf 'LIMEN_GITHUB_PROJECTS_FILE=%s\n' "$registry"
  printf 'LIMEN_GITHUB_STATE_DIR=/var/lib/limen-github/state\n'
  printf 'LIMEN_GITHUB_WORKER_UID=%s\n' "$worker_uid"
  printf 'LIMEN_GITHUB_LIMEN_BIN=/opt/limen/bin/limen\n'
} > /etc/limen-github/poller.env
install -o root -g root -m 0440 /dev/null /etc/sudoers.d/limen-github
printf 'Defaults:limen-github secure_path="/usr/bin:/usr/local/bin"\nlimen-github ALL=(%s) NOPASSWD: /opt/limen/bin/limen github deliver *\n' "$WORKER" > /etc/sudoers.d/limen-github
chmod 0440 /etc/sudoers.d/limen-github
visudo -cf /etc/sudoers.d/limen-github
install -o root -g root -m 0644 "$(dirname "$0")/limen-github.service" /etc/systemd/system/limen-github.service
install -o root -g root -m 0644 "$(dirname "$0")/limen-github.timer" /etc/systemd/system/limen-github.timer
systemctl daemon-reload
runuser -u limen-github -- test -r /etc/limen-github/app.pem
# Do not start a polling pass here: connect/doctor and binary ownership must be checked first.
echo 'Setup installed with timer stopped. Re-login as worker, run limen github doctor; repair every finding except the stopped timer, then enable the timer and rerun doctor.'
