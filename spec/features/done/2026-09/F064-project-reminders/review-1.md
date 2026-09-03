PASS b929056a6b2288ce861952a2fcea0380619493c4

F064 candidate `b929056a6b2288ce861952a2fcea0380619493c4` (`feat: recall project styleguide and vision headings on tool use`): style and vision tool-result reminders are built from the project’s `.agents/limen/styleguide.md` and `spec/vision.md` headings at handle time; they no longer recite Limen TypeScript or one-human prose. Checkout HEAD matches the named candidate. Nothing blocking.

**Checks**

- `git rev-parse HEAD` → `b929056a6b2288ce861952a2fcea0380619493c4` (matches the named candidate; detached `HEAD`).
- `npm ci` from `package-lock.json` → 12 packages added, 0 vulnerabilities.
- `node --test --test-concurrency=1 --test-timeout=60000 test/communication-hook.test.ts` with `LIMEN_JOB` / `LIMEN_JOB_ID` / `LIMEN_JOB_LABEL` / `LIMEN_CONTEXT_ROOT` / `LIMEN_HOSTED` / `LIMEN_TASK_FILE` unset → 22 pass, 0 fail (includes `style and vision reminders name the project files and their headings` and `a write or edit outside spec/ recalls the styleguide unless the path is Markdown`).
- Read `hook/communication.ts`, `test/communication-hook.test.ts`, and Pi `tool_result` (`ExtensionHandler` gets `(event, ctx)` with `ctx.cwd`; `emitToolResult` always passes `createContext()`).
- `tsc --noEmit` and `biome check` not run. Unverified, not blocking.

**Acceptance (met in code and hook tests)**

- Proven: `STYLE_REMINDER` / `VISION_REMINDER` canned TypeScript and one-human sentences are gone. `projectReminder` names the file and up to eight ATX headings, or a bounded missing-file / no-headings line.
- Proven: a fixture with Rust styleguide headings and a non-Limen vision yields those headings and fails `/TypeScript|index\.ts|one human|Inform, do not gate/` (style) and `/one human|one coordinator|Inform; do not gate/` (vision).
- Proven: `edit` of `src/main.rs`, `ui/App.svelte`, and `styles/app.css` appends the styleguide reminder; `write` of `docs/note.md` is unpatched; `edit` under `spec/` still ends with the unchanged Specs reminder.

**Notes (non-blocking)**

- Proven: `isCodePath` is now “not `.md`” after `isSpecPath`. Matches the ticket’s wider code-path rule. `.mdx` / `.markdown` would get a style reminder; acceptance names `.md` only.
- Proven: ATX-only heading scrape. A setext-only governing file hits `no headings; read the file.`, which is the ticket’s absent/no-heading fallback.
- Plausible: heading cap `MAX_REMINDER_HEADINGS = 8` is untested; overflow adds `; read the file`. Bounded as scoped, not an acceptance miss.
