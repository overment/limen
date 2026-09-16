# F716 · jobs can filter by label prefix

## Outcome

`limen jobs` can list only jobs whose label starts with a given prefix or wave tag. Operators do not scrape `--all` to find a wave. An empty match is an empty list, not an error.

## Scope

- `limen jobs`, starting at `src/commands/jobs.ts` `select()`.
- A label prefix or wave tag filter on the existing list; keep `--running`, `--all`, and single-id lookup.
- Compact and human views both honor the filter.
- Focused jobs-command tests.

## Out of scope

- Finish bot-turn receipts.
- A land command.
- Changing job ids, labels at spawn, or Herdr tab titles.
- New workflow state or a job registry.

## Acceptance

- `limen jobs --label <prefix>` (or the equivalent small flag the worker chooses) lists jobs whose label starts with that prefix, including terminal ones that the default snapshot would hide.
- A prefix with no matches prints that nothing matched, without dumping `--all`.
- `limen jobs`, `limen jobs --all`, and `limen jobs <id>` stay unchanged when the filter is omitted.
- Unknown extra flags still error.
- Focused tests cover a match, a miss, and unchanged default listing.

## Notes

WAVE asked for label prefix or wave tag without scraping `--all`. Prefer one flag over two. Do not invent a parallel index; filter the existing job files.
