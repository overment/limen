# F060 · The human register gains the explanation, status, and wave-report shapes

## Outcome

The owner gets the shape of reply the moment calls for: a question about the past is answered in the past tense with no new action; "where are we" is answered in product words in a fixed order; a finished wave of jobs produces one unprompted report that says what can be tried now; a caption or a bold heading between tool calls is never sent as a reply; a pasted style instruction holds for the rest of the conversation; a wake for a job the coordinator already closed is not news. At Alice the owner asked for plain language 31 times and for status 32 times in four days, repeated "why did you do that" six times while the coordinator kept acting, and read 65 replies that said only "already handled".

## Scope

- `templates/communication.md`, Human register: a fourth reply shape, the explanation; the "where are we" shape (what works now, what is being built and by whom, what is blocked and on what); the wave report with "what you can try now"; a deviation from the default is stated in the same reply with its reason; a pasted register governs the conversation; a wake for a closed job gets one line or nothing; the previous turn failed line (F057).
- The "Before you send" list gains: is this a caption; did the owner ask why.
- Keep the file under its thousand-line cap; every added sentence earns its place by a transcript in the audit.

## Out of scope

- The Specs section and the Agent register.
- Mechanism in the hook beyond the cue that names the shape.
- Worker and reviewer prompts (F062, F063).

## Acceptance

- The register contains the explanation shape, the "where are we" order, the wave report, the pasted-register sentence, and the closed-job sentence; the hook test asserts each phrase.
- A probe turn with the prompt "why did you do that?" against the register yields a reply with no tool call and no next step, checked by the same model-probe method F041 used.
- The file stays under the cap and the structure test passes.

## Notes

The 2026-09-02 rewrite already carries the identifier rule and the clock-stopped section; this ticket adds the shapes the transcripts still lacked.
