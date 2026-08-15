# Outcome

Landed and live-tried.

- `limen spawn --tab` starts interactive `pi` in the job’s Herdr tab via `herdr agent start --kind pi`.
- Job record marks `hosted` with weaker guarantees (no timeout, tool-call cap, or F007 containment).
- Reporter hook + supervisor keep `.limen/jobs/<id>/` truthful; stop/open/close behave as specified.
- Live smoke `2026-08-15-f010-try-ce97a91f`: tab `w14:t7`, work committed, quit → `done: hosted agent ended`.
- Commits: `7947b2f` (feature), `755d762` (shell wait + agent name).

Default detached spawn and F012 watch tabs unchanged.
