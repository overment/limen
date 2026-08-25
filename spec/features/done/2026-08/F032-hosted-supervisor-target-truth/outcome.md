# Outcome

The hosted supervisor follows the worker across a pane move instead of treating the old ID as missing. Live prove 2026-08-25: job `2026-08-25-f032-pane-prove-b0563fea` moved `w1H:p18` → `w1M:pY` (`herdr pane move --new-tab --workspace w1M`). Log: `hosted agent relocated w1H:p18 -> w1M:pY`. `herdr/pane` updated to `w1M:pY`. State stayed `running`. Implemented earlier at `6ee8ff1`.
