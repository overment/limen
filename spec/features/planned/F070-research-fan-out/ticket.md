# F070 · Research fan-out and judge

## Outcome

When you ask a question that needs more than one opinion, the coordinator starts several research sessions on different models and one judge that reads them all. The judge names where they diverged rather than averaging them, and writes the input a spec needs: a ticket, a decision, or a paragraph of the vision. The coordinator never opens research on its own — a fan-out is spend you have to authorize. Research never merges and never edits the board.

## Scope

- Two package prompt files: `templates/researcher.md` and `templates/judge.md`. Each kind gets its own Herdr space via the named-role seam.
- Shop-manual ritual: the human asks; the coordinator never starts research unprompted. At least two researcher jobs, each `--role researcher --detached --model <distinct>`. After they finish, the coordinator files each final message, then one `--role judge --detached` job that reads those files and writes the judgment.
- Filing: each researcher's final message is `report-1.md`, `report-2.md`, … and the judge's is `judgment.md`. When the question is about an existing feature, those files sit in that feature folder. Otherwise they sit in `spec/research/<slug>/`, created for the question. The coordinator files them, as it files a reviewer's verdict today.
- Sources: a researcher reads what the question names — a repository at a revision, a documentation URL — via bash (`curl`, `git clone`). Recalled API is not a source. No search extension; jobs stay `--no-extensions`. If the question names no source, the researcher says so and stops rather than inventing one.
- A report carries the verdict, the tradeoff that decides it, and the source that proves it. The judge names divergence; it does not pick a winner by blending.
- Ship history hashes and extend the structure-test template list so the new files pack like worker and reviewer.

## Out of scope

- A web-search extension, or any extra tool beyond pi's built-in read, bash, edit, and write.
- Merging, editing the board, or the coordinator starting research without being asked.
- Changing spawn flags beyond using `--role` from the named-role seam.

## Acceptance

- The shop manual states the human-only trigger, the fan-out (at least two models, then one judge), the filing paths, and that research produces a ticket, a decision, or a vision paragraph — never a merge.
- `templates/researcher.md` and `templates/judge.md` exist, have history hashes, and a `--role researcher` / `--role judge` spawn loads them.
- A researcher prompt forbids recalled API and requires a named source; with none, it stops.
- A judge prompt requires naming where the reports diverged and forbids averaging.
- Structure tests that list packaged templates include the new files.

## Notes

Search stays out until a question cannot be asked with named sources. Folded here on purpose; do not reopen as its own ticket without a concrete miss.
