# F002-stage-model-defaults · Outcome

[2026-08-14] [🟢] PROVEN

## Landed

- Ordinary jobs use `LIMEN_WORKER_MODEL` when no `--model` flag is supplied.
- Review jobs use `LIMEN_REVIEWER_MODEL` when no `--model` flag is supplied.
- An explicit `--model` wins over either stage default; no default leaves Pi to select its own model.
- The README and coordinator shop-manual template explain routine environment policy and per-ticket overrides.

## Evidence

`npm run check` passed: strict TypeScript, Biome, and 42 tests, including worker default, reviewer default, explicit override, and no-default coverage.
