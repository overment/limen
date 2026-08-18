# F019-coordinator-own-hands · Name the threshold for not spawning a worker

[2026-08-18] [🟠] [ACTIVE] [COORDINATOR] ACTIVE · F019-coordinator-own-hands

## Outcome

The shop manual states when the coordinator should do work itself instead of spawning a job, so small fixes stop paying the spawn tax and big work stops being done inline by an over-confident coordinator. Today the manual grants "full hands" but names no threshold; the observed case is F015, where writing the missing `notes.md` inline was correct and a respawn would have wasted a worktree and a wake round-trip.

## Scope

- One compact paragraph in `templates/agents.md`, placed with the existing "This is craft, not a gate" passage, saying approximately:
  - **Do it yourself when** the change is a few lines in files this conversation already read, the native checks that cover it run in about a minute, and a mistake is one `git revert`. Producing a deliverable a finished job failed to write (survey notes, an outcome file) is coordinator work, not a respawn.
  - **Spawn when** the work outlives one sitting, needs an isolated worktree or a fresh context, should run while the conversation continues, or touches the expensive-blast-radius list already named in step 5.
  - **Steer or resume before respawning** a live or nearly-done worker (this sentence exists in Recovery; reference it, do not duplicate it).
- Mirror the same threshold in one sentence of `templates/worker.md`'s counterpart if reviewing shows it repeats the manual (expected: no worker change needed).
- This repository has no project `AGENTS.md`, so editing the package template is sufficient; note in the diff that projects with an `AGENTS.md` overlay do not inherit it automatically.

## Out of scope

- Any `src/` change, flag, or mechanism. This is guidance; nothing enforces it.
- Rewriting the default loop or the ask-the-human list.
- Cost accounting or token budgeting language.

## Acceptance

- `templates/agents.md` contains the threshold paragraph; the do-it-yourself and spawn cases each name concrete criteria, not vibes.
- The paragraph is at most ~120 words and does not duplicate Recovery's steer/resume guidance beyond a pointer.
- Injected shop manual stays under its 1000-line bound (it is ~90 lines today; assert nothing, just do not bloat).
- `npm run check` green (docs-only change still runs the suite).

## Notes

Source discussion: F016 notes section 6 and the coordinator conversation of 2026-08-18. The spawn tax to name: a worktree, a cold context that must re-read what the coordinator already knows, and a wake round-trip. The counter-risk to name: inline work has no isolation and no independent review by default, so it must stay inside the cheap-to-revert boundary.
