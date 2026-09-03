# F051-readable-jobs · The jobs list reads at a glance

[2026-08-31] [🟠] [ACTIVE] [COORDINATOR] ACTIVE · F051-readable-jobs

`limen jobs` serves two readers with opposite needs. The coordinator reads it through a Bash tool under a 1KB live-snapshot budget, where the `·`-chain is a fine wire format. A human reads it in a terminal, where the same line prints the same fact three times — the id embeds the date and label slug, the branch embeds the id, and the typable suffix hides at column forty — while `silent 0s` on a week-old job is pure noise. One law resolves it: **the TTY decides the renderer.** Piped or captured output keeps today's compact format byte for byte; a terminal gets a view built for eyes. No new flag to remember, no second command, no coordinator retraining.

## Outcome

At a terminal, `limen jobs` prints one aligned row per job — colored state glyph, label, typable suffix, then only facts that carry news — and a one-line cabinet summary. `limen jobs <id>` prints labeled sections with the log filtered to limen events and real lines. Piped output is unchanged. `LIMEN_VIEW=human|compact` forces either view; `NO_COLOR` keeps the layout and drops the paint.

## Scope

- View selection as a pure function: `LIMEN_VIEW` wins, else stdout TTY chooses. Color additionally requires a TTY and honors `NO_COLOR` and `TERM=dumb`.
- Human row: glyph (`●` running, `✓` done, `✗` failed, `■` stopped, `!` invalid), padded label, dim suffix (the id's last segment — already accepted by `jobs`, `steer`, `stop`, `open`), then per-phase facts. Running: elapsed, pulse or last tool, tool count, silence only when it means something (≥90s yellow, ≥5m red — the supervisor's stall vocabulary). Terminal: age, duration, work (`82 tools · 1 commit`, or red `nothing`), the recorded reason when one exists, dim flags (`review`, `hosted`, `continue`, `repo <name>`). Never the id or branch in a row — the suffix is the handle; identity lives in detail.
- Human snapshot: running rows, the six most recent terminal rows, and a dim footer counting jobs by state — odd state files count red `invalid` — with a `limen jobs --all` hint when rows are hidden. `--all` is the same table over everything.
- Human detail: aligned key column — id with the suffix emphasized, branch, one ran/finished line, versions, commits, result, stop-reason, diff, cleanup — and a log section that keeps `[limen …]` events (local clock times) and real lines while dropping bare activity beats.
- Renderers are pure functions in `src/view.ts` — no filesystem, no process spawns — golden-tested without color and spot-tested with. `jobs.ts` reads each job once into one record and routes it to the compact or human assembly.
- Raise the structure-test source budget deliberately: the second renderer is capability for human eyes, priced here.
- One README sentence stating the law.

## Out of scope

- Any change to compact output bytes, compact snapshot selection, job files, or spawn/wake/reap/stop behavior.
- `limen board` — a later ticket loops the human snapshot in a tab and inherits this renderer.
- Interactivity, unicode width tables, column or color configuration, and the Pi footer extension.

## Acceptance

- The existing suite passes untouched: piped snapshot, `--running`, `--all`, `<id>`, INVALID diagnostics, and the 1KB live cap are byte-identical to before.
- `LIMEN_VIEW=human limen jobs` in a scratch repo: aligned rows with no `id` or `branch` chains; the printed suffix resolves via `limen jobs <suffix>`; the footer counts match the cabinet; `nothing` replaces the produced-nothing parenthetical; `silent 0s` never appears.
- A terminal job with zero tool calls and no commits reads red `nothing`; a job with an unknown state renders a red `!` row and an `invalid` count, and its state file is never rewritten.
- `NO_COLOR=1` with the human view forced: identical layout, zero escape bytes.
- Detail on a job whose tail is activity beats plus limen events shows the events with local `HH:MM:SS` times and no beats.
- Golden tests pin a running row, a terminal row, the snapshot footer, and a detail block exactly.

## Notes

The activity-beat filter is display-only heuristics over lines the wrapper itself writes (`think`, `wait`, bare tool names): a single lowercase word is a beat. A worker's own one-word line may vanish from the rendered tail; the log file, which stays truth, always survives. Silence thresholds mirror F045's stall escalation rather than inventing a second vocabulary.
