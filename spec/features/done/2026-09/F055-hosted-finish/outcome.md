# Outcome

A hosted worker ends its job with `finish`: the job records `done` with the handoff as the result. `limen stop` with a `done:` reason records `done` and does not wake the stopping session. An idle hosted worker whose last turn had no tool call and a clean worktree also records `done`.

Landed `40873ed`. Review PASS of `b220dcf`. Live prove of a real tab calling `finish` was not run here.
