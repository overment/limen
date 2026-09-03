# Outcome

When the previous coordinator turn died on a provider error, the next reply’s cue says so and what was lost. A hosted worker whose last assistant turn is `error` past the idle window gets an `errored:` advisory and a wake that says the turn failed, not that the job is idle. The job is not recorded `failed` on that single turn.

Landed `d05b7fa`. Review PASS of `8520633`.
