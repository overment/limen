# F011-empty-job-advisory · Do not report an empty job as done

[2026-08-15] [🟢] [PROVEN] [COORDINATOR] PROVEN · F011-empty-job-advisory

## Outcome

A job that finished without doing anything says so. A coordinator scanning `limen jobs`, or reading a completion wake, can tell the difference between a worker that delivered and a worker that never started — without opening the session file.

## Scope

- Notice, from facts already written to `.limen/jobs/<id>/`, that a terminal job produced no work: no tool calls, and no commits on its branch.
- Say so in `limen jobs` output and in the completion wake, beside the existing terminal state.
- Where the stream makes a provider or model failure visible, record that reason in the job log so the cause is durable rather than buried in the session file.
- Keep it advisory. An empty job is still `done` if `pi` exited 0; the harness reports, it does not re-classify or gate.

## Out of scope

- Retrying, resuming, or respawning a job automatically.
- Model fallback, quota checking, or any provider-specific logic.
- Changing what `done`, `failed`, and `stopped` mean.
- Blocking a merge, or refusing to display a job.

## Acceptance

- A job that exits with zero tool calls and no commits is visibly marked as having produced nothing, in both the compact `limen jobs` snapshot and the detailed view.
- The completion wake for such a job carries the same signal, so a coordinator is not told that work is ready to inspect when none exists.
- A job that made tool calls but no commits — a survey, or an honest question-and-exit — is not mislabelled as empty. Report what is observed, not a verdict about whether it was useful.
- Where the underlying failure is visible in the stream, `limen jobs <id>` shows the reason without the reader opening the session JSONL.
- Existing terminal states are unchanged, and every current test still passes.

## Notes

Observed on 2026-08-15. Job `2026-08-15-f009-steer-channel-6fa9c051` ran for five seconds, made zero tool calls, wrote no commits, and was reported `DONE F009 steer channel`. The session file held the real story:

```
"stopReason": "error",
"errorMessage": "Codex error: The usage limit has been reached"
```

`pi` exited 0, so `src/proc.ts` correctly recorded `done: pi exited 0`. `AGENTS.md` already warns that `done` means the process exited cleanly, not that the ticket is finished — but here the display was actively reassuring about a job that never ran. Limen's whole recovery model rests on the coordinator reading job records honestly, so a falsely calm record is worse than a noisy one.

The facts needed are already on disk: `tool-calls` is written by the wrapper, and the branch is known. This should not require new state, a provider integration, or a change to how jobs terminate.
