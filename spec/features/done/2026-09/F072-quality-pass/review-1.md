PASS cb61deca75ecd61874ce02aa0864c7d2316bb22b

Reviewed `cb61deca75ecd61874ce02aa0864c7d2316bb22b` (`test: ship quality history hash and lock the ritual`). `git rev-parse HEAD` matches. The tree also contains `4756e33` (`feat: quality pass writes one findings file and never rewrites`).

No blocking findings. All four acceptance bullets hold on the files, not only on the tests.

The shop manual (`templates/agents.md`) states the ten-proven-landings-or-human-asks schedule, `--role quality --detached`, `spec/quality/YYYY-MM.md` (and `-2` in the same month), and that the pass does not rewrite and is not a merge gate. `templates/quality.md` exists; `templates/.history/quality.md` starts with its current sha256. Spawn `--role quality` writes `role` as `quality` and appends that packaged preamble. The prompt judges against `spec/vision.md` and `.agents/limen/styleguide.md`, forbids rewriting, names `spec/quality/YYYY-MM.md`, and limits outputs to drop-candidate, ticket line, or slice.

Checks run
- `git rev-parse HEAD` → `cb61deca75ecd61874ce02aa0864c7d2316bb22b`
- sha256 of `templates/quality.md` → `2eb928b83100694371ddba7154436afef4158db07d60241a25b0edfdbfef42a4`, matches `templates/.history/quality.md`
- sha256 of `templates/agents.md` → `0da5506d180490b5221197aad30a04f841b95ce507cbcc7ed71ded7360167b79`, matches the first line of `templates/.history/agents.md`
- `npm ci` from `package-lock.json` → added 12 packages, 0 vulnerabilities (npm warn: unknown user config `min-release-age`)
- `node --test --test-concurrency=1 --test-timeout=60000 test/structure.test.ts test/inherit.test.ts test/spawn-command.test.ts` → 33 pass, 0 fail, including `shop manual states the quality pass`, `quality prompt judges, forbids rewriting, and names the only outputs`, `spawn --role quality loads the packaged preamble`, and `shipped template history matches git log/show of this clone`

Not run: full `npm test`, `tsc --noEmit`, `biome check`.

Notes
- PLAUSIBLE: the structure pin for `--detached` is a repo-wide regex on `templates/agents.md`, so it would still pass if the quality paragraph dropped the flag. The quality paragraph itself currently contains `--role quality --detached`.
- PLAUSIBLE: inherit `TRACKED` still omits `quality.md`, so a project overlay at `.agents/limen/quality.md` would load (F069 overlay path) but would not appear in guidance drift. Same as other named-role preambles.
