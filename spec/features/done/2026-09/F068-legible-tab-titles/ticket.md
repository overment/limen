# F068 · A tab title says what the work is

## Outcome

Reading the sidebar tells you what each job is doing, in words you already use, without holding feature numbers in your head. Today's tabs read `F421 settings`, `F422 inline settings`, and two different jobs both read `F423 skill catalog` — the number is an address, "settings" is not a description, and siblings are indistinguishable. After this, a tab reads like `inline model setup in chat · F422`, and the number rides at the end where filing still finds it.

## Scope

- The label rule in `templates/agents.md`: the tab says what a person will see change when this lands, in plain words, about forty characters; the feature number goes last, not first; a repair, a resume, or a review names its round so sibling tabs differ. Replace the current examples with plain ones drawn from real work.
- `makeJobId` in `src/commands/spawn.ts` hoists a feature number from anywhere in the label, so ids stay `YYYY-MM-DD-fNNN-<slug>-<hex>` and the hosted agent name stays `limen-fNNN-<hex>` however the human words are ordered.
- `closeFeatureTabs` matches the feature number anywhere in the label or the job id, not only at the start.
- Spawn warns on one line when a label is only a feature number, or when another live job already carries it. It warns and proceeds; nothing is refused.

## Out of scope

- The sidebar role description, which already says worker or reviewer.
- Renaming tabs of jobs that already ran.
- Any validator that rejects a label, or any parsed field beyond the feature number.

## Acceptance

- A label whose feature number sits at the end produces a job id beginning `YYYY-MM-DD-fNNN-` and a hosted agent named `limen-fNNN-<hex>`.
- `limen close FNNN` closes tabs whose label carries the number anywhere in it.
- A label that is only a feature number, and a label another live job holds, each print one warning line and still spawn.
- The shop manual's rule and examples are plain descriptions; the structure test asserts the new rule and the absence of "Lead with the feature number".
- A live spawn shows the description in the sidebar without truncation at the stated budget; the prove records the width that survived.

## Notes

The label is one string doing three jobs: tab title, job-id slug, agent name. Only the tab title is read by a person, so it wins; the id keeps the number by hoisting it.
