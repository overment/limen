PASS 3ec3f21397b7329d81bfb8b4205afadc34bae4d5

F069 candidate `3ec3f21397b7329d81bfb8b4205afadc34bae4d5` (`feat: spawn --role loads a named preamble and space`) matches `git rev-parse HEAD`. No blocking acceptance break.

**Acceptance**

- **proven** `limen spawn --role <name>` with overlay `.agents/limen/<name>.md` writes `role`, loads that preamble, opens `<project> <name>s`, and a second spawn reuses the space (`test/spawn-command.test.ts`, `test/hosted-spawn.test.ts`). Package `templates/<name>.md` is the same `resolvePreamble` path already used for worker/reviewer.
- **proven** `--review` still requires `--branch`, writes `candidate`, loads the reviewer preamble, opens `<project> reviewers` (`test/spawn-command.test.ts`, `test/hosted-spawn.test.ts`).
- **proven** missing preamble or `--role` plus `--review` exits 1 and plants no job (`test/spawn-command.test.ts`).
- **proven** `limen continue` on a `--role` job without `--review` inherits `role` and that preamble (`test/continue-command.test.ts`).
- **proven** worker/reviewer with no `--role` keep prior spawn mode, models, spaces, and birth text. `role` is now written on every job, which the ticket asked for (`src/commands/spawn.ts`, existing spawn/review tests).
- **proven** `src/` cap moved 3348 → 3353 with the one-line audit in `test/structure.test.ts`. Counted 3313 lines.

**Notes**

- **plausible** Hosted sidebar `limen <role>` is wired (`hook/hosted.ts`, `LIMEN_ROLE` in `startHosted`) but no test asserts `display-agent limen researcher`. Worker/reviewer restore still asserts `limen worker` / `limen reviewer`.
- **plausible** `--role` is restricted to `^[a-z][a-z0-9-]*$`. Ticket does not require that; it is extra, not an acceptance miss.

**Checks**

- `git rev-parse HEAD` = `3ec3f21397b7329d81bfb8b4205afadc34bae4d5`
- `npm ci` from `package-lock.json` (12 packages)
- `npx tsc --noEmit` — pass
- `node --test --test-concurrency=1 --test-timeout=60000 test/spawn-command.test.ts test/continue-command.test.ts test/hosted-spawn.test.ts test/structure.test.ts` — 76 pass, 0 fail (243s)
- biome / full `npm test` — not run
