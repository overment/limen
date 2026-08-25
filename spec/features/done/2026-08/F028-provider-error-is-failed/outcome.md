# Outcome

A run whose last assistant turn ended in `error` or `aborted` records `failed: <reason>`, even when Pi exited 0. A later clean turn stays `done`. Commits made before the error still appear in the handoff. Signed off 2026-08-26. Landed `967ab4b`. Focused detached and hosted tests passed on merge.
