# F074 · A second opinion from Claude

## Outcome

The coordinator can buy a perspective from Claude the way it already buys research or a quality pass: one detached job in its own worktree, a wake when it finishes, and a final message the coordinator files as a report. Claude arrives with the design, browser, and documentation tooling configured on the operator's machine, which the Pi sessions here do not have, so questions about interface shape and feature specification stop being answered from a text-only session's recall. The job advises: it never merges, never edits the board, and never writes code.

## Scope

- A spawned job may run `claude` instead of `pi`, chosen by a flag on `limen spawn` that is orthogonal to `--role` — a role names a preamble, an engine names a binary.
- The seam is `src/wrapper.ts`, where the child process and its arguments are built; everything downstream of the job record already ignores which agent wrote it.
- Claude's `--output-format stream-json` reaches that record as the same log, activity, tool count, and final result a Pi job writes. `src/stream.ts` is where the translation belongs.
- One role preamble beside `templates/researcher.md`, and one paragraph in `templates/agents.md` saying when the coordinator reaches for it.
- Detached only. This rides the named-role seam that already gives workers, reviewers, and researchers their own preamble and space (F069); every job kind so far has been a Pi session.

## Out of scope

- Hosted (`--tab`) Claude jobs. A Claude job has no interactive tab.
- `limen steer` reaching a Claude job; steering rides a Pi extension the other engine does not load.
- Cloud sessions on Anthropic infrastructure. `claude --cloud` refuses to start without a terminal, so that is a different shape with a different result-collection problem.
- Letting the perspective job commit or merge.

## Acceptance

- A spawn naming the Claude engine prints a job ID, and `limen jobs <id>` shows it running with a live tool count and log tail.
- On a clean finish, `.limen/jobs/<id>/result` holds Claude's final message and the subscribed coordinator gets the ordinary completion wake.
- A run that ends in error records `failed` with the reason, as a Pi job does; `limen stop <id>` ends the job and its process group.
- The Pi path is untouched: `npm run check` passes and a spawn without the engine flag still runs `pi`.

## Notes

- Claude's result JSON carries its session id. Recording it beside the job leaves `limen continue` on a Claude job possible later without deciding it now.
- `claude -p` inherits the operator's own configuration, so the job arrives with whatever tools that machine has. That is why it beats a cloud VM here, and why the preamble must say plainly what the job may touch.
