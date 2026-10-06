# Team 3 · Biome's recommended preset, green

Test line budget: 40 lines.

## Numbers to start from (`notes.md`)

The recommended preset finds 107 diagnostics: 65 `style/noNonNullAssertion` (picture code), 9 `noDescendingSpecificity` (viewer CSS), and about 30 small sites in TypeScript, the viewer JavaScript and the viewer HTML template. Measure again on `main`.

## Work

- Turn on the recommended rules in `biome.jsonc` in the form Biome 2.5.8 accepts (today the config says `"preset": "none"`). Keep the named rules that the preset does not cover.
- Fix each diagnostic in the code. A non-null assertion becomes a real check, a narrowed type or an early return; it does not become a cast.
- Turn a rule off only when it is wrong for this repository, with the reason in a comment. Example: `picture/viewer/*.js` is inlined into a classic `<script>` by `src/picture/html.ts`, so its `"use strict"` lines are needed although Biome reads the files as modules. Scope such an exception to the files it is true for.
- Do not silence a diagnostic that points at a real bug. Fix the bug and say so in the candidate message.
- Update the styleguide and `CONTRIBUTING.md`: they say the preset stays `none` and forbid a preset. Rewrite those lines to state what is true after your change.

## Viewer CSS and JavaScript

A CSS reorder for `noDescendingSpecificity` can change what the page shows. Build the picture before and after (`bin/limen picture build --dir "$LIMEN_CONTEXT_ROOT/.limen/picture" --out /tmp/<name>.html --strict`), screenshot both with `/Users/overment/.local/bin/vscreen` (never `open`), look at the frames, and put the paths in the candidate message.

## Files

You own `picture/` and `src/picture/`. One-line fixes elsewhere are fine; `spawn.ts`, `continue.ts` and `group.ts` change a lot under Team 4, so publish such a fix to Team 4 instead of committing it there.

## Order

Small candidates: the TypeScript sites first, then the viewer JavaScript, then the CSS with its screenshots, then the preset switch with the docs. The switch lands last, when it adds no diagnostic.
