# F010-pane-hosted-jobs · An opt-in job you can attach to and take over

[2026-08-15] [🟠] [ACTIVE] [COORDINATOR] ACTIVE · F010-pane-hosted-jobs — `limen spawn --tab` implemented; try under real Herdr before PROVEN

## Outcome

For work that warrants supervision, a coordinator can start a job as a real interactive `pi` in the Herdr tab F012 already opened, watch it reason, and type into it when it goes sideways — then hand it back. The default job stays a background process with a watch tab (F012). Headless spawn without Herdr stays as it is today.

## Depends on

F012-herdr-job-spaces. This ticket does not invent workspace/tab/pane meaning, naming, or reopen. It changes what *runs inside* the job tab: from `tail -f` of the log to `herdr agent start --kind pi`.

## Scope

- An explicit opt-in spawn mode (`limen spawn --tab` or a better flag) that starts the worker as a Herdr-hosted agent in the job’s tab.
- A worker-side reporter that keeps `.limen/jobs/<id>/` populated from inside the running `pi`, replacing what the JSON stream parser supplies for ordinary jobs, so `limen jobs` stays truthful for hosted jobs.
- The job record marks the job as `hosted` and states the weaker guarantees.
- `limen open <id>` on a live hosted job focuses the existing agent tab. After that tab was closed, reopen is a **log** tab, not a resurrection — the hosted process died with the tab. Respawn is how you get a new agent.
- Graceful refusal when Herdr is unavailable, with the human told to use an ordinary job instead.

## Out of scope

- Making hosted jobs the default, or migrating existing jobs to this mode.
- Reimplementing the wrapper's timeout, tool-call cap, or process containment inside a pane.
- Layout, naming, and reopen of watch tabs — F012.
- Review jobs, until ordinary hosted jobs are proven.

## Acceptance

- A hosted job appears in its F012 tab, is visible to `herdr agent list`, and accepts `herdr agent prompt`.
- `limen jobs` reports a hosted job's state, activity, and terminal outcome as reliably as it does an ordinary job.
- Closing the tab, or losing Herdr, leaves durable evidence explaining what happened rather than a record stuck at `running`.
- Spawning `--tab` without Herdr present produces a clear refusal and no partial job record.
- Ordinary jobs and F012 watch tabs are unaffected: existing spawn, wrapper, stream parsing, containment, and (once landed) space tests still pass.
- The job record states plainly that a hosted job carries weaker guarantees than a detached one.

## Notes

**Vision decision, 2026-08-15:** the human accepted Herdr as the layout for jobs. This ticket is no longer blocked on that. It is sequenced after F012.

What a hosted job gives up, all of which lives in `src/proc.ts` and `src/stream.ts`:

- the 90-minute timeout and 900 tool-call cap enforced by `runInternalJob`
- all of F007: PID-safe cleanup, escaped-descendant containment, and durable warnings when termination cannot be confirmed
- the `--mode json` stream that writes `log`, `activity`, and `tool-calls`

The third is recoverable from inside the pane using Pi's own events. The first two are not — Herdr owns the process tree.

Mechanics: `pi` is a first-class Herdr agent kind (`herdr agent start --kind pi`). `agent start` requires an existing pane already at an interactive shell prompt; F012 creates that pane. The local `pi` integration currently reports `outdated (v5 < v8)` and would need `herdr integration install pi` before this is demoed.
