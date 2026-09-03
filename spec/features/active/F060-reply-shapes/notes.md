# F060 notes

## Seams

- `templates/communication.md` Human register. Specs and Agent untouched.
- `test/communication-hook.test.ts` — inherited package register asserts the five phrases.
- Hook cue unchanged. Out of scope was mechanism beyond a cue that names the shape; the register names the shapes.

## Decisions

- Explanation is a fourth size-shape beside answer, update, report: past tense, no new action, no tool call, no next step.
- Where-we-are is a fifth shape with the ticket's order: what works now; what is being built and by whom; what is blocked and on what.
- Wave report lives under Reporting work: one unprompted report, then what you can try now.
- Closed-job wake is a clock-stopped bullet. Pasted-register, deviation, and caption sit after the form paragraph.
- Before you send gained "Is this a caption?" and "Did the owner ask why?"

## Added sentences and why

Ticket Alice stats, not a numbered audit file in-repo:

- Explanation / "did the owner ask why" — "why did you do that" six times while the coordinator kept acting.
- Where we are — status asked 32 times in four days.
- Wave report — a finished wave should say what you can try now.
- Caption / "is this a caption" — a caption between tool calls is not a reply.
- Pasted-register sentence — a pasted style instruction holds for the rest of the conversation.
- Closed-job sentence — a wake for a job already closed is not news.
- Failed-turn line already present from F057.

## Probes (2026-09-03)

Isolated `pi -p --no-tools --no-session --no-extensions --no-skills --no-context-files --thinking off --model openai-api/gpt-5.6-sol` with `templates/communication.md` appended and audience cue as system prompt.

- Prompt `why did you do that?` → "Which action do you mean? I don’t have enough context in this thread to identify it." No tool call, no next step.
- Same prompt after a last-turn note that two extra reviews were spawned past a stop → past-tense admission, no tool call, no next step, no offer to act.

## Open

`templates/.history/communication.md` refresh after the register commit (`LIMEN_WRITE_HISTORY=1 node --test test/inherit.test.ts`).
