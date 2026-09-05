# F080 · One correction reaches every running job

## Outcome

The coordinator delivers a single correction to every live job it watches with
one command, instead of retyping it per job. At Alice a merged baseline fix had
to reach three workers at once and the same message was sent three times by
hand; 33 steers went out across 21 jobs in one day.

## Scope

- Start in `src/commands/steer.ts`: `--running` addresses every live job this
  conversation watches instead of one id or label.
- The command prints which jobs it reached, so a job that ended between
  selection and delivery is visible rather than silent.
- Delivery, ordering, and the inbox format are the ones a single steer already
  uses.

## Out of scope

- Steering jobs this conversation does not watch.
- Stop, resume, or any other command gaining a fan-out flag.
- Retrying delivery to a job that has already posted its handoff, which is a new
  spawn (F061).

## Acceptance

- With two live watched jobs, `limen steer --running "text"` places the same
  message in both inboxes and prints both job ids.
- With no live watched job, the command exits without error and says nothing was
  reached.
- A job that ends between selection and delivery is reported as not reached.
- The steer-command suite passes.

## Notes

`limen watch --running` already subscribes to the running snapshot, so the
selection this needs exists.
