---
touches:
  - limen.picture.viewer
  - limen.picture.build
  - limen.cabinet.records
opened: 2026-10-08
---

# F932 · The picture shows what each running job is doing now

## Outcome

Adam opens the picture and sees, on each feature and on each place it touches, which jobs work on it now and what each one does: thinking, running a command, editing files, waiting, done, or stalled. The page updates by itself while jobs run, for OMP and Pi jobs alike. A job whose process is gone, or that has been silent too long, never looks like it is running. The built page still opens offline when no server runs.

## Scope

- One local command serves the picture on 127.0.0.1 and pushes job activity to the page as it changes.
- Activity comes from the job folders that Limen already writes for both engines, not from engine session files.
- A job maps to a feature by the F-number in its label, branch, or id.
- The page shows live activity in the current picture design: a calm live strip, a mark on each place a running job touches, and the job lines inside the feature.

## Out of scope

- Steering, stopping, or opening jobs from the page.
- New hooks or files inside the engines; the server only reads what jobs already record.
- A remote or shared server. It listens only on 127.0.0.1.

## Acceptance

- `limen picture serve` prints one 127.0.0.1 URL. Opening it shows the picture with a live strip.
- A real OMP job that runs for this plant appears on its feature within about two seconds, with its engine, model, current action, and time since the last event.
- When that job ends, the page shows it as done or failed without a reload.
- A running job whose owner process is gone shows as not responding, never as running.
- A running job with no event for more than five minutes shows as quiet, not as working.
- The file that `limen picture build` writes makes no network request and shows no live strip.

## Notes

- Runtime study and design trade-offs: `notes.md` in this folder.
