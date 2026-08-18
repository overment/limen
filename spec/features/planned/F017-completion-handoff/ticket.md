# F017-completion-handoff · The wake carries what landed, and hosted done means the session ended

[2026-08-18] [🔴] [PLANNED] [COORDINATOR] PLANNED · F017-completion-handoff

## Outcome

A coordinator reading a completion wake knows what the job produced without opening the job record: the worker's final message and the commits on the branch. A hosted job is finalized when its session actually ends, not when it has been quiet for 90 seconds.

Observed cost today (F016 notes, section 4): the wake names label, state, id, and branch only. F015 (`2026-08-18-f015-steering-map-f4c8ed9c`) was marked `done` at `09:01:31` on `hosted idle 90s after tools` while the session kept reading until `session-ended` at `09:04:09`; the coordinator had to open the job to learn there was no deliverable.

## Scope

- **Result capture, detached.** `runInternalJob` in `src/proc.ts` already parses the pi JSON stream. Keep the last assistant message text and write it to `.limen/jobs/<id>/result` (plain text) when the job finalizes with `done`. A job that dies mid-turn may have no `result`; that absence is information.
- **Result capture, hosted.** The hosted supervisor (`runHostedSupervisor` in `src/proc.ts`) finalizes hosted jobs. At finalize, read the last assistant message from the newest session jsonl under `.limen/jobs/<id>/session/` and write the same `result` file. Parsing one jsonl file for the last `type=message`, `role=assistant` entry is in scope; a session-format abstraction is not.
- **Commit capture.** At spawn, record the worktree's starting HEAD in `.limen/jobs/<id>/base` (spawn already knows the repository and plan in `src/commands/spawn.ts`). At finalize, write `git log --oneline <base>..<branch>` to `.limen/jobs/<id>/commits` (may be empty).
- **Wake content.** `sendCompletion` in `hook/wake.ts` appends to the existing wake text: the commit lines (bounded, say first 10) and the first lines of `result` (bounded, say 15 lines / 1200 characters), each clearly labeled and each omitted when the file is absent. The existing pointer sentence stays; the wake remains an advisory, not the merge decision.
- **Hosted completion.** Replace the `HOSTED_IDLE_DONE_MS = 90_000` unseen-idle path with session-end detection: finalize `done` when the hosted pi session ends or the agent target vanishes. This is the vision line "hosted jobs end when the session ends, not when Herdr says unseen-idle `done`". If Herdr 0.8 offers no reliable session-end signal, raising the idle floor is not an acceptable substitute — say so in a question file and stop; that is a product tradeoff.
- **`limen jobs <id>`** prints `result` and `commits` when present (`src/commands/jobs.ts` already prints log and diff excerpts).

## Out of scope

- Deciding or reporting whether the ticket is finished. `done` still means the process or session ended.
- F011's empty-job advisory wording. F011 stays its own feature; after F017 it can read `commits` and `tool-calls` instead of inferring. Do F017 first.
- Retrying, resuming, or classifying failures. Provider-failure reasons stay F011.
- Changing detached timeout, tool-call cap, or containment.
- Any new wake channel; only the text of the existing completion wake changes.

## Acceptance

- A detached fake-pi job that emits a final assistant message and one commit finishes with `.limen/jobs/<id>/result` holding that message and `.limen/jobs/<id>/commits` naming that commit; the completion wake text contains both, bounded.
- A hosted job finalizes `done` at session end. A test (or, if Herdr cannot be faked, a written live-trial note beside this ticket) shows a session idle longer than 90s after tools that is not marked `done` while still open.
- A job stopped with `limen stop` finalizes without `result` fabrication: absent file, wake says state only.
- `base` is written for new-branch, reuse-branch, and `--review` detached worktrees.
- `limen jobs <id>` shows result and commits for a terminal job that has them.
- `test/structure.test.ts` still passes; any new `src/commands/` file is reflected there. `npm run check` green.

## Notes

Evidence and seams: F016 notes sections 4 and "Concrete gap"; `finalizeJob` and `runHostedSupervisor` in `src/proc.ts`; `sendCompletion` in `hook/wake.ts`; F015 job record on disk. The wrapper already tracks `tool-calls` and `last-tool`, so finalize-time writes have precedent. Keep `result` raw text — no JSON envelope, no parser on the read side.
