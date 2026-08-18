# F015-harness-steering-map · How the harness currently steers agents

[2026-08-18] [🟢] [PROVEN] [COORDINATOR] PROVEN · F015-harness-steering-map

Status marks are prose: 🔴 PLANNED · 🟠 ACTIVE · 🟢 PROVEN · ⚪ DROPPED. Update the line when the folder moves. Nothing in `limen` parses it.

## Outcome

One notes file a coordinator can read without opening the hook source, naming every layer that currently steers an agent, when each layer arrives, and where the F008 write-up no longer matches the code.

## Scope

- Survey only. Deliverable is `notes.md` in this folder.
- Map the layers that reach a worker or coordinator LLM: birth preamble, project context, speech register, styleguide, shop manual, mid-flight `limen steer`, hosted in-tab typing.
- For each layer: file, hook or flag that injects it, trigger (user message, every LLM call, session start, inbox), audience (`human` vs `agent`), and whether it is visible in the thread.
- Compare this tree to the installed package if they differ.
- Note F008's documented restack (`context` handler, speech last on every LLM call) against `75490ec` (speech folded into the system prompt).

## Out of scope

- Changing any hook, template, or prompt.
- Designing a better steering scheme.
- F011 / F013 / F014 work.

## Acceptance

- `notes.md` exists in this folder and names each steering layer with a path and a trigger.
- It states whether speech is a restacked thread message, a system-prompt append, or both — in this tree and in the installed package.
- It records one concrete drift or surprise, or states that source and install match.

## Notes

Starting seams, not a complete map: `hook/communication.ts`, `hook/steering.ts`, `hook/inherit.ts`, `templates/worker.md`, `templates/reviewer.md`, `templates/limen-extension.ts`, `src/commands/spawn.ts` (`--append-system-prompt`, `LIMEN_JOB=1`), `src/commands/steer.ts`. This conversation's installed package still appeared to inject `<limen-communication>` as a message; the source comment says speech is appended to the system prompt.

Shape: survey. No commit of product code.
