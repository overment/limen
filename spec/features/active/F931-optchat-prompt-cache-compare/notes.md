# F931 lead notes

## Product location

- Product: `~/overment/lab/optchat-explainer/` (not a Git repository). Delivered set: `optchat.svx`, `lib/*` (new: `lib/cache.js`), `optchat.html`, and the review copy `~/Downloads/optchat-cache-compare.html`.
- Pre-F931 baseline copy: `.limen/jobs/2026-10-07-f931-optchat-prompt-cache-compar-0ebebf23/baseline/` in the plant. Diff the lab folder against it to see the whole F931 change.
- Cache model probe: `.limen/jobs/2026-10-07-f931-optchat-prompt-cache-compar-0ebebf23/probe.mjs [turns] [history]` prints the totals of `lib/cache.js`.

## Team topology

- `limen group start` refused from this hosted job, as in F930: "Only the owner-facing lead may start a group: run limen group start from the plant's interactive Herdr coordinator pane (LIMEN_COORDINATOR=1) … a hosted limen job (LIMEN_JOB=1) cannot register as lead or start groups".
- Substitute with the same three charters:
  - Team 1 · cache truth: a separate `omp -p` process on `openai-codex/gpt-6-sol`, thinking high, Limen hooks off (`--no-extensions`), prompt `team-1-prompt.md` in the job folder, output `team-1.out` / `team-1.err`.
  - Team 2 · mixed visuals and Team 3 · cohesion: lead task subagents (Opus).
- No group exists, so `limen group publish` and group close do not apply. Interfaces live in `contract.md` (one owner per file part).

## Seed finding

- With the same seeded stream and a 400 KB assumed window, the honest model shows the typical thread reading more from cache and OptChat paying more in full: each OptChat turn pays the changed tail of the view. The view's shared prefix grows with the log length (the real fold of §5.2): at 3,000 messages the 50k mark rarely hits; at 20,000 messages it hits in about 60% of turns; at 100,000 it hits in most turns. This matches the direction of the spec's replay numbers (§5.4: 73k chars shared at 20k messages, 92k at 400k).
