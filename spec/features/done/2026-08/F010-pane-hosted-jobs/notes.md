# F010 notes

## Landed

- `limen spawn --tab` — opt-in hosted worker
- Tab opens at a shell in the worktree; `herdr agent start --kind pi` runs interactive pi there
- Job record writes `hosted` (weaker guarantees), `herdr/mode=hosted`, `herdr/agent`
- `hook/hosted.ts` reporter + detached supervisor keep activity/state
- `limen open` focuses live tab; closed reopen is log-only (no resurrection)
- `limen stop` best-effort Ctrl-C on agent + supervisor TERM
- Refuses without `HERDR_ENV=1` / herdr binary before creating a job record

## Try

```
limen spawn --tab --label "F010 try" "…"
```

Needs current `herdr integration install pi` if agent detection is outdated.
