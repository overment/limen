# F085 · A coordinator stops re-reading finished jobs

## Outcome

A coordinator session idles at a few percent of a core instead of pegging one.
On Alice six coordinator sessions each held 90–98% CPU with two jobs running and
475 finished ones on disk, and `sample` showed the main thread spending all of
it in `readdir`, `readFile`, and `access`. One sweep of that project measures
100–180 ms and about 11,900 filesystem calls, plus 56 ms and 1,940 calls to
redraw the status line; all of it is synchronous, so the terminal stalls in
fifth-of-a-second blocks. That cost is paid again for every finished job on
every sweep, and grows with the project's history.

## Scope

- Start at `observe` in `hook/wake.ts`, which counts `done`, `failed`, and
  `stopped` as observable: a terminal job whose wake is already settled has
  nothing left to deliver and can leave the walk.
- `sessionOwnsJobs` answers a question about the session rather than the job,
  but is asked once per job from inside that walk; twelve jobs each sent it on a
  full 475-entry scan, 48% of the sweep.
- The watcher's `notifyBookkeeping` filter already drops limen's own claim
  writes; a running job's progress files are the churn that remains — 282 of the
  482 surviving events in twelve seconds were `activity` and `changed-files`,
  holding the 50 ms debounce open continuously.
- A job that finishes unwatched must still reach an idle coordinator on the
  fallback path.

## Out of scope

- Retiring or deleting job records, which bounds the same cost from the other
  side and is its own decision.
- The wake protocol: claims, delivery slots, fallback grace, and confirmation
  stay as they are.
- Moving the sweep off the main thread or making it asynchronous.
- The leaked `limen-test-*` agents, which are a separate defect.

## Acceptance

- With a hundred or more finished jobs and none running, a coordinator's `pi`
  process stays under 5% CPU across a minute of `ps` sampling.
- With one job running, that same process stays under 25%.
- A second sweep over a 475-job directory completes in under 20 ms.
- A job that finishes while its coordinator is mid-turn still wakes it exactly
  once, on the next idle turn.
- A job that finishes with no watching session still reaches an idle coordinator
  after the fallback grace.
- The wake suites pass.
