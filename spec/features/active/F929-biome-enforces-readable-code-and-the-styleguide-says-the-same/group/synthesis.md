# Code quality status (F929)

Adam's four picks are implemented. Biome formats the tree at 120 columns and requires braces on control-flow bodies. Long string literals can still exceed 120 columns because the formatter does not split them. The recommended rule set is on. `npm run check` fails on warnings as well as errors. New functions must stay below cognitive complexity 25 and 70 lines, unless they carry a local suppression with a reason.

The command flags for spawn, continue, group start, keeper, land, picture, ticket new and linear use one `parseFlags` helper built on Node's `parseArgs`. A flag without a value and an unknown flag keep their single-error messages. `--flag=value` is newly accepted. Loops that parse free text or fixed one-word forms remain as listed in `notes.md`. There are no runtime dependencies.

The split work also reduced the exemption table from 53 functions at the first limit pass to 33. The remaining 33 functions have 41 local suppression comments. Their exact names and measured sizes are in `notes.md`; none has an F929 owner. No Effect, XState or Zod was added.

Checks: the reformat's 102 changed scripts were compared token by token, with only blocks, parentheses and trailing commas normalized. The 148-case CLI probe found eight accepted forms changed, all inline-value forms. The default picture viewer rendered in a hidden browser; a CSS reorder kept computed styles identical for all 525 elements. Two integration tests can fail under heavy machine load on `main` as well as on candidates; isolated reruns passed. The split stack's final native check and group closure are recorded in the landing commit and lead notes.
