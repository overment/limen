PASS c02f8f88df6128fd3b05766a406e716013985947

F070 research fan-out (`c02f8f88df6128fd3b05766a406e716013985947`) meets every acceptance bullet. `git rev-parse HEAD` matches that candidate.

**Proven acceptance.** Shop manual (`templates/agents.md`) states the human-only trigger, at least two researcher jobs on distinct models then one judge, filing at `report-N.md` / `judgment.md` in the feature folder or `spec/research/<slug>/`, and that the output is a ticket, a decision, or a vision paragraph — never a merge. `templates/researcher.md` and `templates/judge.md` exist; their `.history` first lines match the SHA-256 of current text; `spawn --role researcher` / `--role judge` persist that role and append the packaged preamble (needles `Recalled API is not a source` and `naming where they diverged`). Researcher forbids recalled API, requires a named source, and stops when none is named. Judge must name divergence and must not average. Structure and inherit lists include both new files.

**Note (plausible, not blocking).** Overlay drift in `hook/inherit.ts` still tracks only `AGENTS.md`, worker, reviewer, and communication. A project copy at `.agents/limen/researcher.md` or `.agents/limen/judge.md` is still loaded by `--role` (overlay wins) but will not get leftover/stale notices. Ticket asked for history hashes and the structure-test list, not that tracker.

**Checks run.** `npm ci` from `package-lock.json` (12 packages, 0 vulnerabilities). `node --test --test-concurrency=1 --test-timeout=60000 test/structure.test.ts test/inherit.test.ts test/spawn-command.test.ts` — 34 pass, 0 fail, including `shop manual holds the research fan-out ritual`, `researcher requires a named source and forbids recalled API`, `judge names divergence and forbids averaging`, `spawn --role researcher and --role judge load the packaged preambles`, and `shipped template history matches git log/show of this clone`. Independent SHA-256 of `templates/researcher.md`, `templates/judge.md`, and `templates/agents.md` matched the first line of each history file.

**Not run.** Full `npm test`, `tsc --noEmit`, biome. Diff is templates plus tests; no `src/` change.
