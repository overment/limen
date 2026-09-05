# F081 · A spawn refuses a route it cannot use

## Outcome

A spawn whose model or provider cannot serve the job fails at the command with
that reason, instead of creating a job that dies on its first turn. At Alice 14
jobs in one day reached zero tool calls; detached spawns died at start twice as
often as hosted ones, 8 of 41 against 6 of 66, on `404 … only available through
the Batch API` and `No API key found for amazon-bedrock`. One hosted start died
on `agent arguments cannot be encoded safely for the target shell` with an
ordinary task. Jobs dying at start rose from none to eight a day over five days.

## Scope

- Start in `src/commands/spawn.ts`, whose preflight already validates the base
  commit before the job directory exists: check the resolved model and provider
  the same way, and fail with the provider's reason.
- The hosted start path encodes its agent arguments the way the detached path
  already does, so an ordinary task cannot be unencodable.
- A job that fails preflight leaves no directory, as F058 already requires.

## Out of scope

- Retrying a provider call; Pi owns retries.
- Choosing or ranking models, which stays human judgment on the board.
- Failing a job whose first turn errors after a valid start (F057).

## Acceptance

- A spawn naming an unusable model exits non-zero with the provider's reason and
  leaves no job directory.
- A spawn naming a usable model is unchanged in behaviour and output.
- A hosted spawn whose task contains quotes, backticks, and newlines starts its
  agent.
- The spawn-command and hosted-spawn suites pass.

## Notes

Reviews are always detached, so this failure lands hardest on the round that is
supposed to be the independent check.
