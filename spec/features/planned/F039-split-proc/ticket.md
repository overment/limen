# F039-split-proc · One job per file in the process/runtime pile

[2026-08-25] [🔴] [PLANNED] [COORDINATOR] PLANNED · F039-split-proc

## Outcome

`src/proc.ts` is no longer four jobs in one file. A reader can open containment, the detached wrapper, or the hosted supervisor without crossing the others. Unused exports are gone. `CONTRIBUTING.md` names the line cap the structure test actually enforces.

## Scope

- Split `src/proc.ts` (~604 lines) along the jobs it already has: process identity / escaped-descendant containment; dead-job reaper + `liveJob`; detached wrapper + finalize + event log; hosted supervisor + idle advisory.
- File names must be unique across the whole repo (`test/structure.test.ts` checks full basenames, so `hosted.ts` is taken by `hook/hosted.ts`; `finalize.ts` would technically pass beside `finalize.test.ts` — avoid it anyway, that test name already means proc's finalize). Suggested cut, one per job above: `contain.ts`, `reap.ts`, `wrapper.ts`, `supervisor.ts` — worker may choose others that do not collide.
- Do not add `index.ts`, `types.ts`, `utils.ts`, or a shared helper bag. `atomicWrite` / `appendLimenLog` live next to finalize (their only interesting caller cluster), not in a new kitchen sink.
- `writeHostedResult` is the one private function both the reaper and the supervisor call. It lives with the supervisor (it reads hosted session transcripts); the reaper imports it. That newly exported seam is expected — it is not a reason for a shared bag.
- Unexport or delete what nothing imports: `processAlive`, `ProcessIdentity`, `listEscapedDescendants` (keep it file-private under `discoverEscapedDescendants`). `DEFAULT_TIMEOUT_MS`, `MAX_TOOL_CALLS`, and `hostedIdleMs` also have no importers — they keep their code and lose the `export`.
- `requireNodeMajor` is unused at runtime on purpose — `bin/limen` must reject old Node *before* it imports TypeScript. Delete the export and its unit test, or keep the function only if `main()` calls it as a second line. Do not invent a third copy.
- `CONTRIBUTING.md` says `src/` is capped at 1200 lines; `test/structure.test.ts` says 2750. Make the doc match the test. Do not raise or lower the cap in this ticket.

## Out of scope

- Behavior changes to stop, reap, hosted idle, or finalize. This is a move, not a rewrite.
- Retiring `limen migrate` or the `[control ` log prefix (F040).
- Deduplicating `text()`, `recoverClaim`, or pulse (F038 owns pulse).
- Linux `proc_pidinfo`. F007 stays macOS-shaped; F013 already documents that.

## Acceptance

- No `src/proc.ts`, or it is a short re-export-free leftover that the structure test would reject if it becomes a bag. Prefer it gone.
- Each new file has one job a reader can name in a sentence.
- No `import` anywhere names `processAlive` or `listEscapedDescendants`. (`rg processAlive` still hits `job.ts` / `jobs.ts` / `job.test.ts` — the unrelated `JobView` field and locals; those stay.)
- `CONTRIBUTING.md` cites 2750, not 1200.
- Every existing test still passes without scenario rewrites — updating their `../src/proc.ts` import paths is expected, the scenarios are not. `npm run check` green. Source still ≤ 2750 lines.

## Notes

Found in the 2026-08-25 source review. Do not start until F032 is proven or dropped — the supervisor loop lives here, and a move on top of an unproven relocate path is how the prove gets lost.

After F038 (landed `54e678c` — pulse imports have their stable home) and after F045, whose supervisor-escalation surgery lands in `proc.ts` before the split moves it. Process-control blast radius: fresh reviewer on the split, even if the diff is mostly moves.
