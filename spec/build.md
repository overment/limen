# Build

## TRACK

- Reliable in-flight control on one seat; a laptop is a window; GitHub may ring the doorbell later.
- 2026-09-03 Alice audit: guidance present once per call and recalled at the moment of use; hosted jobs end themselves; review loops stop at the ceiling. F053–F063.
- 2026-09-05 Alice audit: a worker falsifies its own candidate, proof belongs to the commit it proves, and the stall becomes a signal rather than another rule. F076–F083.
- Research default pair: `gpt-5.6-sol:xhigh` and `grok-4.6:xhigh`. Quality: `gpt-5.6-sol:xhigh`. Picture: `gpt-5.6-sol`.
- Coordinator CPU workers and later resumes use `gpt-6-astra:xhigh` at the owner's request.

## NOW

- `F048-hosted-runtime-start` (🟠 ACTIVE): spawn prints the ID in seconds; the detached supervisor starts pi and owns the job. This closes the live 2026-08-27 caller-timeout orphaning before F049.
- `F074-claude-perspective` (🟠 ACTIVE): a detached job runs on Claude instead of Pi, so the coordinator can buy a perspective on interface and feature shape. Interleaves with the seat work; gates nothing.
- `F081-spawn-refuses-an-unusable-route` (🟠 ACTIVE): spawn rejects an unusable route before planting a job; boundary: spawn preflight and hosted-start argument transport, with no retries or model selection.
- `F085-sweep-skips-settled-jobs` (🟠 ACTIVE): a coordinator stops re-walking settled jobs on every sweep, and stops holding a core at 90–98%; boundary: the wake hook's sweep, its watcher filter, and the status redraw, with the wake protocol unchanged.

## NEXT

- `F086-job-history-can-be-retired` (🔴 PLANNED): an operator retires finished job records, so months of history stop setting session-start and sweep cost; boundary: the prune command, with worktree pruning unchanged. After F085.
- `F049-running-owner-truth` (🔴 PLANNED): reaper adopts a hosted job that lost its supervisor, fails one with no live owner; no shape-based skips. Before F013.
- `F013-remote-seat` (PLANNED): one disk, attach don’t clone; docs and seat-shaped guarantees. Before F014.
- `F014-github-doorbell` (PLANNED): mention or label starts a job on the seat; comment back evidence; merge stays human.
- `F075-closing-overview` (🔴 PLANNED): the coordinator closes with where we are whenever it hands back with work in flight. Register rule plus the per-turn cue; no new state.

## PROVEN

- `F083-spec-folder-says-one-thing-once` (🟢 PROVEN): specs keep one check and one constraint per line, and delete files when they stop being true. Landed `7d966e5`. Review PASS of `e386591`.
- `F078-a-picture-is-evidence-when-seen` (🟢 PROVEN): visual evidence names what opened frames showed; identical frames that should differ fail the check. Landed `5067c69`. Review PASS of `5067c69`.
- `F077-evidence-outlives-the-worktree` (🟢 PROVEN): proof runs at the clean candidate commit, retained artifacts reach review, and mismatched evidence is unverified. Landed `cf3e9e0`. Review PASS of `85d57d2`.
- `F084-every-number-arrives-with-its-meaning` (🟢 PROVEN): the reply cue and the specs reminder name the failing sentence, not the property; the identifier rule leads the Human register. Landed `0d3f2fd`. Coordinator-inspected.
- `F079-job-line-shows-changed-files` (🟢 PROVEN): a running job line shows its changed-file count; a missing worktree leaves the signal absent. Landed `a98fa51`. Coordinator-inspected.
- `F082-handoff-points-at-the-board` (🟢 PROVEN): a handoff points at the board line that owns its boundary; changes and steers name that line instead of duplicating the rule. Landed `88a2627`. Coordinator-inspected.
- `F080-one-correction-reaches-every-job` (🟢 PROVEN): `limen steer --running` delivers one correction to every watched live job and reports targets that end during delivery. Landed `4006f2e`. Coordinator-inspected.
- `F076-worker-attacks-its-own-candidate` (🟢 PROVEN): the worker names the acceptance line most likely to be false, writes that check, and reports what it showed. Landed `81f85ae`. Coordinator-inspected.
- `F070-research-fan-out` (🟢 PROVEN): human-asked research on different models, then a judge that names divergence. Named sources only. Landed `8233fb1`. Review PASS of `c02f8f8`.
- `F073-picture-pass` (🟢 PROVEN): after a merge that moved a shape, rewrite one living diagram. Landed `8259cb1`. Review PASS of `adf6542`.
- 2026-09: 31 landed. Hosted jobs end themselves; review loops stop at a ceiling; a failed turn is visible; a tab title says what the work changes. spec/features/done/2026-09/
- 2026-08: 44 landed. Hosted jobs run in a named tab; wakes retry; the process tree is contained. spec/features/done/2026-08/
