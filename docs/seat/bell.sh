#!/bin/sh
# Watch .limen/jobs/*/state. On first terminal write, ping ntfy once and leave
# notify/bell so a re-run is a no-op. Operator-owned: not called by limen.
#
#   LIMEN_ROOT=/home/you/project NTFY_TOPIC=your-secret-topic ./bell.sh
#
set -eu

root=${LIMEN_ROOT:?set LIMEN_ROOT to the repo (the directory that contains .limen)}
topic=${NTFY_TOPIC:?set NTFY_TOPIC}
jobs=$root/.limen/jobs
url=${NTFY_URL:-https://ntfy.sh}

[ -d "$jobs" ] || exit 0

for dir in "$jobs"/*; do
	[ -d "$dir" ] || continue
	state=$(tr -d '[:space:]' <"$dir/state" 2>/dev/null || true)
	case $state in
	done | failed | stopped) ;;
	*) continue ;;
	esac
	[ -e "$dir/notify/bell" ] && continue
	id=$(basename "$dir")
	label=$(tr -d '\n' <"$dir/label" 2>/dev/null || printf '%s' "$id")
	mkdir -p "$dir/notify"
	if curl -fsS -d "limen: $label is $state ($id)" "$url/$topic" >/dev/null; then
		printf '%s\n' "$state" >"$dir/notify/bell"
	fi
done
