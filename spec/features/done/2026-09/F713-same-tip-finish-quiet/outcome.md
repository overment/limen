# Outcome

After an automatic finish already notified the owner for a settled git tip, another job at that same tip stays quiet and records `skipped: same settled tip already notified; not sent`. Empty failed and stopped skips still do not consume the tip; a different tip still sends. Landed `1cd1f68`, evidence `9f3917c`, fast-forwarded to main as `9f3917c`. Worker native lane: TypeScript, Biome, and 399/399 tests passed in 571s. Adam reviews; no independent reviewer. A send attempt claims the tip even when HTTP later fails, which is the idempotent choice over retrying a duplicate.
