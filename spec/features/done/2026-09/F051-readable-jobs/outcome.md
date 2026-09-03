# Outcome

At a terminal, `limen jobs` prints aligned rows — glyph, label, typable suffix, then only facts that carry news — and a cabinet footer. Piped output is unchanged. `LIMEN_VIEW=human|compact` forces a view; `NO_COLOR` keeps the layout and drops the paint.

Landed `1077419`. Coordinator-checked: view goldens, jobs compact suite, and structure passed. Independent review skipped: the diff is local and reversible, compact bytes are pinned by the existing jobs tests.
