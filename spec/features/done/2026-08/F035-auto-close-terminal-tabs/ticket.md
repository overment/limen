# F035-auto-close-terminal-tabs · Terminal jobs leave no open tabs

[2026-08-21] [🟢] [PROVEN] [COORDINATOR] PROVEN · F035-auto-close-terminal-tabs

Human direction 2026-08-21: failed / finished / stopped tabs must be closed, not swept manually. Today `finalizeJob` only renames the tab to `· <state>`; closing stays a manual `limen close` step, and the probe jobs proved the coordinator forgets.

## Outcome

When a job reaches terminal state, its Herdr tab closes as part of finalize. Nothing is lost: the wake carries result and commits, job files remain truth, and `limen open <id>` recreates a log view for any terminal job.

## Scope

- `renameJobTab` becomes `settleJobTab`: same detached, non-blocking spawn pattern (finalize must never wait on Herdr), sending `tab close <recorded-tab>` instead of rename.
- `limen close FNNN` stays for older leftovers.

## Out of scope

- Closing anything but the recorded job tab — never the coordinator tab.
- Hosted tabs before terminal state (that would kill a live worker).

## Acceptance

- Detached job done under fake Herdr: calls include `tab close <tab>`.
- `stop` on a watch-tab job: tab closed.
- Finalize does not block when Herdr hangs on `tab close`.
