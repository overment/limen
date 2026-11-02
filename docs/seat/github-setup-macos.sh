#!/bin/bash
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin

# macOS counterpart of github-setup.sh. Root-only, repeatable. No PEM bytes are printed or staged in a worker home.
# Required: WORKER, APP_ID, PEM_SOURCE, LIMEN_REPO, LIMEN_REV, HERDR_SOURCE.
# Node: /usr/local/bin/node must be a root-owned Node 24 (the official macOS installer puts it there); set NODE_SOURCE
# to install one from a root-owned source instead. The poller is the launchd job dev.limen.github, installed disabled.
[[ $(id -u) == 0 ]] || { echo 'run as root' >&2; exit 1; }
: "${WORKER:?set the existing coordinator Unix user}"
: "${APP_ID:?set the numeric GitHub App ID}"
: "${PEM_SOURCE:?set an absolute root-controlled PEM source outside worker homes}"
: "${LIMEN_REPO:?set the trusted Limen Git URL}"
: "${LIMEN_REV:?set the landed Limen commit SHA}"
: "${HERDR_SOURCE:?set the root-owned Herdr executable source}"
LABEL=dev.limen.github
POLLER=limen-github
[[ $APP_ID =~ ^[0-9]+$ && $LIMEN_REV =~ ^[0-9a-f]{40}$ && $PEM_SOURCE == /* ]] || { echo 'invalid App ID, revision, or PEM path' >&2; exit 1; }
worker_home=$(dscl . -read "/Users/$WORKER" NFSHomeDirectory 2>/dev/null | sed -n 's/^NFSHomeDirectory: //p')
[[ -n $worker_home ]] || { echo 'unknown worker' >&2; exit 1; }
worker_uid=$(id -u "$WORKER")
[[ $worker_uid -gt 0 && $PEM_SOURCE != "$worker_home"/* ]] || { echo 'key must never be in worker home' >&2; exit 1; }
if id -nG "$WORKER" | tr ' ' '\n' | grep -Eq '^(sudo|wheel|admin)$' || sudo -n -u "$WORKER" sudo -n -l >/dev/null 2>&1; then
  echo 'remove worker admin membership and every sudo rule for it before provisioning' >&2
  exit 1
fi

# Unload and disable first: a reboot must not poll before doctor passes.
launchctl bootout "system/$LABEL" 2>/dev/null || true
launchctl disable "system/$LABEL"

root_path() {
  local path parent
  path=$(realpath "$1")
  [[ -f $path && $(stat -f %u "$path") == 0 ]] || return 1
  (( (8#$(stat -f %Lp "$path") & 022) == 0 )) || return 1
  parent=$(dirname "$path")
  while :; do
    [[ $(stat -f %u "$parent") == 0 ]] || return 1
    (( (8#$(stat -f %Lp "$parent") & 022) == 0 )) || return 1
    [[ $parent == / ]] && break
    parent=$(dirname "$parent")
  done
}
for source in ${NODE_SOURCE:+"$NODE_SOURCE"} "$HERDR_SOURCE"; do
  if [[ $source != /* || -L $source ]] || ! root_path "$source"; then
    echo 'binary source and every parent must be root-owned, not writable by workers' >&2
    exit 1
  fi
done
[[ $(realpath "$HERDR_SOURCE") != /usr/local/bin/herdr ]] || { echo 'use an independent trusted Herdr source, not the destination' >&2; exit 1; }
install -d -o root -g wheel -m 0755 /usr/local /usr/local/bin
if [[ -n ${NODE_SOURCE:-} ]]; then
  [[ ! -L /usr/local/bin/node ]] || rm /usr/local/bin/node
  install -o root -g wheel -m 0755 "$NODE_SOURCE" /usr/local/bin/node
fi
root_path /usr/local/bin/node && [[ ! -L /usr/local/bin/node ]] || { echo '/usr/local/bin/node must be a root-owned file' >&2; exit 1; }
[[ $(/usr/local/bin/node -p 'process.versions.node.split(".")[0]') == 24 ]] || { echo 'Node 24 required' >&2; exit 1; }
install -o root -g wheel -m 0755 "$HERDR_SOURCE" /usr/local/bin/herdr

# Group and poller user. An existing poller account is kept; a new one is a hidden service account.
if ! dscl . -read "/Groups/$POLLER" PrimaryGroupID >/dev/null 2>&1; then
  gid=$(dscl . -list /Groups PrimaryGroupID | awk '{print $2}' | sort -n | awk 'BEGIN{g=400} $1==g{g++} END{print g}')
  (( gid < 500 )) || { echo 'no free group id below 500' >&2; exit 1; }
  dscl . -create "/Groups/$POLLER"
  dscl . -create "/Groups/$POLLER" PrimaryGroupID "$gid"
  dscl . -create "/Groups/$POLLER" RealName 'Limen GitHub poller'
fi
if ! id -u "$POLLER" >/dev/null 2>&1; then
  uid=$(dscl . -list /Users UniqueID | awk '{print $2}' | sort -n | awk 'BEGIN{u=400} $1==u{u++} END{print u}')
  (( uid < 500 )) || { echo 'no free service uid below 500' >&2; exit 1; }
  gid=$(dscl . -read "/Groups/$POLLER" PrimaryGroupID | awk '{print $2}')
  dscl . -create "/Users/$POLLER"
  dscl . -create "/Users/$POLLER" UniqueID "$uid"
  dscl . -create "/Users/$POLLER" PrimaryGroupID "$gid"
  dscl . -create "/Users/$POLLER" UserShell /usr/bin/false
  dscl . -create "/Users/$POLLER" NFSHomeDirectory /var/empty
  dscl . -create "/Users/$POLLER" IsHidden 1
fi
for member in "$POLLER" "$WORKER"; do
  dscl . -read "/Groups/$POLLER" GroupMembership 2>/dev/null | tr ' ' '\n' | grep -qx "$member" \
    || dscl . -append "/Groups/$POLLER" GroupMembership "$member"
done

install -d -o root -g wheel -m 0755 /opt
if [[ ! -d /opt/limen/.git ]]; then
  [[ ! -e /opt/limen ]] || { echo '/opt/limen exists but is not a Git checkout' >&2; exit 1; }
  git clone "$LIMEN_REPO" /opt/limen
fi
[[ $(stat -f %u /opt/limen) == 0 ]] || { echo '/opt/limen must be root-owned' >&2; exit 1; }
git -C /opt/limen remote set-url origin "$LIMEN_REPO"
if ! git -C /opt/limen diff --quiet || ! git -C /opt/limen diff --cached --quiet; then
  echo 'refusing dirty release' >&2
  exit 1
fi
git -C /opt/limen fetch origin "$LIMEN_REV"
git -C /opt/limen checkout --detach "$LIMEN_REV"
chown -R root:wheel /opt/limen
chmod -R go-w /opt/limen
[[ $(stat -f %u /opt/limen/bin/limen) == 0 ]] || exit 1
ln -sfn /opt/limen/bin/limen /usr/local/bin/limen

install -d -o root -g "$POLLER" -m 0750 /etc/limen-github
install -d -o root -g wheel -m 0755 /var/lib
install -d -o "$POLLER" -g "$POLLER" -m 0755 /var/lib/limen-github
install -d -o "$POLLER" -g "$POLLER" -m 0700 /var/lib/limen-github/state
if [[ ! -f $PEM_SOURCE || -L $PEM_SOURCE ]] || ! root_path "$PEM_SOURCE"; then
  echo 'PEM source and every parent must be root-owned, not writable by workers' >&2
  exit 1
fi
install -o "$POLLER" -g "$POLLER" -m 0600 "$PEM_SOURCE" /etc/limen-github/app.pem

# Access control entries: add each once.
acl() { # acl RIGHTS PATH — only where the other class lacks the right (system folders such as /Users refuse ACLs)
  local bit=1
  [[ $1 == read ]] && bit=4
  (( (8#$(stat -f %Lp "$2") & bit) != 0 )) && return 0
  ls -led "$2" | grep -Eq "^ *[0-9]+: user:$POLLER allow $1\$" || chmod +a "user:$POLLER allow $1" "$2"
}
registry="$worker_home/.limen/projects"
[[ -f $registry ]] || { echo "run limen init in each project before setup; missing $registry" >&2; exit 1; }
acl search "$worker_home"
acl search "$worker_home/.limen"
acl read "$registry"
while IFS= read -r project; do
  [[ -z $project || ! -d $project/.limen ]] && continue
  [[ $project == /* && $project == "$(realpath "$project")" ]] || { echo "invalid registered project: $project" >&2; exit 1; }
  parent=$project
  while [[ $parent != / ]]; do
    acl search "$parent"
    parent=$(dirname "$parent")
  done
done < "$registry"

install -o root -g wheel -m 0440 /dev/null /etc/sudoers.d/limen-github
printf 'Defaults:%s secure_path="/usr/bin:/usr/local/bin"\n%s ALL=(%s) NOPASSWD: /opt/limen/bin/limen github ensure *\n%s ALL=(%s) NOPASSWD: /opt/limen/bin/limen github deliver *\n' \
  "$POLLER" "$POLLER" "$WORKER" "$POLLER" "$WORKER" > /etc/sudoers.d/limen-github
chmod 0440 /etc/sudoers.d/limen-github
visudo -cf /etc/sudoers.d/limen-github
ls -led /etc/sudoers.d | grep -Eq "^ *[0-9]+: user:$WORKER allow search\$" || chmod +a "user:$WORKER allow search" /etc/sudoers.d

# launchd has no EnvironmentFile: the poller settings (no key bytes) live in the root-owned plist.
plist=/Library/LaunchDaemons/$LABEL.plist
install -o root -g wheel -m 0644 /dev/null "$plist"
cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>UserName</key><string>$POLLER</string>
  <key>GroupName</key><string>$POLLER</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/opt/limen/bin/limen</string>
    <string>github</string>
    <string>poll</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/bin:/usr/local/bin</string>
    <key>LIMEN_GITHUB_APP_ID</key><string>$APP_ID</string>
    <key>LIMEN_GITHUB_KEY_FILE</key><string>/etc/limen-github/app.pem</string>
    <key>LIMEN_GITHUB_PROJECTS_FILE</key><string>$registry</string>
    <key>LIMEN_GITHUB_STATE_DIR</key><string>/var/lib/limen-github/state</string>
    <key>LIMEN_GITHUB_WORKER_UID</key><string>$worker_uid</string>
    <key>LIMEN_GITHUB_LIMEN_BIN</key><string>/opt/limen/bin/limen</string>
  </dict>
  <key>StartInterval</key><integer>60</integer>
  <key>StandardOutPath</key><string>/var/lib/limen-github/poller.log</string>
  <key>StandardErrorPath</key><string>/var/lib/limen-github/poller.log</string>
</dict>
</plist>
PLIST
plutil -lint "$plist" >/dev/null
sudo -u "$POLLER" test -r /etc/limen-github/app.pem
! sudo -u "$WORKER" test -r /etc/limen-github/app.pem || { echo 'worker can read the App key' >&2; exit 1; }
# Do not start a polling pass here: connect/doctor and binary ownership must be checked first.
echo "Setup installed with $LABEL disabled and unloaded. Log in again as $WORKER, run limen github doctor; repair every finding except the timer, then: launchctl enable system/$LABEL && launchctl bootstrap system $plist; rerun doctor."
