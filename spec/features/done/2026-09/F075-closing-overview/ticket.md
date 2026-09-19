# F075 · The coordinator closes with where we are

## Outcome

When the coordinator starts jobs and hands control back, its reply ends with a short overview in plain language: what is finished, what is running and which job has it, what is waiting on the owner. The owner can look away for an hour and pick the thread up from that last message alone, without running `limen jobs` or scrolling the conversation. It arrives unprompted on the turn that starts work and on every wake, and it is the one place the register allows a second form inside one reply.

## Scope

- The rule belongs in the speech register (`templates/communication.md`), beside the reply shapes it makes an exception to.
- The cue belongs in the per-turn note `hook/communication.ts` builds for the human audience, so it rides every user message and every wake rather than the system prompt.
- Name the trigger in prose — control returning to the owner with work in flight — and let the coordinator judge whether this turn is one. No live-job counter in the hook, no new job state.
- Say what the overview is made of and what it must not become: product words with the feature named, one line per item, no job ID as the subject of a sentence, no restating the reply above it.

## Out of scope

- A `limen` subcommand that prints an overview. The board and `limen jobs` already carry that state.
- The system prompt and the board digest. The cue is per-turn, where the wake cue already lives.
- The overview on agent-audience replies. A worker or reviewer does not report to the owner.
- A todo file, a progress field, or anything a parser would read.

## Acceptance

- The per-turn note carries the overview cue on an ordinary human turn and on a wake turn, and a job session's note does not carry it.
- The register names the overview: when it is owed, the three things it holds, and the exception it makes to one form per reply.
- In a live session, a coordinator reply that spawns and hands back ends with the overview; a reply that answers a question with nothing in flight ends without one.
- `npm run check` passes.

## Notes

- The register already says the reply is as big as the question, and that a heading for one part and a loose paragraph for another is neither. Unless the exception is written beside those lines, the coordinator will read an unprompted overview as over-answering and drop it.
- The nearest existing rule fires when a wave of jobs finishes — "what landed, then what you can try now". This one fires when a wave starts, and repeats while it runs.
