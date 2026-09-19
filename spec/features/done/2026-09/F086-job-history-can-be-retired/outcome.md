# Outcome

An operator can retire finished job records with `limen prune --retire`, so a long-running project is cheap to open. Running jobs and unmerged branches stay; `--dry-run` prints the ids and removes nothing. Spawn and sweep never retire records. Landed `58c9c4f`. Focused prune tests passed 12/12; full native passed 452/452.
