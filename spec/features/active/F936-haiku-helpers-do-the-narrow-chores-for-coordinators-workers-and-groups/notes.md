# F936 notes · the Haiku steering page

`haiku-steering.html` in this folder (copy: `~/Downloads/limen-haiku-steering.html`) shows in five graphs where Limen should tell a lead to use a Claude Haiku 5.5 helper, how, and when not to. The group lead (Opus 5.5) built it on 2026-10-10 from a read-only two-team group, `bf972fbe-e1ed-4458-b2ab-8353ff0a2092`. Team findings: `group/teams/team-1-findings.md` (Sol) and `group/teams/team-2-findings.md` (Opus).

## Recommendation

Put the rule in prose where the lead decides, add one helper role, and make the completion wake tell the truth. No automatic routing. Order:

1. Add `claude-haiku-5-5` to the local OMP Claude bridge. Today the requested model silently runs Haiku 4.5.
2. Add `templates/scout.md`: one question, no edits or commits, a packet of at most 15 lines and 1,200 characters with `Verified:` on line 3. The wake clips the tail first (`handoffExcerpt`, `src/job/wake-text.ts`).
3. Save the requested model at spawn. One session reader shows the served model and token totals in `limen jobs`.
4. Wake: a served-model line on a known mismatch only, and "nothing to land" for a scout instead of "land it".
5. After the pilot keeps a chore: a use / not-use / escalate table in `templates/agents.md`, and the helper model on the board.
6. If the pilot keeps triage: one clause in the shared failed-job wake sentence.
7. After Adam's allowance answer: the team-scout line in `coordinator.md` and the matching `hook/group-peer.ts` rule.
8. After the pilot proves the route: a worker's own scout through the OMP overlay (`task.agentModelOverrides`).

Cut by both teams: a spawn-time hint from the task's shape, a wake-side `Verified:` parser, a group-peer reminder, a cabinet pile-up hint, and any conditional system-prompt line.

## Waiting on Adam

- Approve the pilot in `pilot.md`.
- A team scout uses one team launch slot (both teams and the study recommend this), or a separate helper allowance.
- After three pilot rows: whether the helper model joins the board's standing models.

## Found on the way

- An OMP coordinator woken through Herdr gets "before landing" for every state, also for a failed job (`src/integrations/coordinator-wake.ts:83`). Fix it in the slice for step 4.
- The owner-facing lead pane has no `LIMEN_GROUP_ID`, so its digest or candidate-table helper is outside the team allowance.
- Claude Code's `Explore` agent now uses the main model unless a project sets `model: haiku`; the brief assumed Haiku.

## Group record

- Team 1 ran `openai-codex/gpt-6-sol`; team 2 ran `pi-claude/claude-opus-5-5` (served model checked in its session). Both ran at `xhigh`: `group start` takes one reasoning level for all teams, and Adam asked for Sol at `high`.
- Team 1's only worker launch timed out at 35 seconds before the engine started (`2026-10-10-f936-team-1-findings-08a88277`, recorded as failed). Its coordinator wrote the findings without a second launch.
- The teams changed each other's results: team 2 cut its spawn hint after team 1's challenge; team 1 accepted team 2's OMP wake override, the mismatch wake line, and the lead-slot finding.
- Not run: no model probe, test, or pilot. Every source on the page was fetched on 2026-10-10.
