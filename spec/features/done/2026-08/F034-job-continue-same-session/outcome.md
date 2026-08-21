# F034 outcome · job continue in the same session

Landed at `6ee8ff1` (2026-08-21, coordinator-written, suite-covered).

`limen continue <id|suffix|label> "instruction" [--review] [--label L] [--model X]` resumes a finished job (`done`/`failed`/`stopped`) inside its own pi session: the child job record carries a `parent` file, its own session dir seeded with a copy of the parent's newest transcript (parent record stays frozen), and runs `pi --continue "<instruction>"` in the parent worktree. Refuses running jobs and pruned worktrees without creating a record. Reviewer continuation is opt-in and prints that it is not independent.

Proven live 2026-08-21: parent `2026-08-21-f034-continue-try-30eeedf4` memorized AMBERDOVE and committed `proof.txt` (`404b37c`); after `limen stop`, `limen continue` child `2026-08-21-f034-continue-try-continue-13ec2629` answered "AMBERDOVE" with no tools and no file reads — full context carried over. `test/continue-command.test.ts` covers record shape, refusal paths, and session seeding.
