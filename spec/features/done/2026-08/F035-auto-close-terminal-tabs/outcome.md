# F035 outcome · terminal tabs auto-close

Landed at `554e3c9` (2026-08-21, coordinator-written, suite-covered). `finalizeJob` now closes the recorded job tab via `settleJobTab` (detached, non-blocking) instead of renaming it to `· <state>`. `limen open <id>` recreates a log view; `limen close FNNN` remains for legacy leftovers.

Proven live 2026-08-21: hosted job `2026-08-21-f036-naming-try-53de86f2`; after `limen stop`, the workspace tab list shows only the coordinator tab.
