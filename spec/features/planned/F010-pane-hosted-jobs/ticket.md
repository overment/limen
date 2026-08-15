# F010-pane-hosted-jobs · An opt-in job you can attach to and take over

[2026-08-15] [🔴] [PLANNED] [COORDINATOR] PLANNED · F010-pane-hosted-jobs

## Outcome

For work that warrants supervision, a coordinator can start a job as a real interactive `pi` in its own Herdr tab, watch it reason, and attach to it and drive by hand when it goes sideways — then hand it back. The default job stays exactly as it is today: detached, headless, durable.

## Scope

- An explicit opt-in spawn mode that starts the worker as a Herdr-hosted agent rather than a wrapped headless process.
- A worker-side reporter that keeps `.limen/jobs/<id>/` populated from inside the running `pi`, replacing what the JSON stream parser supplies for ordinary jobs, so `limen jobs` stays truthful for hosted jobs.
- An honest record in the job directory marking the job as hosted, so any later reader knows which guarantees applied to it.
- Graceful refusal when Herdr is unavailable, with the human told to use an ordinary job instead.

## Out of scope

- Making hosted jobs the default, or migrating existing jobs to this mode.
- Reimplementing the wrapper's timeout, tool-call cap, or process containment inside a pane.
- Review jobs, until ordinary hosted jobs are proven.

## Acceptance

- A hosted job appears in its own tab, is visible to `herdr agent list`, and accepts `herdr agent prompt`.
- `limen jobs` reports a hosted job's state, activity, and terminal outcome as reliably as it does an ordinary job.
- Closing the tab, or losing Herdr, leaves durable evidence explaining what happened rather than a record stuck at `running`.
- Spawning without Herdr present produces a clear refusal and no partial job record.
- Ordinary jobs are byte-for-byte unaffected: the existing spawn path, wrapper, stream parsing, and containment tests all still pass unchanged.
- The job record states plainly that a hosted job carries weaker guarantees than a detached one.

## Notes

**This ticket needs a human decision before it starts.** Today Herdr is decoration: `herdrTarget()` in `hook/wake.ts` returns undefined unless `HERDR_ENV=1`, and every Herdr call is fire-and-forget, so removing Herdr changes nothing about how Limen works. A hosted job makes Herdr load-bearing for jobs started that way. `spec/vision.md` does not currently admit any such dependency. Either the vision gains a line accepting it for an opt-in mode, or this feature should be dropped.

What a hosted job gives up, all of which lives in `src/proc.ts` and `src/stream.ts`:

- the 90-minute timeout and 900 tool-call cap enforced by `runInternalJob`
- all of F007: PID-safe cleanup, escaped-descendant containment, and durable warnings when termination cannot be confirmed
- the `--mode json` stream that writes `log`, `activity`, and `tool-calls`

The third is recoverable from inside the pane using Pi's own events. The first two are not — Herdr owns the process tree. F007 was proven on 2026-08-14; this mode sets it aside for the jobs that use it.

Durability itself is less affected than it first appears, because the Herdr server persists across client detach. The guarantee moves rather than disappearing: from "a detached process plus files on disk" to "the Herdr server is up."

Mechanics are confirmed available. `pi` is a first-class Herdr agent kind (`herdr agent start --kind pi`), with lifecycle detection covering `idle`, `working`, `blocked`, and `done`, plus `herdr agent prompt`, `wait --until blocked`, `read`, and `attach`. The local `pi` integration currently reports `outdated (v5 < v8)` and would need `herdr integration install pi`. `agent start` requires an existing pane already at an interactive shell prompt; it never creates layout itself.

If F009 lands first, most of the day-to-day value — seeing the work, redirecting it — is already available without any of the above cost. The remaining unique capability here is attaching to a live agent and driving it by hand.
