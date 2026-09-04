PASS adf6542b6a6ffefdca232174248e5d8476d682af

Candidate `adf6542b6a6ffefdca232174248e5d8476d682af` matches `git rev-parse HEAD`. F073 (picture pass after a shape moves) holds: the shop manual states the after-merge `--role picture --detached` trigger, the one-clause bar, and `spec/picture.md` as the only destination; `templates/picture.md` exists with history hash `cd590c32b20fe038ed553d1702e90c5c331684406f34ed31925208ab057647ff`; spawn `--role picture` loads that packaged preamble; the prompt forbids invented state and a second file and requires the human register; the coordinator bar is in `templates/agents.md`, not in spawn code.

Findings: none blocking.

Checks run:
- `git rev-parse HEAD` → `adf6542b6a6ffefdca232174248e5d8476d682af` (matches the named candidate).
- `npm ci` from `package-lock.json` → added 12 packages, 0 vulnerabilities.
- `node --test --test-concurrency=1 --test-timeout=60000 test/structure.test.ts test/inherit.test.ts test/spawn-command.test.ts` → 33 pass, 0 fail, including `shop manual states the picture pass after a shape moves`, `picture prompt rewrites one living file and forbids invented state`, `shipped template history matches git log/show of this clone`, and `spawn --role picture loads the packaged preamble`.

Notes:
- PLAUSIBLE: inherit drift `TRACKED` still lists only `agents.md` / `worker.md` / `reviewer.md` / `communication.md`. A project overlay at `.agents/limen/picture.md` will load (named-role seam) but will not be classified leftover/stale. Ticket asked only to ship a history hash and extend the structure-test template list; both landed.
- `spec/picture.md` is not in this commit. A pass creates or rewrites it; acceptance does not require a seed.
