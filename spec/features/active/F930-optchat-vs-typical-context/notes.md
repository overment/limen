# F930 lead notes

## Product location

- Product: `~/overment/lab/optchat-explainer/` (not a Git repository). Delivered set: `optchat.svx`, `lib/*`, `optchat.html`, and the review copy `~/Downloads/optchat-vs-typical.html`.
- Pre-F930 baseline copy: `.limen/jobs/2026-10-07-f930-optchat-vs-typical-context-ddb337ea/baseline/` in the plant. Diff the lab folder against it to see the whole F930 change.

## Team topology

- `limen group start` refused from this hosted job: `startGroup` in `src/commands/group.ts` throws when `LIMEN_JOB=1` ("only the owner-facing lead may start a group … from the plant's interactive Herdr coordinator pane (LIMEN_COORDINATOR=1)"). The fix hint needs the coordinator pane. A hosted job cannot apply it without spoofing its own identity, so the lead did not retry with a changed environment.
- Substitute with the same three charters:
  - Team 1 · comparison truth: a separate `omp -p` process on `openai-codex/gpt-6-sol`, thinking high, Limen hooks off, prompt in the job folder (`team-1-prompt.md`).
  - Team 2 · comparison visuals and Team 3 · cohesion and gaps: lead task subagents (Opus).
- No group exists, so `limen group publish` and group close do not apply. Interfaces live in `contract.md` (one owner per file part).
- Teams preview by private export plus `browser-check` with their own `BROWSER_CHECK_SESSION`, so no team runs `svx stop` on another team's daemon.

## Check warnings at ticket time

- `limen ticket check`: no board line for F930 in `spec/build.md` (the lead does not edit the board); no `touches` (the product is outside the plant map).
