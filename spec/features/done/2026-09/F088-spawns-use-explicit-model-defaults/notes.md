# Launch defaults and checks

- `src/commands/spawn.ts` and `src/commands/continue.ts` select `--model`, then the relevant stage environment, then `openai-codex/gpt-6-astra:high`. Review environment selection remains separate; Claude keeps its own default.
- `src/wrapper.ts` and `src/supervisor.ts` already forward `LIMEN_MODEL` as one `--model` argument. Pi accepts `provider/id:thinking`; no separate Limen provider/thinking options were added.
- `.pi/settings.json` pins trusted coordinator startup to `openai-codex/gpt-6-astra:xhigh`. Herdr peers use the explicit Pi flags documented in `README.md` so project trust cannot change the selection. Global Pi settings remain `xai/grok-4.6`.
- Adam accepted `--tab --engine pi --model openai-codex/gpt-6-astra:high` for Alice iconography. Independent review requires an explicit request.

## Evidence for the implementation commit

Candidate: `aa5382e`. Retained output: `.limen/evidence/f088-aa5382e/`.

- Five focused tests passed: stage defaults and overrides, detached continuation, hosted spawn, hosted continuation, and unchanged Claude default. The four default-routing tests failed before the runtime change and passed afterwards.
- Installed Pi's resolver selected Codex/high from a competing-provider fixture. Its settings manager loaded the real project as Codex/xhigh while global settings remained byte-identical. No provider call was made.
- Typecheck and changed-file Biome checks passed; template-history checks passed after regeneration.
- `npm run check` stops at an existing formatting error in `.limen/jobs/2026-09-05-f085-coordinator-cpu-resume-2-a6845681/evidence/cpu-summary.json`; that retained evidence was not rewritten.
- `npm test` reached the 600-second command limit without completing. Its two reported failures—feature-number tab closing and isolated spawn/resume—both passed individually afterwards. The four default-routing regressions passed during that full run.
- Structure checks passed 21/22. The existing source cap is 3513 lines; the baseline already had 3518 and this change adds one formatted line. The cap was not widened.
