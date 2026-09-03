# Notes

## Seams

- `templates/agents.md` — steps 5–6, the handoff paragraph, the model sentence, own-hands, Recovery's silent-or-rambling bullet.
- `test/structure.test.ts` — phrase assertions for each added sentence.
- `templates/.history/agents.md` — prepend the new hash after the template commit.

## Audit map (2026-09-03)

Sentences added in this slice, each to a numbered finding from the Alice audit as filed in the ticket:

1. Owner asked to skip reviews twelve times while ten more reviews were spawned → *An appetite the owner states holds for the conversation.*
2. One slice took twelve review rounds → *A second FAIL on the same slice ends the loop … the reply names what remains and what it cost.*
3. Spend ceiling of 2026-09-01 did not hold because each round's findings arrived labelled proven → *… even when every finding is labelled proven.*
4. Findings that widened the slice were repaired in-place → *A finding that widens the slice becomes a ticket line, not a repair.*
5. Re-review handoffs carried probe lists, verdict words, and hand-typed hashes → *A re-review handoff names the findings file and the commit and stops — no probe list, no verdict word, no hash typed by hand.*
6. Review handoffs did not name a discriminating check → *Name the one check that would prove the candidate wrong.*
7. `review-N.md` was not on the candidate branch; trailing whitespace became a finding → *Strip trailing whitespace on filing, and commit `review-N.md` on the candidate branch before any repair spawn.*
8. Ten steers stood against seventy stops; workers wandered with no edit → *A live worker with tool calls and zero changed files gets a steer that names the file and the first edit; stop only after a steer is ignored.*
9. A steer after the worker had posted its handoff restarted a finished job → *A steer to a worker that has already posted its handoff is a new spawn.*
10. Hosted workers were stopped after they had already finished (F055) → *A hosted worker that has called `finish` is finished.*
11. Fourteen replies asked whether anything had been committed → *Inline work ends committed, or the reply says it is not.*
12. Coordinator digs that outlived a sitting → *A dig past about five minutes becomes a survey job.*
13. Two merges picked up unrelated drafts from a dirty tree → *This conversation's checkout is the only merge target and stays clean.*
14. Visual work merged without a render → *Visual work needs a render check or a spawn.*
15. Handoffs overran the ticket → *Over about two hundred words is a ticket problem.* *The seam is a file and the first edit in it.*
16. A stated model or reasoning level was not sticky → *A stated model or reasoning level rides on every later spawn of that kind and is written into the board's decisions.*

Already present, not rewritten: single-quote or `--task-file` (F058); a helper session never spawns, stops, or steers on a routed wake (F056).

## Decisions

- The 2026-09-01 ceiling sentence (*one repair and one re-review settle an ordinary ticket*) stays; the new sentence names the labelled-proven case that defeated it.
- The re-review example no longer contains `<prior-sha>` or "verify each blocking finding". The harness still records the candidate commit.
- No counter, field, or validator. Length checked by hand against the ticket's plus-ten-percent bound, not asserted.

## Open

None.
