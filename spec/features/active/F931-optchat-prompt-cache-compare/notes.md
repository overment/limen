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
- Timing: Team 1 (Sol) wrote contract v1, fixed the model and reviewed a private export in about 7 minutes. Team 3 took 11 minutes and Team 2 took 15.5 minutes for the first pass. Team 3 then ran the final pass (cold reader, export, checks).
- Hidden-screen checks reported `focus.changed: true` three times. Each time the new front app was the owner's own app (alice-app, Slack, Obsidian), not the test Chrome, so the checks went on.

## Seed finding

- With the same seeded stream and a 400 KB assumed window, the honest model shows the typical thread reading more from cache and OptChat paying more in full: each OptChat turn pays the changed tail of the view. The view's shared prefix grows with the log length (the real fold of §5.2): at 3,000 messages the 50k mark rarely hits; at 20,000 messages it hits in about 60% of turns; at 100,000 it hits in most turns. This matches the direction of the spec's replay numbers (§5.4: 73k chars shared at 20k messages, 92k at 400k).

## Integration

- Placement: per-turn series in section 01 (`lib/Turns.svelte`, under the context chart); request stacks in section 04 (`lib/Request.svelte`, from `examples(run)`); cache bars per view line in the section 03 memory simulator; cache rows in the section 02 detail panel; a "Prompt cache?" row in the comparison table. Hero and stats unchanged (decision recorded in contract v1.1).
- `lib/run.js` holds the one seeded run, so the 20,000-message fold runs once per page load.
- The owner's goal text named the tool loop as OptChat's main full-price part. The model disagrees: inside a turn each step reads the step before it, so the tool loop is mostly cache reads; the main full-price part is the changed view tail at each turn start. The page follows the model.
- `~/Downloads/optchat-cache-compare.html` is the one current review build. `~/Downloads/optchat-vs-typical.html` stays the earlier comparison build and was not refreshed.
- Final export: `optchat.html`, 150,363 bytes, byte-identical to `~/Downloads/optchat-cache-compare.html` (`cmp`). It was re-exported by the lead after Team 2 fixed two 900 px label collisions (the `1,000 KB` scale label in `Turns.svelte`; the `80k` / `100k` ticks in `Request.svelte`).
- Lead checks on that file, hidden screen: 900 px shots of the per-turn chart and section 04 opened, no overlap or clipping, no element past the right edge. Audit after a full scroll: radius `6px` ×17 and `50%` ×3; SVG `rx` only `6`; the only hue is `rgb(232, 89, 12)` (`--pending`); no network resources; no error card.
- Team 3 checks on the previous export (same sources except the two label fixes): console clean after scroll and a memory demo; reduced motion (CDP) holds the hero at 1,024 and the 01 counter steady, no memory autoplay; dark scheme (CDP) keeps the article white; shots opened at 1440 and 900.
