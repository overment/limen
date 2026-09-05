# Vision

## Product principles

- One human; many focused Pi sessions; one coordinator conversation.
- Durable intent, job state, prompts, and decisions in ordinary files and Git.
- One short job; one isolated worktree; one explicit repository boundary.
- Fresh review before trust, bought where a mistake is expensive rather than charged on every commit. Each round is a fresh spend and the loop has a ceiling.
- Evidence before claims of completion. A job ends itself and says so; silence, a clean exit, and an open tab are not proof.
- Harness mechanisms inform and preserve judgment; no hidden workflow gate.
- Judgment travels as prose. Wanted behavior comes from the shop manual, the register, the vision, and the styleguide riding the prompt and being recalled at the moment of use; new machinery only where prose cannot reach.
- Reversible local operations; small dependency-free implementation; inspectable recovery.
- Notifications reach subscribed coordinators without creating unsolicited ownership.
- Every reply is read cold by an owner whose clock stopped at their last message: an identifier travels with its meaning, and the reply is as big as the question.
- Herdr is the visible layout for jobs when it is running; job files and Git remain the source of truth. Each role keeps its own space and the coordinator's holds only the human conversation. A closed tab can be reopened. A tab is not the job.
- One seat owns the job cabinet; a laptop is a window. Closing the lid must not kill work.
- The board is the Git branch you checked out. `limen init` writes empty furniture; it is not the cabinet.
- Outside systems mirror; they never own. Linear reflects feature state only when the operator asks for it. GitHub is a doorbell: mention or label may start a job, merge stays human, and auto-claiming every PR is unsolicited ownership.

## Current direction

- Reliable completion is mostly paid for: job files beat the footer and a missed wake, hosted jobs end themselves, and a failed turn is visible on the next cue. What remains is the start — spawn must return the ID in seconds and hand the job to a supervisor that owns it, and the reaper must tell a live owner from a lost one.
- The remote seat exists. Walkthrough: [docs/vps.md](../docs/vps.md). Next: lid-closed `--detached` job, Moshi rings, then live there. Coordinator stays on the laptop until that prove.
- After the seat is boring: an opt-in GitHub doorbell that spawns on that seat and comments back evidence.
- The three job kinds below are the next widening. They ride the role seam that already gives workers and reviewers their own preamble and space, so they can interleave with the seat work instead of queuing behind it.

## Jobs we do not run yet

Three shapes to stand beside slice, repair, survey, finish, and review. Each is an ordinary Pi session with its own preamble and its own space. None of them merges, and none of them edits the board. They differ in who starts them: the human asks for research, the loop schedules quality, and the coordinator decides when a picture is worth drawing.

- **Research.** The human asks for it; the coordinator never opens one on its own, because a fan-out across models is spend nobody authorized. Then a question gets several answers at once: parallel sessions on deliberately different models, each in its own worktree and space, and one judge session that reads them all and writes the input the spec needs. The judge names where the answers diverged rather than averaging them; one opinion is not research. A report carries the verdict, the tradeoff that decides it, and the source that proves it — a named repository at a named revision, or current documentation the session actually read, never recalled API. Reaching the open web and cloning a dependency to read it is the one capability these sessions need and workers do not have. Research produces a ticket, a decision, or a paragraph of this file; it never produces a merge.
- **Quality.** A phase over a stretch of landed work, not a gate on one merge, judged against this vision and the styleguide: how the code is organized, what is dead and can go, and where two files claim authority over the same decision. It reports and proposes; every deletion still lands as an ordinary reviewed slice. Its bar is subtraction and unification — a rewrite is out of scope, and a feature that no longer serves the intent is a drop candidate, not a refactor.
- **Picture.** The coordinator starts it after work lands, detached, so nothing waits on it — and only when the change moves the shape a reader carries in their head. A routine slice earns nothing; an unearned diagram is noise the owner has to read past. The deliverable is a picture the owner takes in at one sitting: how the system fits together, where each feature stands, and the decision waiting on them. Text-first, so it lives in Git and survives review. It reads the board, the feature folders, and Git, and never invents state. It is held to the human register — nothing bare, nothing that needs the thread to make sense.
