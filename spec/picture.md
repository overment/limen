# Picture

A job kind is a name and a prompt, and it opens in its own space — not beside the conversation you are reading.

## How it fits

You talk in one coordinator conversation. Jobs are short, each in its own worktree. Durable intent lives in ordinary files: the vision, the board, a numbered feature folder, and Git. Job records under `.limen/jobs/` are the truth. Herdr is the layout when it is running. A closed tab can be reopened. A tab is not the job.

Two ways to run a job. In Herdr, spawn opens a tab you can type into. Pass `--detached` and it runs in the background with a log tail. Reviews, research, quality, and a picture pass all detach on purpose. The role name does not pick that mode.

Spawn `--role <name>` loads that prompt — from the package, or a project file at `.agents/limen/<name>.md` — and opens a Herdr space named after the project plus that name with an `s`. Worker is the default. Review stays `--review`: a detached checkout, a named candidate commit, the reviewer prompt, the reviewers space. A missing prompt, or combining `--role` with `--review`, plants no job. Continue without `--review` keeps the parent's role.

The space you talk in holds this conversation and the tabs you made. Job tabs go to the role's space, so scanning your own thinking no longer means reading past the workers. A hosted start still brings the job tab forward — Herdr will not start an agent in a background pane — then returns you here. The first job tab replaces the empty tab a new space is born with. A tab title says what the work changes, in your words, with the feature number last so filing still finds it.

```
you ── this conversation, in the project space
        │
        ├─ <project> workers       the default slice
        ├─ <project> reviewers     --review; one verdict
        ├─ <project> researchers   only when you ask; named sources
        ├─ <project> judges        names where the reports diverged
        ├─ <project> qualitys      findings; does not rewrite
        └─ <project> pictures      this file, after a shape moves
```

Research never starts unprompted. At least two models, then one judge; the output is a ticket, a decision, or a vision paragraph — never a merge. Quality starts after ten proven landings, or when you ask; it writes one findings file and is not a merge gate. A picture starts only when the handoff can name, in one clause, the shape that moved.

The quality space is named with a trailing `s` like the others. No table of nicer plurals was added.

## Where each feature stands

Hosted jobs end themselves: a worker calls `finish`, a clean idle session closes even after it used tools, a failed last turn is visible. Review loops stop at a ceiling. Guidance is sent once per call and recalled when a tool runs. September landed twenty-three features on that reliability; August, forty-four, including named tabs, contained process trees, and retrying wakes.

The shape this picture is for has landed. Worker and reviewer tabs open in their own spaces; the first tab in a new space replaces the seeded empty one. A tab title says the work, feature number last. A job kind is a name plus a prompt. Research fan-out, quality, and picture ride that name.

The board's NOW is still the change that makes a hosted spawn print the id in seconds and hands the worker to a background supervisor (F048, folder still in `spec/features/active/`). That folder has only the ticket. Git already contains the commit that moved hosted startup into the supervisor; the board has not marked it proven.

Next, as the board has it: a running job must have a live owner — adopt a hosted job whose supervisor died, fail one with no live owner (F049). Then one disk, attach don't clone (F013). Then a mention or label may start a job on that seat; merge stays human (F014).

Gaps, not filled in. Worker spaces were proven live; reviewer routing into the reviewers space, and closing leftover tabs across spaces, were tests only. How wide a description survives the sidebar was not measured. No quality findings file exists (`spec/quality/` is absent). No research reports are filed here (`spec/research/` is absent). Nothing sits in dropped.

## Waiting on you

Nothing about named roles. The vision still says this conversation stays on the laptop until a job that keeps running after you close the lid has been proven on the remote seat. The walkthrough for that box is `docs/vps.md`. Living there is the decision, and it is not due yet.
