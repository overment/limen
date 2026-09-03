PASS `304380970715e28a067839a4f7b6ca5456a7b36f`

F053 candidate: shop manual, speech register, vision, and styleguide ride the system prompt once per call; board digest last; the per-turn note is a short cue; write/edit/spawn/merge tool results recall the matching rule. Checkout matches the named candidate. Nothing blocking remains.

**Checks**

- `git rev-parse HEAD` → `304380970715e28a067839a4f7b6ca5456a7b36f` (matches the named candidate; worktree clean).
- `node --test --test-concurrency=1 --test-timeout=60000 test/communication-hook.test.ts test/structure.test.ts` → 21 pass, 0 fail (hook suite 17, structure 4).
- Read `hook/communication.ts`, `test/communication-hook.test.ts`, spawn/wrapper `LIMEN_JOB` / `LIMEN_CONTEXT_ROOT` wiring, and Pi `before_agent_start` / `tool_result` (override persists for the tool loop; `{ content }` patches the result).
- `tsc --noEmit` and `biome check` not run: this worktree has no `node_modules`. Unverified, not blocking.

**Acceptance (met in code and hook tests)**

- Two human turns with unchanged files share a system prompt; a wake turn matches; wake text is in the cue, not the prompt.
- Order is Pi’s prompt, shop (when no project `AGENTS.md`), register, vision, styleguide, NOW/NEXT digest last.
- Cue stays under 1KB in the tests; fifty simulated turns stay under 50KB of custom-message content.
- `write` to `spec/features/planned/F999-x/ticket.md` ends with the Specs reminder; `edit` of `src/x.ts` with the styleguide reminder; bash `limen spawn` with the vision reminder.
- Hosted worker (`LIMEN_JOB=1`) gets styleguide and both register audiences, no board/vision/shop bodies; ticket path and read-only pointers sit in the cue.

**Notes (non-blocking)**

- Proven: the old build-board missing-folder advisory is gone from the per-turn note (`buildAdvisory` removed in `hook/communication.ts`). F053’s cue is audience, reply rules, last touch; that advisory is not in acceptance.
- Proven: `isVisionCommand` in `hook/communication.ts` uses `\bgit\s+merge\b` / `\blimen\s+spawn\b`, so `git merge-base` and `limen spawn-hardening` also get a vision reminder. Noisy, not an acceptance miss.
- Proven: worker ticket-path cue only parses `Ticket: <token>` in `.limen/jobs/<id>/task.md`. Conventional implement spawns include that; many review task texts do not. The task file still names the ticket.
- Proven: leftover/overlay drift still rides the coordinator cue (`formatDrift`). It stays small; F054 is the overlay ticket.

Verdict: PASS.

Candidate commit: 304380970715e28a067839a4f7b6ca5456a7b36f.
