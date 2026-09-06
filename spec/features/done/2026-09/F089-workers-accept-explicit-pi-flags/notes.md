# Literal launch arguments

- Spawn and continuation parse `--provider` and `--thinking` beside the existing model option. The existing opt-in auth preflight receives the explicit provider; thinking is a Pi runtime flag, not an auth flag.
- The detached wrapper and hosted supervisor receive two additional private environment fields and emit literal provider/model/thinking arguments. No new launcher or process supervision was added.
- Explicit models still beat stage environment defaults. The combined selector remains supported; a caller requiring literal argv supplies all three flags. Pi owns flag semantics and model availability.
- Claude spawns reject provider/thinking flags before creating a job. No independent reviewer was run, and no live Alice worker or transcript capture was started here.

## Checks

Implementation commit: `cd8cbb1`. Retained logs: `.limen/evidence/f089-cd8cbb1/`.

- Four new regressions failed before the patch on the unsupported provider option.
- Nine focused tests passed, covering both launch modes, both continuation modes, existing defaults, stage overrides, auth preflight, and the Claude boundary.
- All four new regressions passed again at the clean candidate commit. Tests captured the exact contiguous argv `--provider openai-codex --model gpt-6-astra --thinking high` with a competing Grok worker environment; Herdr and Pi were test binaries, not provider calls.
- Typecheck, scoped Biome, and template-history checks passed. The linked `limen --help` advertises the new flags immediately.
- `npm run check` remains blocked by formatting of older retained CPU evidence. Full tests were not rerun past that block.
- Structure checks passed 21/22: the unchanged cap is 3513 source lines, baseline was 3519, and this patch adds 38 lines. The cap and unrelated evidence were not rewritten.
