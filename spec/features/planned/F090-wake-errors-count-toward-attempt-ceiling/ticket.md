# F090 · Wake errors count toward the attempt ceiling

## Outcome

An unchanged job notification stops after two unsuccessful automatic attempts,
including provider `error`, `aborted`, and persistent injection failures. The
pending claim stays inspectable. Recovery is deliberate. Native wake storms
under provider outage (retro: 10,480 wakes across five coordinators) stop.

## Scope

- `hook/wake.ts`: charge `error` / `aborted` / rejected injection toward the
  existing two-attempt ceiling (do not leave them on `releaseUncounted()` alone).
- Apply the ceiling to completion and advisory delivery, including fallback.
- After exhaustion: retain an undelivered claim; durable log + local status;
  no further automatic model turn for that unchanged event.
- A timer, reload, new fallback listener, or late confirmation must not silently
  reopen an exhausted event.
- Advisory rearming only for genuinely new advisories / resumed work.
- Extend `test/wake-hook.test.ts` and `test/wake-sweep.test.ts`. Change the
  test that currently expects provider-error turns to release without spending
  an attempt.
- Align with F042 delivery-integrity ceiling intent.

## Out of scope

- Finish webhooks / Grok HTTP (F091).
- Automatic provider fallback or model switching.
- Increasing ping frequency or prompt rules that say “stop retrying.”
- A notification daemon.

## Acceptance

- Failing replay first: one unchanged advisory, repeated accepted injections
  whose turns end `error` → exactly two unsuccessful attempts; no third after
  further sweeps and listener restart; no `delivered` receipt; durable blocked
  reason present.
- Same bound for completion, `aborted`, rejected injection, and fallback;
  competing listeners covered; successful fan-out still works.
- One bounded probe against the installed Pi hook with a controlled failing
  provider records event order, transcript count, and job files (mock alone is
  not enough for installed settlement).
- Focused wake suites pass. Adam reviews; no independent reviewer.

## Notes

Adam lock 2026-09-10: two unsuccessful auto attempts then deliberate recovery;
park-and-preserve on quota (quota policy is board/handoff, not this ticket's
runtime). Source: `limen-ops-retro-2026-09-10.md` + remediation approach
`daacd537`.
